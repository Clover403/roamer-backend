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
      id: req.header("x-test-user-id") || "seller-1",
      role: req.header("x-test-role") || "USER",
    };

    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (req.header("x-test-auth") === "none") {
      res.status(401).json({ message: "Unauthenticated" });
      return;
    }

    if ((req.header("x-test-role") || "USER") !== "ADMIN") {
      res.status(403).json({ message: "Admin access required" });
      return;
    }

    req.authUser = {
      id: req.header("x-test-user-id") || "admin-1",
      role: "ADMIN",
    };

    next();
  },
}));

const mockEnsurePlatformFeeSettings = jest.fn<(...args: any[]) => any>();
const mockMapPlatformFeeSettings = jest.fn<(...args: any[]) => any>();
const mockGetUserVerificationGate = jest.fn<(...args: any[]) => any>();
const mockPurgeCancelledGroups = jest.fn<(...args: any[]) => any>();

jest.mock("../src/lib/platform-fees", () => ({
  ensurePlatformFeeSettings: () => mockEnsurePlatformFeeSettings(),
  mapPlatformFeeSettings: (value: any) => mockMapPlatformFeeSettings(value),
}));

jest.mock("../src/lib/identity-verification", () => ({
  getUserVerificationGate: (...args: any[]) => mockGetUserVerificationGate(...args),
}));

jest.mock("../src/lib/group-lifecycle", () => ({
  purgeCancelledGroups: (...args: any[]) => mockPurgeCancelledGroups(...args),
}));

import { listingsRouter } from "../src/routes/listings";
import { mockPrisma } from "./helpers/mockPrisma";

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/listings", listingsRouter);

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

describe("Listings endpoints", () => {
  beforeEach(() => {
    resetMockPrisma();
    mockEnsurePlatformFeeSettings.mockReset();
    mockMapPlatformFeeSettings.mockReset();
    mockGetUserVerificationGate.mockReset();
    mockPurgeCancelledGroups.mockReset();

    mockMapPlatformFeeSettings.mockReturnValue({
      saleCommissionPct: 2.5,
      rentalFeePct: 12,
      listingFeePct: 1,
      hybridCommissionPct: 1.5,
      hybridListingFeeAed: 149,
    });
    mockEnsurePlatformFeeSettings.mockResolvedValue({ id: "fee-1" });
  });

  it("GET /listings returns list and always excludes manual garage assets in where clause", async () => {
    const app = createTestApp();

    mockPrisma.listing.findMany.mockResolvedValue([
      {
        id: "listing-1",
        make: "BMW",
        model: "X5",
        status: "ACTIVE",
        listingType: "SELL",
        category: "CARS",
        media: [],
        seller: { id: "seller-1", fullName: "Seller One" },
        _count: { groups: 2 },
      },
    ]);
    mockPrisma.listing.count.mockResolvedValue(1);

    const response = await request(app)
      .get("/listings")
      .query({ q: "bmw", verificationType: "ROAMER", page: 1, limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].groupsActive).toBe(2);

    const findManyArgs = (mockPrisma.listing.findMany as any).mock.calls[0][0];
    expect(findManyArgs.where.garageAssets).toEqual({
      none: {
        assetType: "OWNED",
        notes: "Created from Add to Garage",
      },
    });
    expect(mockPurgeCancelledGroups).toHaveBeenCalledTimes(1);
  });

  it("POST /listings returns 401 when unauthenticated", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/listings")
      .set("x-test-auth", "none")
      .send({
        assetClass: "CAR",
        category: "CARS",
        listingType: "SELL",
      });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Unauthenticated");
  });

  it("POST /listings blocks users with pending verification", async () => {
    const app = createTestApp();

    mockGetUserVerificationGate.mockResolvedValue({
      allowed: false,
      status: "PENDING",
      rejectionReason: null,
    });

    const response = await request(app)
      .post("/listings")
      .send({
        assetClass: "CAR",
        category: "CARS",
        listingType: "SELL",
      });

    expect(response.status).toBe(403);
    expect(response.body.verificationStatus).toBe("PENDING");
  });

  it("POST /listings blocks rejected verification with reason", async () => {
    const app = createTestApp();

    mockGetUserVerificationGate.mockResolvedValue({
      allowed: false,
      status: "REJECTED",
      rejectionReason: "Photo is blurry",
    });

    const response = await request(app)
      .post("/listings")
      .send({
        assetClass: "CAR",
        category: "CARS",
        listingType: "SELL",
      });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain("Reason: Photo is blurry");
  });

  it("POST /listings creates SELL listing with commission model defaults", async () => {
    const app = createTestApp();

    mockGetUserVerificationGate.mockResolvedValue({ allowed: true, status: "APPROVED", rejectionReason: null });
    mockPrisma.listing.create.mockResolvedValue({ id: "listing-created" });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "admin-1" }]);
    mockPrisma.notification.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.notification.create.mockResolvedValue({ id: "notif-user-1" });

    const response = await request(app)
      .post("/listings")
      .send({
        assetClass: "CAR",
        category: "CARS",
        listingType: "SELL",
        make: "Audi",
        model: "A6",
        priceSellAed: 200000,
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe("listing-created");

    const createPayload = (mockPrisma.listing.create as any).mock.calls[0][0].data;
    expect(createPayload.paymentModel).toBe("commission");
    expect(createPayload.commissionRatePct).toBe(2.5);
    expect(createPayload.listingFeeAed).toBeUndefined();
    expect(createPayload.status).toBe("DRAFT");
    expect(createPayload.moderationStatus).toBe("PENDING");
  });

  it("POST /listings creates RENT listing with rental commission and no listing fee", async () => {
    const app = createTestApp();

    mockGetUserVerificationGate.mockResolvedValue({ allowed: true, status: "APPROVED", rejectionReason: null });
    mockPrisma.listing.create.mockResolvedValue({ id: "rent-listing-created" });
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.notification.create.mockResolvedValue({ id: "notif-user-2" });

    const response = await request(app)
      .post("/listings")
      .send({
        assetClass: "CAR",
        category: "CARS",
        listingType: "RENT",
        make: "Tesla",
        model: "Model 3",
        rentPriceDayAed: 500,
        paymentModel: "listing_fee",
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe("rent-listing-created");

    const createPayload = (mockPrisma.listing.create as any).mock.calls[0][0].data;
    expect(createPayload.paymentModel).toBe("commission");
    expect(createPayload.commissionRatePct).toBe(12);
    expect(createPayload.listingFeeAed).toBeUndefined();
  });

  it("POST /listings with listing_fee model computes listing fee by percentage", async () => {
    const app = createTestApp();

    mockGetUserVerificationGate.mockResolvedValue({ allowed: true, status: "APPROVED", rejectionReason: null });
    mockPrisma.listing.create.mockResolvedValue({ id: "listing-fee-model" });
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.notification.create.mockResolvedValue({ id: "notif-user-3" });

    const response = await request(app)
      .post("/listings")
      .send({
        assetClass: "CAR",
        category: "CARS",
        listingType: "SELL",
        make: "Porsche",
        model: "Cayenne",
        priceSellAed: 300000,
        paymentModel: "listing_fee",
      });

    expect(response.status).toBe(201);

    const createPayload = (mockPrisma.listing.create as any).mock.calls[0][0].data;
    expect(createPayload.paymentModel).toBe("listing_fee");
    expect(createPayload.commissionRatePct).toBe(0);
    expect(createPayload.listingFeeAed).toBe(3000);
  });

  it("POST /listings supports all asset classes (car/truck/bike/part/plate)", async () => {
    const app = createTestApp();

    mockGetUserVerificationGate.mockResolvedValue({ allowed: true, status: "APPROVED", rejectionReason: null });
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.notification.create.mockResolvedValue({ id: "notif-user-multi" });
    mockPrisma.listing.create.mockImplementation(async ({ data }: any) => ({
      id: `listing-${String(data.assetClass).toLowerCase()}`,
    }));

    const scenarios = [
      {
        name: "CAR",
        payload: {
          assetClass: "CAR",
          category: "CARS",
          listingType: "SELL",
          make: "BMW",
          model: "M4",
          year: 2022,
          priceSellAed: 320000,
        },
      },
      {
        name: "TRUCK",
        payload: {
          assetClass: "TRUCK",
          category: "TRUCKS",
          listingType: "SELL",
          make: "Ford",
          model: "Ranger",
          year: 2021,
          truckPayloadKg: 1200,
          priceSellAed: 180000,
        },
      },
      {
        name: "BIKE",
        payload: {
          assetClass: "BIKE",
          category: "BIKES",
          listingType: "SELL",
          make: "Yamaha",
          model: "R1",
          year: 2023,
          bikeType: "Sport",
          priceSellAed: 95000,
        },
      },
      {
        name: "PART",
        payload: {
          assetClass: "PART",
          category: "PARTS",
          listingType: "SELL",
          partName: "Performance Exhaust",
          partCategory: "Exhaust",
          partBrand: "Akrapovic",
          priceSellAed: 4500,
        },
      },
      {
        name: "PLATE",
        payload: {
          assetClass: "PLATE",
          category: "PLATES",
          listingType: "SELL",
          plateCode: "A",
          plateNumber: "12345",
          plateEmirate: "Dubai",
          priceSellAed: 70000,
        },
      },
    ] as const;

    for (const scenario of scenarios) {
      const response = await request(app).post("/listings").send(scenario.payload);
      expect(response.status).toBe(201);
      expect(response.body.id).toBeTruthy();
    }

    const createCalls = (mockPrisma.listing.create as any).mock.calls;
    expect(createCalls).toHaveLength(5);

    const assetClassesSaved = createCalls.map((call: any) => call[0].data.assetClass);
    expect(assetClassesSaved).toEqual(["CAR", "TRUCK", "BIKE", "PART", "PLATE"]);
  });
});
