/// <reference types="jest" />

import express from "express";
import request from "supertest";
import { ZodError } from "zod";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { resetMockPrisma } from "./helpers/mockPrisma";

jest.mock("../src/lib/prisma", () => {
  const { mockPrisma } = require("./helpers/mockPrisma");
  return { prisma: mockPrisma };
});

jest.mock("../src/middlewares/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.header("x-test-auth") === "none") {
      res.status(401).json({ message: "Unauthenticated" });
      return;
    }

    req.authUser = {
      id: req.header("x-test-user-id") || "user-1",
      role: req.header("x-test-role") || "USER",
    };

    next();
  },
}));

import { usersRouter } from "../src/routes/users";
import { mockPrisma } from "./helpers/mockPrisma";

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/users", usersRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ message: "Validation failed", issues: error.issues });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ message });
  });

  return app;
};

describe("Users endpoints", () => {
  beforeEach(() => {
    resetMockPrisma();
  });

  it("GET /users returns paginated users with filters", async () => {
    const app = createTestApp();

    mockPrisma.user.findMany.mockResolvedValue([
      {
        id: "user-1",
        email: "user1@mail.com",
        fullName: "User One",
        avatarUrl: null,
        role: "USER",
        status: "ACTIVE",
        verificationStatus: "PENDING",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        verificationSubmissions: [],
        _count: { ownedListings: 2 },
      },
    ]);
    mockPrisma.user.count.mockResolvedValue(1);

    const response = await request(app)
      .get("/users")
      .query({ q: "user", role: "USER", status: "ACTIVE", page: 1, limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.total).toBe(1);

    const whereArg = (mockPrisma.user.findMany as any).mock.calls[0][0].where;
    expect(whereArg.role).toBe("USER");
    expect(whereArg.status).toBe("ACTIVE");
    expect(whereArg.OR).toBeDefined();
  });

  it("GET /users/:id/dashboard/seller/commission-invoices returns 401 when unauthenticated", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/users/seller-1/dashboard/seller/commission-invoices")
      .set("x-test-auth", "none");

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Unauthenticated");
  });

  it("GET /users/:id/dashboard/seller/commission-invoices computes invoice summary", async () => {
    const app = createTestApp();

    mockPrisma.jointOffer.findMany.mockResolvedValue([]);
    mockPrisma.rentalBooking.findMany.mockResolvedValue([]);
    mockPrisma.payment.findMany.mockResolvedValue([
      {
        id: "pay-1",
        purpose: "COMMISSION",
        status: "PAID",
        amountAed: 2500,
        provider: "MANUAL_ADMIN_REVIEW",
        providerPaymentRef: "OFFER:offer-1:COMMISSION",
        offerId: "offer-1",
        paidAt: new Date("2026-03-03T00:00:00.000Z"),
        createdAt: new Date("2026-03-03T00:00:00.000Z"),
        rental: null,
        offer: {
          id: "offer-1",
          offerPriceAed: 100000,
          listing: {
            id: "listing-1",
            make: "BMW",
            model: "X5",
            year: 2024,
            paymentModel: "commission",
            commissionRatePct: 2.5,
          },
        },
      },
      {
        id: "pay-2",
        purpose: "COMMISSION",
        status: "PENDING",
        amountAed: 3000,
        provider: "MANUAL_ADMIN_REVIEW",
        providerPaymentRef: "OFFER:offer-2:COMMISSION",
        offerId: "offer-2",
        paidAt: null,
        createdAt: new Date("2026-03-04T00:00:00.000Z"),
        rental: null,
        offer: {
          id: "offer-2",
          offerPriceAed: 200000,
          listing: {
            id: "listing-2",
            make: "Audi",
            model: "A6",
            year: 2023,
            paymentModel: "hybrid",
            commissionRatePct: 1.5,
          },
        },
      },
    ]);

    const response = await request(app).get("/users/seller-1/dashboard/seller/commission-invoices");

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.summary.total).toBe(2);
    expect(response.body.summary.paid).toBe(1);
    expect(response.body.summary.unpaid).toBe(1);
    expect(response.body.summary.expectedCommissionAed).toBe(5500);
    expect(response.body.summary.paidCommissionAed).toBe(2500);
  });

  it("GET /users/:id/dashboard/seller/commission-invoices includes rental fee invoices", async () => {
    const app = createTestApp();

    mockPrisma.jointOffer.findMany.mockResolvedValue([]);
    mockPrisma.rentalBooking.findMany.mockResolvedValue([
      {
        id: "rental-1",
        subtotalAed: 10000,
        listing: {
          commissionRatePct: 12,
        },
      },
    ]);

    mockPrisma.payment.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "payment-rental-1",
          purpose: "RENTAL",
          status: "PENDING",
          amountAed: 1200,
          provider: "MANUAL_ADMIN_REVIEW",
          providerPaymentRef: "RENTAL:rental-1:FEE",
          offerId: null,
          paidAt: null,
          createdAt: new Date("2026-03-10T00:00:00.000Z"),
          offer: null,
          rental: {
            id: "rental-1",
            subtotalAed: 10000,
            totalAed: 10500,
            listing: {
              id: "listing-r-1",
              make: "Toyota",
              model: "Fortuner",
              year: 2024,
              paymentModel: "commission",
              commissionRatePct: 12,
            },
          },
        },
      ]);

    const response = await request(app).get("/users/seller-1/dashboard/seller/commission-invoices");

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].invoiceType).toBe("RENTAL");
    expect(response.body.items[0].commissionRatePct).toBe(12);
    expect(response.body.items[0].expectedCommissionAed).toBe(1200);
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purpose: "RENTAL",
          rentalId: "rental-1",
          amountAed: 1200,
        }),
      })
    );
  });

  it("PATCH /users/:id/dashboard/seller/fee-invoices/:paymentId/confirm-transfer accepts rental fee invoice", async () => {
    const app = createTestApp();

    mockPrisma.payment.findUnique.mockResolvedValue({
      id: "payment-rental-1",
      payerId: "seller-1",
      purpose: "RENTAL",
      status: "PENDING",
      amountAed: 1200,
      providerPaymentRef: "RENTAL:rental-1:FEE",
    });
    mockPrisma.payment.update.mockResolvedValue({ id: "payment-rental-1", provider: "MANUAL_TRANSFER_SUBMITTED" });
    mockPrisma.user.findMany.mockResolvedValue([]);

    const response = await request(app)
      .patch("/users/seller-1/dashboard/seller/fee-invoices/payment-rental-1/confirm-transfer")
      .set("x-test-user-id", "seller-1")
      .send({
        transferReference: "TRX-001",
        transferredAt: "2026-03-20T10:00:00.000Z",
        note: "rental fee payment",
      });

    expect(response.status).toBe(200);
    expect(mockPrisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "payment-rental-1" },
        data: expect.objectContaining({
          provider: "MANUAL_TRANSFER_SUBMITTED",
        }),
      })
    );
  });

  it("GET /users/:id returns 404 when user does not exist", async () => {
    const app = createTestApp();
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const response = await request(app).get("/users/missing-user");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("User not found");
  });

  it("PATCH /users/:id validates payload and rejects invalid fullName", async () => {
    const app = createTestApp();

    const response = await request(app)
      .patch("/users/user-1")
      .send({ fullName: "A" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Validation failed");
  });

  it("PATCH /users/:id updates user status and role", async () => {
    const app = createTestApp();
    mockPrisma.user.update.mockResolvedValue({ id: "user-1", role: "ADMIN", status: "SUSPENDED" });

    const response = await request(app)
      .patch("/users/user-1")
      .send({ role: "ADMIN", status: "SUSPENDED" });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("user-1");
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { role: "ADMIN", status: "SUSPENDED", verificationStatus: "APPROVED" },
      })
    );
  });

  it("PUT /users/:id/identity upserts identity profile with parsed dates", async () => {
    const app = createTestApp();
    mockPrisma.userIdentityProfile.upsert.mockResolvedValue({ id: "identity-1", userId: "user-1" });

    const payload = {
      nationality: "UAE",
      dateOfBirth: "1990-01-01T00:00:00.000Z",
      emiratesIdExpiry: "2030-01-01T00:00:00.000Z",
    };

    const response = await request(app)
      .put("/users/user-1/identity")
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe("identity-1");
    expect(mockPrisma.userIdentityProfile.upsert).toHaveBeenCalledTimes(1);

    const upsertArgs = (mockPrisma.userIdentityProfile.upsert as any).mock.calls[0][0];
    expect(upsertArgs.where.userId).toBe("user-1");
    expect(upsertArgs.create.dateOfBirth).toBeInstanceOf(Date);
    expect(upsertArgs.create.emiratesIdExpiry).toBeInstanceOf(Date);
  });
});
