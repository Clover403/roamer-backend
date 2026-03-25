/// <reference types="jest" />

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const controller = {
  listMyGarageAssets: jest.fn((_: any, res: any) => res.status(200).json([])),
  createMyGarageAsset: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  updateMyGarageAsset: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  updateGarageLatestValue: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
};

jest.mock("../src/controllers/garage.controller", () => controller);

jest.mock("../src/middlewares/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.header("x-test-auth") === "none") return res.status(401).json({ message: "Unauthenticated" });
    req.authUser = { id: "user-1", role: "USER" };
    next();
  },
}));

import { garageRouter } from "../src/routes/garage";

const app = express();
app.use(express.json());
app.use("/garage", garageRouter);

describe("Garage route contracts", () => {
  beforeEach(() => {
    Object.values(controller).forEach((fn) => (fn as any).mockClear());
  });

  it("all garage endpoints require auth", async () => {
    const endpoints = [
      request(app).get("/garage/my-assets").set("x-test-auth", "none"),
      request(app).post("/garage/my-assets").set("x-test-auth", "none"),
      request(app).patch("/garage/my-assets/l-1").set("x-test-auth", "none"),
      request(app).patch("/garage/latest-value").set("x-test-auth", "none"),
    ];

    const responses = await Promise.all(endpoints);
    responses.forEach((response) => {
      expect(response.status).toBe(401);
      expect(response.body.message).toBe("Unauthenticated");
    });
  });

  it("authenticated requests should reach controller", async () => {
    const list = await request(app).get("/garage/my-assets");
    const create = await request(app).post("/garage/my-assets").send({ make: "BMW" });
    const update = await request(app).patch("/garage/my-assets/l-1").send({ model: "X5" });
    const latest = await request(app).patch("/garage/latest-value").send({ listingId: "l-1", latestValue: 1 });

    expect(list.status).toBe(200);
    expect(create.status).toBe(201);
    expect(update.status).toBe(200);
    expect(latest.status).toBe(200);

    expect(controller.listMyGarageAssets).toHaveBeenCalledTimes(1);
    expect(controller.createMyGarageAsset).toHaveBeenCalledTimes(1);
    expect(controller.updateMyGarageAsset).toHaveBeenCalledTimes(1);
    expect(controller.updateGarageLatestValue).toHaveBeenCalledTimes(1);
  });
});
