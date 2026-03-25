/// <reference types="jest" />

import express from "express";
import request from "supertest";
import { describe, expect, it } from "@jest/globals";

describe("Health and route index contracts", () => {
  it("health route responds successfully", async () => {
    const { healthRouter } = await import("../src/routes/health");
    const app = express();
    app.use("/health", healthRouter);

    const response = await request(app).get("/health");
    expect([200, 503]).toContain(response.status);
  });

  it("index router mounts all modules without crash and serves /health", async () => {
    const { apiRouter } = await import("../src/routes/index");
    const app = express();
    app.use(apiRouter);

    const response = await request(app).get("/health");
    expect([200, 503]).toContain(response.status);
  });
});
