/// <reference types="jest" />

import express from "express";
import request from "supertest";
import { describe, expect, it, jest } from "@jest/globals";

const handlers = {
  register: jest.fn((_: any, res: any) => res.status(201).json({ ok: true, action: "register" })),
  login: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, action: "login" })),
  forgotPassword: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, action: "forgot-password" })),
  resetPassword: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, action: "reset-password" })),
  resendEmailVerification: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, action: "resend-email-verification" })),
  verifyEmail: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, action: "verify-email" })),
  googleAuthStart: jest.fn((_: any, res: any) => res.status(302).json({ ok: true, action: "google-start" })),
  googleAuthCallback: jest.fn((_: any, res: any) => res.status(302).json({ ok: true, action: "google-callback" })),
  me: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, action: "me" })),
  logout: jest.fn((_: any, res: any) => res.status(200).json({ ok: true, action: "logout" })),
};

jest.mock("../src/controllers/auth.controller", () => handlers);

import { authRouter } from "../src/routes/auth";

const app = express();
app.use(express.json());
app.use("/auth", authRouter);

describe("Auth route contracts", () => {
  it("POST /auth/register calls register controller", async () => {
    const response = await request(app).post("/auth/register").send({ email: "a@a.com", password: "123456" });
    expect(response.status).toBe(201);
    expect(handlers.register).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/login calls login controller", async () => {
    const response = await request(app).post("/auth/login").send({ email: "a@a.com", password: "123456" });
    expect(response.status).toBe(200);
    expect(handlers.login).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/forgot-password calls forgotPassword controller", async () => {
    const response = await request(app).post("/auth/forgot-password").send({ email: "a@a.com" });
    expect(response.status).toBe(200);
    expect(handlers.forgotPassword).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/reset-password calls resetPassword controller", async () => {
    const response = await request(app).post("/auth/reset-password").send({ token: "token", password: "123456" });
    expect(response.status).toBe(200);
    expect(handlers.resetPassword).toHaveBeenCalledTimes(1);
  });

  it("GET /auth/me calls me controller", async () => {
    const response = await request(app).get("/auth/me");
    expect(response.status).toBe(200);
    expect(handlers.me).toHaveBeenCalledTimes(1);
  });

  it("POST /auth/logout calls logout controller", async () => {
    const response = await request(app).post("/auth/logout");
    expect(response.status).toBe(200);
    expect(handlers.logout).toHaveBeenCalledTimes(1);
  });
});
