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

    mockPrisma.jointOffer.findMany.mockResolvedValue([
      {
        id: "offer-1",
        offerPriceAed: 100000,
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
        updatedAt: new Date("2026-03-02T00:00:00.000Z"),
        listing: {
          id: "listing-1",
          make: "BMW",
          model: "X5",
          year: 2024,
          paymentModel: "commission",
          commissionRatePct: 2.5,
          sellerId: "seller-1",
        },
        payments: [
          {
            id: "pay-1",
            status: "PAID",
            amountAed: 2500,
            paidAt: new Date("2026-03-03T00:00:00.000Z"),
            createdAt: new Date("2026-03-03T00:00:00.000Z"),
            providerPaymentRef: "REF-123",
          },
        ],
      },
      {
        id: "offer-2",
        offerPriceAed: 200000,
        createdAt: new Date("2026-03-04T00:00:00.000Z"),
        updatedAt: new Date("2026-03-05T00:00:00.000Z"),
        listing: {
          id: "listing-2",
          make: "Audi",
          model: "A6",
          year: 2023,
          paymentModel: "hybrid",
          commissionRatePct: 1.5,
          sellerId: "seller-1",
        },
        payments: [],
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
        data: { role: "ADMIN", status: "SUSPENDED" },
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
