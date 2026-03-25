/// <reference types="jest" />

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const controller = {
  getBannerAdSlots: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  listActiveBannerAds: jest.fn((_: any, res: any) => res.status(200).json([])),
  listMyBannerAds: jest.fn((_: any, res: any) => res.status(200).json([])),
  uploadBannerAdImage: jest.fn((req: any, res: any) => res.status(201).json({ ok: true, file: req.file?.originalname ?? null })),
  createBannerAd: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  listBannerAdsForAdmin: jest.fn((_: any, res: any) => res.status(200).json([])),
  adminActivateBannerAd: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  adminRejectBannerAd: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
};

jest.mock("../src/controllers/ads.controller", () => controller);

jest.mock("../src/middlewares/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.header("x-test-auth") === "none") return res.status(401).json({ message: "Unauthenticated" });
    req.authUser = { id: "user-1", role: req.header("x-test-role") || "USER" };
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (req.header("x-test-auth") === "none") return res.status(401).json({ message: "Unauthenticated" });
    if (req.header("x-test-role") !== "ADMIN") return res.status(403).json({ message: "Admin access required" });
    req.authUser = { id: "admin-1", role: "ADMIN" };
    next();
  },
}));

import { adsRouter } from "../src/routes/ads";

const app = express();
app.use(express.json());
app.use("/ads", adsRouter);

describe("Ads route contracts", () => {
  beforeEach(() => {
    Object.values(controller).forEach((fn) => (fn as any).mockClear());
  });

  it("public endpoints should be accessible", async () => {
    const slots = await request(app).get("/ads/slots");
    const active = await request(app).get("/ads/active");

    expect(slots.status).toBe(200);
    expect(active.status).toBe(200);
    expect(controller.getBannerAdSlots).toHaveBeenCalledTimes(1);
    expect(controller.listActiveBannerAds).toHaveBeenCalledTimes(1);
  });

  it("requires auth for /ads/my-ads and /ads upload/create", async () => {
    const myAds = await request(app).get("/ads/my-ads").set("x-test-auth", "none");
    const upload = await request(app).post("/ads/upload").set("x-test-auth", "none");
    const create = await request(app).post("/ads").set("x-test-auth", "none");

    expect(myAds.status).toBe(401);
    expect(upload.status).toBe(401);
    expect(create.status).toBe(401);
  });

  it("authenticated upload endpoint accepts multipart file", async () => {
    const response = await request(app)
      .post("/ads/upload")
      .attach("file", Buffer.from("banner"), "banner.png");

    expect(response.status).toBe(201);
    expect(controller.uploadBannerAdImage).toHaveBeenCalledTimes(1);
    expect(response.body.file).toBe("banner.png");
  });

  it("admin endpoints reject non-admin and pass for admin", async () => {
    const blocked = await request(app).get("/ads").set("x-test-role", "USER");
    expect(blocked.status).toBe(403);

    const adminList = await request(app).get("/ads").set("x-test-role", "ADMIN");
    const adminActivate = await request(app).patch("/ads/ad-1/admin-activate").set("x-test-role", "ADMIN");
    const adminReject = await request(app).patch("/ads/ad-1/admin-reject").set("x-test-role", "ADMIN").send({ reason: "bad" });

    expect(adminList.status).toBe(200);
    expect(adminActivate.status).toBe(200);
    expect(adminReject.status).toBe(200);
    expect(controller.listBannerAdsForAdmin).toHaveBeenCalledTimes(1);
    expect(controller.adminActivateBannerAd).toHaveBeenCalledTimes(1);
    expect(controller.adminRejectBannerAd).toHaveBeenCalledTimes(1);
  });
});
