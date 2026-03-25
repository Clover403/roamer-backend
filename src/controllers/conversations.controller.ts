import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const listConversationQuerySchema = z.object({
  userId: z.string().optional(),
  channelType: z.enum(["GROUP", "DIRECT", "SUPPORT"]).optional(),
  listingId: z.string().optional(),
  groupId: z.string().optional(),
});

const normalizedSet = (ids: string[]) =>
  Array.from(new Set(ids.filter(Boolean))).sort((a, b) => a.localeCompare(b));

export const listConversations = async (req: Request, res: Response) => {
  const query = listConversationQuerySchema.parse(req.query);

  const where = {
    ...(query.userId ? { participants: { some: { userId: query.userId } } } : {}),
    ...(query.channelType ? { channelType: query.channelType } : {}),
    ...(query.listingId ? { listingId: query.listingId } : {}),
    ...(query.groupId ? { groupId: query.groupId } : {}),
  };

  const items = await prisma.conversation.findMany({
    where,
    include: {
      participants: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              role: true,
            },
          },
        },
      },
      listing: {
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
          sellerId: true,
        },
      },
      group: {
        select: {
          id: true,
          listingId: true,
          name: true,
        },
      },
      messages: {
        take: 1,
        orderBy: { createdAt: "desc" },
        include: {
          sender: {
            select: {
              id: true,
              fullName: true,
              avatarUrl: true,
              role: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const normalizedItems = items.filter((item: { channelType: string; groupId?: string | null; group?: unknown }) => {
    if (item.channelType !== "GROUP") return true;
    return Boolean(item.groupId && item.group);
  });

  res.status(200).json(normalizedItems);
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

  const participantUserIds = normalizedSet(payload.participantUserIds);

  if (payload.channelType === "GROUP") {
    if (!payload.groupId) {
      res.status(400).json({ message: "groupId is required for group conversations" });
      return;
    }

    let finalParticipantIds = participantUserIds;
    if (finalParticipantIds.length === 0) {
      const groupMembers = await prisma.groupMember.findMany({
        where: { groupId: payload.groupId },
        select: { userId: true },
      });
      finalParticipantIds = normalizedSet(groupMembers.map((member: { userId: string }) => member.userId));
    }

    const existing = await prisma.conversation.findFirst({
      where: {
        channelType: "GROUP",
        groupId: payload.groupId,
      },
      include: {
        participants: { include: { user: true } },
        messages: { take: 1, orderBy: { createdAt: "desc" }, include: { sender: true } },
        listing: true,
        group: true,
      },
    });

    if (existing) {
      if (finalParticipantIds.length > 0) {
        await prisma.conversationParticipant.createMany({
          data: finalParticipantIds.map((userId) => ({
            conversationId: existing.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      const updated = await prisma.conversation.findUnique({
        where: { id: existing.id },
        include: {
          participants: { include: { user: true } },
          messages: { take: 1, orderBy: { createdAt: "desc" }, include: { sender: true } },
          listing: true,
          group: true,
        },
      });

      res.status(200).json(updated);
      return;
    }

    const conversation = await prisma.conversation.create({
      data: {
        channelType: "GROUP",
        title: payload.title,
        groupId: payload.groupId,
        listingId: payload.listingId,
        participants: {
          create: finalParticipantIds.map((userId) => ({ userId })),
        },
      },
      include: {
        participants: { include: { user: true } },
        messages: { take: 1, orderBy: { createdAt: "desc" }, include: { sender: true } },
        listing: true,
        group: true,
      },
    });

    res.status(201).json(conversation);
    return;
  }

  if (payload.channelType === "DIRECT") {
    if (participantUserIds.length < 2) {
      res.status(400).json({ message: "Direct conversations require at least two participants" });
      return;
    }

    const candidates = await prisma.conversation.findMany({
      where: {
        channelType: "DIRECT",
        listingId: payload.listingId,
        participants: {
          some: {
            userId: { in: participantUserIds },
          },
        },
      },
      include: {
        participants: true,
      },
    });

    const matched = candidates.find((conversation: { participants: Array<{ userId: string }> }) => {
      const existingIds = normalizedSet(conversation.participants.map((participant: { userId: string }) => participant.userId));
      if (existingIds.length !== participantUserIds.length) return false;
      return existingIds.every((id, index) => id === participantUserIds[index]);
    });

    if (matched) {
      const fullConversation = await prisma.conversation.findUnique({
        where: { id: matched.id },
        include: {
          participants: { include: { user: true } },
          messages: { take: 1, orderBy: { createdAt: "desc" }, include: { sender: true } },
          listing: true,
          group: true,
        },
      });

      res.status(200).json(fullConversation);
      return;
    }
  }

  const conversation = await prisma.conversation.create({
    data: {
      channelType: payload.channelType,
      title: payload.title,
      listingId: payload.listingId,
      groupId: payload.groupId,
      rentalId: payload.rentalId,
      participants: {
        create: participantUserIds.map((userId) => ({ userId })),
      },
    },
    include: {
      participants: { include: { user: true } },
      messages: { take: 1, orderBy: { createdAt: "desc" }, include: { sender: true } },
      listing: true,
      group: true,
    },
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

  const message = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        senderId: payload.senderId,
        messageType: payload.messageType ?? "TEXT",
        content: payload.content,
        attachmentUrl: payload.attachmentUrl,
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
      },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return created;
  });

  res.status(201).json(message);
};

export const markConversationRead = async (req: Request<{ id: string }>, res: Response) => {
  const conversationId = String(req.params.id);
  const payload = z
    .object({
      userId: z.string().min(1),
    })
    .parse(req.body);

  const participant = await prisma.conversationParticipant.upsert({
    where: {
      conversationId_userId: {
        conversationId,
        userId: payload.userId,
      },
    },
    update: {
      lastReadAt: new Date(),
    },
    create: {
      conversationId,
      userId: payload.userId,
      lastReadAt: new Date(),
    },
  });

  res.status(200).json(participant);
};

export const uploadConversationMessageMedia = async (
  req: Request<{ id: string }> & { file?: Express.Multer.File },
  res: Response
) => {
  const conversationId = String(req.params.id);
  const senderId = String(req.body?.senderId ?? "").trim();
  const content = String(req.body?.content ?? "").trim();

  if (!req.file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }

  if (!senderId) {
    res.status(400).json({ message: "senderId is required" });
    return;
  }

  const uploadedFile = req.file;

  const host = req.get("host");
  const attachmentUrl = `${req.protocol}://${host}/uploads/conversations/${uploadedFile.filename}`;
  const inferredType: "IMAGE" | "FILE" = uploadedFile.mimetype.startsWith("image/") ? "IMAGE" : "FILE";

  const message = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        senderId,
        messageType: inferredType,
        content: content || uploadedFile.originalname || "Attachment",
        attachmentUrl,
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true,
            role: true,
          },
        },
      },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    await tx.conversationParticipant.upsert({
      where: {
        conversationId_userId: {
          conversationId,
          userId: senderId,
        },
      },
      update: { lastReadAt: new Date() },
      create: {
        conversationId,
        userId: senderId,
        lastReadAt: new Date(),
      },
    });

    return created;
  });

  res.status(201).json(message);
};
