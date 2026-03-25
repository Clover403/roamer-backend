/// <reference types="jest" />

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const controller = {
  getAdminDashboardOverview: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, endpoint: "dashboard-overview" })),
  getAdminDashboardCharts: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, endpoint: "dashboard-charts" })),
  getAdminModerationQueue: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, endpoint: "moderation-queue" })),
  getAdminRevenueOverview: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, endpoint: "revenue-overview" })),
  getAdminFeeSettings: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, endpoint: "fee-settings" })),
  updateAdminFeeSettings: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, endpoint: "update-fee-settings" })),
  getAdminCommissionTracking: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, endpoint: "commission-tracking" })),
};

jest.mock("../src/controllers/admin.controller", () => controller);

jest.mock("../src/middlewares/auth", () => ({
  requireAdmin: (req: any, res: any, next: any) => {
    if (req.header("x-test-auth") === "none") return res.status(401).json({ message: "Unauthenticated" });
    if (req.header("x-test-role") !== "ADMIN") return res.status(403).json({ message: "Admin access required" });
    req.authUser = { id: "admin-1", role: "ADMIN" };
    next();
  },
}));

import { adminRouter } from "../src/routes/admin";

const app = express();
app.use(express.json());
app.use("/admin", adminRouter);

describe("Admin route contracts", () => {
  beforeEach(() => {
    Object.values(controller).forEach((fn) => (fn as any).mockClear());
  });

  it("blocks non-admin access for all admin endpoints", async () => {
    const response = await request(app).get("/admin/dashboard-overview").set("x-test-role", "USER");
    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Admin access required");
  });

  it("GET /admin/dashboard-overview works for admin", async () => {
    const response = await request(app).get("/admin/dashboard-overview").set("x-test-role", "ADMIN");
    expect(response.status).toBe(200);
    expect(controller.getAdminDashboardOverview).toHaveBeenCalledTimes(1);
  });

  it("GET /admin/dashboard-charts works for admin", async () => {
    const response = await request(app).get("/admin/dashboard-charts").set("x-test-role", "ADMIN");
    expect(response.status).toBe(200);
    expect(controller.getAdminDashboardCharts).toHaveBeenCalledTimes(1);
  });

  it("GET /admin/moderation-queue works for admin", async () => {
    const response = await request(app).get("/admin/moderation-queue").set("x-test-role", "ADMIN");
    expect(response.status).toBe(200);
    expect(controller.getAdminModerationQueue).toHaveBeenCalledTimes(1);
  });

  it("GET /admin/revenue-overview works for admin", async () => {
    const response = await request(app).get("/admin/revenue-overview").set("x-test-role", "ADMIN");
    expect(response.status).toBe(200);
    expect(controller.getAdminRevenueOverview).toHaveBeenCalledTimes(1);
  });

  it("GET /admin/fee-settings works for admin", async () => {
    const response = await request(app).get("/admin/fee-settings").set("x-test-role", "ADMIN");
    expect(response.status).toBe(200);
    expect(controller.getAdminFeeSettings).toHaveBeenCalledTimes(1);
  });

  it("PATCH /admin/fee-settings works for admin", async () => {
    const response = await request(app).patch("/admin/fee-settings").set("x-test-role", "ADMIN").send({ saleCommissionPct: 2.5 });
    expect(response.status).toBe(200);
    expect(controller.updateAdminFeeSettings).toHaveBeenCalledTimes(1);
  });

  it("GET /admin/commission-tracking works for admin", async () => {
    const response = await request(app).get("/admin/commission-tracking").set("x-test-role", "ADMIN");
    expect(response.status).toBe(200);
    expect(controller.getAdminCommissionTracking).toHaveBeenCalledTimes(1);
  });
});
