import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const listConversations = async (_req: Request, res: Response) => {
  const items = await prisma.conversation.findMany({
    include: {
      participants: { include: { user: true } },
      messages: {
        take: 20,
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  res.status(200).json(items);
};

export const createConversation = async (req: Request, res: Response) => {
  const payload = z
    .object({
      channelType: z.enum(["GROUP", "DIRECT", "SUPPORT"]),
      title: z.string().optional(),
      listingId: z.string().optional(),
      groupId: z.string().optional(),
      rentalId: z.string().optional(),
      participantUserIds: z.array(z.string()).default([]),
    })
    .parse(req.body);

  const conversation = await prisma.conversation.create({
    data: {
      channelType: payload.channelType,
      title: payload.title,
      listingId: payload.listingId,
      groupId: payload.groupId,
      rentalId: payload.rentalId,
      participants: {
        create: payload.participantUserIds.map((userId) => ({ userId })),
      },
    },
    include: { participants: true },
  });

  res.status(201).json(conversation);
};

export const listConversationMessages = async (req: Request<{ id: string }>, res: Response) => {
  const conversationId = String(req.params.id);
  const messages = await prisma.message.findMany({
    where: { conversationId },
    include: { sender: true },
    orderBy: { createdAt: "asc" },
  });

  res.status(200).json(messages);
};

export const createConversationMessage = async (req: Request<{ id: string }>, res: Response) => {
  const conversationId = String(req.params.id);
  const payload = z
    .object({
      senderId: z.string().min(1),
      messageType: z.enum(["TEXT", "IMAGE", "FILE", "SYSTEM"]).optional(),
      content: z.string().min(1),
      attachmentUrl: z.string().optional(),
    })
    .parse(req.body);

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: payload.senderId,
      messageType: payload.messageType ?? "TEXT",
      content: payload.content,
      attachmentUrl: payload.attachmentUrl,
    },
  });

  res.status(201).json(message);
};
