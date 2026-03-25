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

import { verificationRouter } from "../src/routes/verifications";
import { mockPrisma } from "./helpers/mockPrisma";

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/verifications", verificationRouter);

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

describe("Verification endpoints", () => {
  beforeEach(() => {
    resetMockPrisma();
  });

  it("GET /verifications/me returns 401 when unauthenticated", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/verifications/me")
      .set("x-test-auth", "none");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Unauthenticated" });
  });

  it("GET /verifications/me returns 404 when user does not exist", async () => {
    const app = createTestApp();
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const response = await request(app).get("/verifications/me");

    expect(response.status).toBe(404);
    expect(response.body.message).toBe("User not found");
  });

  it("GET /verifications/me returns latest submission and verification status", async () => {
    const app = createTestApp();
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      verificationStatus: "PENDING",
      verificationSubmissions: [
        {
          id: "sub-1",
          status: "PENDING",
          submittedAt: new Date("2026-03-24T10:00:00.000Z"),
          documents: [{ id: "doc-1", documentType: "PASSPORT", fileUrl: "/uploads/verifications/passport.png" }],
        },
      ],
    });

    const response = await request(app).get("/verifications/me");

    expect(response.status).toBe(200);
    expect(response.body.userId).toBe("user-1");
    expect(response.body.verificationStatus).toBe("PENDING");
    expect(response.body.latestSubmission.id).toBe("sub-1");
  });

  it("POST /verifications/submissions returns 400 when required documents are missing", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/verifications/submissions")
      .send({
        documents: [
          { documentType: "EMIRATES_ID_FRONT", fileUrl: "/uploads/verifications/front.png" },
          { documentType: "SELFIE", fileUrl: "/uploads/verifications/selfie.png" },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Missing required documents");
  });

  it("POST /verifications/submissions returns 409 when pending submission already exists", async () => {
    const app = createTestApp();
    mockPrisma.verificationSubmission.findFirst.mockResolvedValue({ id: "sub-pending" });

    const response = await request(app)
      .post("/verifications/submissions")
      .send({
        documents: [
          { documentType: "EMIRATES_ID_FRONT", fileUrl: "/uploads/verifications/front.png" },
          { documentType: "EMIRATES_ID_BACK", fileUrl: "/uploads/verifications/back.png" },
          { documentType: "DRIVING_LICENSE", fileUrl: "/uploads/verifications/license.png" },
          { documentType: "PASSPORT", fileUrl: "/uploads/verifications/passport.png" },
        ],
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe("You already have a pending verification submission");
  });

  it("POST /verifications/submissions creates submission and notifications", async () => {
    const app = createTestApp();
    mockPrisma.verificationSubmission.findFirst.mockResolvedValue(null);
    mockPrisma.verificationSubmission.create.mockResolvedValue({
      id: "sub-created",
      userId: "user-1",
      status: "PENDING",
      documents: [],
    });
    mockPrisma.user.update.mockResolvedValue({ id: "user-1" });
    mockPrisma.userIdentityProfile.upsert.mockResolvedValue({ id: "identity-1" });
    mockPrisma.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
    mockPrisma.notification.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.notification.create.mockResolvedValue({ id: "notif-user" });

    const response = await request(app)
      .post("/verifications/submissions")
      .send({
        documents: [
          { documentType: "EMIRATES_ID_FRONT", fileUrl: "/uploads/verifications/front.png", mimeType: "image/png", fileSizeBytes: 1000 },
          { documentType: "EMIRATES_ID_BACK", fileUrl: "/uploads/verifications/back.png", mimeType: "image/png", fileSizeBytes: 1000 },
          { documentType: "DRIVING_LICENSE", fileUrl: "/uploads/verifications/license.png", mimeType: "image/png", fileSizeBytes: 1000 },
          { documentType: "PASSPORT", fileUrl: "/uploads/verifications/passport.png", mimeType: "image/png", fileSizeBytes: 1000 },
        ],
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe("sub-created");
    expect(mockPrisma.user.update).toHaveBeenCalled();
    expect(mockPrisma.userIdentityProfile.upsert).toHaveBeenCalled();
    expect(mockPrisma.notification.createMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it("GET /verifications/submissions blocks non-admin users", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/verifications/submissions")
      .set("x-test-role", "USER");

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Admin access required");
  });

  it("GET /verifications/submissions returns submissions for admin", async () => {
    const app = createTestApp();
    mockPrisma.verificationSubmission.findMany.mockResolvedValue([
      { id: "sub-1", status: "PENDING", user: { id: "user-1" }, documents: [] },
      { id: "sub-2", status: "APPROVED", user: { id: "user-2" }, documents: [] },
    ]);

    const response = await request(app)
      .get("/verifications/submissions")
      .set("x-test-role", "ADMIN");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(mockPrisma.verificationSubmission.findMany).toHaveBeenCalledTimes(1);
  });

  it("PATCH /verifications/submissions/:id/review validates rejection reason", async () => {
    const app = createTestApp();

    const response = await request(app)
      .patch("/verifications/submissions/sub-1/review")
      .set("x-test-role", "ADMIN")
      .send({ status: "REJECTED" });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Validation failed");
  });

  it("PATCH /verifications/submissions/:id/review updates statuses and notifies user", async () => {
    const app = createTestApp();

    mockPrisma.verificationSubmission.update.mockResolvedValue({
      id: "sub-1",
      userId: "user-1",
      user: { id: "user-1" },
    });
    mockPrisma.user.update.mockResolvedValue({ id: "user-1" });
    mockPrisma.userIdentityProfile.upsert.mockResolvedValue({ id: "identity-1" });
    mockPrisma.notification.create.mockResolvedValue({ id: "notif-1" });

    const response = await request(app)
      .patch("/verifications/submissions/sub-1/review")
      .set("x-test-role", "ADMIN")
      .send({ status: "REJECTED", reviewerNotes: "Document blur" });

    expect(response.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { verificationStatus: "REJECTED" },
      })
    );
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it("POST /verifications/documents/upload returns 400 when file is missing", async () => {
    const app = createTestApp();

    const response = await request(app).post("/verifications/documents/upload");

    expect(response.status).toBe(400);
    expect(response.body.message).toBe("File is required");
  });

  it("POST /verifications/documents/upload uploads file and returns metadata", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/verifications/documents/upload")
      .attach("file", Buffer.from("fake-image"), "verification.png");

    expect(response.status).toBe(201);
    expect(response.body.url).toContain("/uploads/verifications/");
    expect(response.body.mimeType).toBeDefined();
    expect(response.body.fileSizeBytes).toBeGreaterThan(0);
  });
});
