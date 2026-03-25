/// <reference types="jest" />

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const controller = {
  listConversations: jest.fn((_: any, res: any) => res.status(200).json([])),
  createConversation: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  listConversationMessages: jest.fn((_: any, res: any) => res.status(200).json([])),
  createConversationMessage: jest.fn((_: any, res: any) => res.status(201).json({ ok: true })),
  uploadConversationMessageMedia: jest.fn((req: any, res: any) => res.status(201).json({ ok: true, file: req.file?.originalname ?? null })),
  markConversationRead: jest.fn((_: any, res: any) => res.status(200).json({ ok: true })),
};

jest.mock("../src/controllers/conversations.controller", () => controller);

import { conversationsRouter } from "../src/routes/conversations";

const app = express();
app.use(express.json());
app.use("/conversations", conversationsRouter);

describe("Conversations route contracts", () => {
  beforeEach(() => {
    Object.values(controller).forEach((fn) => (fn as any).mockClear());
  });

  it("supports list/create conversation and message flows", async () => {
    const list = await request(app).get("/conversations");
    const create = await request(app).post("/conversations").send({ channelType: "DIRECT" });
    const messages = await request(app).get("/conversations/c-1/messages");
    const createMsg = await request(app).post("/conversations/c-1/messages").send({ senderId: "u1", content: "hi" });
    const read = await request(app).patch("/conversations/c-1/read").send({ userId: "u1" });

    expect(list.status).toBe(200);
    expect(create.status).toBe(201);
    expect(messages.status).toBe(200);
    expect(createMsg.status).toBe(201);
    expect(read.status).toBe(200);

    expect(controller.listConversations).toHaveBeenCalledTimes(1);
    expect(controller.createConversation).toHaveBeenCalledTimes(1);
    expect(controller.listConversationMessages).toHaveBeenCalledTimes(1);
    expect(controller.createConversationMessage).toHaveBeenCalledTimes(1);
    expect(controller.markConversationRead).toHaveBeenCalledTimes(1);
  });

  it("supports upload message media as multipart", async () => {
    const upload = await request(app)
      .post("/conversations/c-1/messages/upload")
      .field("senderId", "u1")
      .attach("file", Buffer.from("image-data"), "chat.png");

    expect(upload.status).toBe(201);
    expect(upload.body.file).toBe("chat.png");
    expect(controller.uploadConversationMessageMedia).toHaveBeenCalledTimes(1);
  });
});
