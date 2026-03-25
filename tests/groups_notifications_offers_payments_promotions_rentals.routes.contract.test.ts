/// <reference types="jest" />

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const groupsController = {
  listGroups: jest.fn((_: any, res: any) => res.status(200).json([])),
  createGroup: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  getGroupById: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  addGroupMember: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  confirmGroupMemberTerms: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  removeGroupMember: jest.fn((_: any, res: any) => res.status(204).send()),
  deleteGroup: jest.fn((_: any, res: any) => res.status(204).send()),
  createGroupInvitation: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  updateInvitationStatus: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
};

const notificationsController = {
  listNotificationsByUser: jest.fn((_: any, res: any) => res.status(200).json([])),
  createNotification: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  markNotificationAsRead: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  markAllNotificationsAsRead: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  deleteNotificationById: jest.fn((_: any, res: any) => res.status(204).send()),
  deleteAllNotificationsByUser: jest.fn((_: any, res: any) => res.status(204).send()),
};

const offersController = {
  listOffers: jest.fn((_: any, res: any) => res.status(200).json([])),
  createOffer: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  updateOffer: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  updateOfferParticipantDecision: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
};

const paymentsController = {
  listPayments: jest.fn((_: any, res: any) => res.status(200).json([])),
  createPayment: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  updatePaymentStatus: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
};

const promotionsController = {
  listPromotions: jest.fn((_: any, res: any) => res.status(200).json([])),
  createPromotion: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  updatePromotionStatus: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
};

const rentalsController = {
  listRentals: jest.fn((_: any, res: any) => res.status(200).json([])),
  createRental: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  sellerDecisionRental: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  confirmRentalHandoverBySeller: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  cancelRentalByRenter: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  submitRentalPayment: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  confirmRentalPayment: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  dispatchRental: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  confirmRentalReceived: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
  runRentalCronNow: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
};

jest.mock("../src/controllers/groups.controller", () => groupsController);
jest.mock("../src/controllers/notifications.controller", () => notificationsController);
jest.mock("../src/controllers/offers.controller", () => offersController);
jest.mock("../src/controllers/payments.controller", () => paymentsController);
jest.mock("../src/controllers/promotions.controller", () => promotionsController);
jest.mock("../src/controllers/rentals.controller", () => rentalsController);

jest.mock("../src/middlewares/auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.header("x-test-auth") === "none") return res.status(401).json({ message: "Unauthenticated" });
    req.authUser = { id: "user-1", role: req.header("x-test-role") || "USER" };
    next();
  },
}));

import { groupsRouter } from "../src/routes/groups";
import { notificationsRouter } from "../src/routes/notifications";
import { offersRouter } from "../src/routes/offers";
import { paymentsRouter } from "../src/routes/payments";
import { promotionsRouter } from "../src/routes/promotions";
import { rentalsRouter } from "../src/routes/rentals";

const app = express();
app.use(express.json());
app.use("/groups", groupsRouter);
app.use("/notifications", notificationsRouter);
app.use("/offers", offersRouter);
app.use("/payments", paymentsRouter);
app.use("/promotions", promotionsRouter);
app.use("/rentals", rentalsRouter);

describe("Route contracts for groups/notifications/offers/payments/promotions/rentals", () => {
  beforeEach(() => {
    [...Object.values(groupsController), ...Object.values(notificationsController), ...Object.values(offersController), ...Object.values(paymentsController), ...Object.values(promotionsController), ...Object.values(rentalsController)].forEach((fn) => (fn as any).mockClear());
  });

  it("groups route matrix works and createGroup requires auth", async () => {
    const blockedCreate = await request(app).post("/groups").set("x-test-auth", "none");
    expect(blockedCreate.status).toBe(401);

    const responses = await Promise.all([
      request(app).get("/groups"),
      request(app).post("/groups"),
      request(app).get("/groups/g-1"),
      request(app).post("/groups/g-1/members"),
      request(app).patch("/groups/g-1/members/u-1/confirm"),
      request(app).delete("/groups/g-1/members/u-1"),
      request(app).delete("/groups/g-1"),
      request(app).post("/groups/g-1/invitations"),
      request(app).patch("/groups/invitations/inv-1"),
    ]);

    responses.forEach((r) => expect([200, 201, 204]).toContain(r.status));
    expect(groupsController.listGroups).toHaveBeenCalledTimes(1);
    expect(groupsController.createGroup).toHaveBeenCalledTimes(1);
  });

  it("notifications route matrix works", async () => {
    const responses = await Promise.all([
      request(app).get("/notifications/user-1"),
      request(app).post("/notifications"),
      request(app).patch("/notifications/notif-1/read"),
      request(app).patch("/notifications/user/user-1/read-all"),
      request(app).delete("/notifications/notif-1"),
      request(app).delete("/notifications/user/user-1"),
    ]);

    responses.forEach((r) => expect([200, 201, 204]).toContain(r.status));
    expect(notificationsController.listNotificationsByUser).toHaveBeenCalledTimes(1);
    expect(notificationsController.markAllNotificationsAsRead).toHaveBeenCalledTimes(1);
  });

  it("offers/payments/promotions route matrices work", async () => {
    const offersResponses = await Promise.all([
      request(app).get("/offers"),
      request(app).post("/offers"),
      request(app).patch("/offers/of-1"),
      request(app).patch("/offers/of-1/participants/u-1"),
    ]);

    const paymentsResponses = await Promise.all([
      request(app).get("/payments"),
      request(app).post("/payments"),
      request(app).patch("/payments/pay-1/status"),
    ]);

    const promotionsResponses = await Promise.all([
      request(app).get("/promotions"),
      request(app).post("/promotions"),
      request(app).patch("/promotions/pro-1/status"),
    ]);

    [...offersResponses, ...paymentsResponses, ...promotionsResponses].forEach((r) => expect([200, 201]).toContain(r.status));

    expect(offersController.updateOfferParticipantDecision).toHaveBeenCalledTimes(1);
    expect(paymentsController.updatePaymentStatus).toHaveBeenCalledTimes(1);
    expect(promotionsController.updatePromotionStatus).toHaveBeenCalledTimes(1);
  });

  it("rentals route matrix works and createRental requires auth", async () => {
    const blockedCreate = await request(app).post("/rentals").set("x-test-auth", "none");
    expect(blockedCreate.status).toBe(401);

    const responses = await Promise.all([
      request(app).get("/rentals"),
      request(app).post("/rentals"),
      request(app).patch("/rentals/r-1/seller-decision"),
      request(app).patch("/rentals/r-1/handover-confirmation"),
      request(app).patch("/rentals/r-1/cancel"),
      request(app).patch("/rentals/r-1/payment-submission"),
      request(app).patch("/rentals/r-1/payment-confirmation"),
      request(app).patch("/rentals/r-1/dispatch"),
      request(app).patch("/rentals/r-1/confirm-received"),
      request(app).post("/rentals/cron/run"),
    ]);

    responses.forEach((r) => expect([200, 201]).toContain(r.status));
    expect(rentalsController.listRentals).toHaveBeenCalledTimes(1);
    expect(rentalsController.runRentalCronNow).toHaveBeenCalledTimes(1);
  });
});
