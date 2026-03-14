import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const createGroupSchema = z.object({
  listingId: z.string().min(1),
  creatorId: z.string().min(1),
  name: z.string().min(2),
  targetPriceAed: z.number().positive(),
  maxMembers: z.number().int().min(2),
  isPublic: z.boolean().optional(),
  description: z.string().optional(),
  creatorShare: z.number().min(1).max(100),
});

export const listGroups = async (_req: Request, res: Response) => {
  const items = await prisma.group.findMany({
    include: {
      members: true,
      listing: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(items);
};

export const createGroup = async (req: Request, res: Response) => {
  const payload = createGroupSchema.parse(req.body);

  const group = await prisma.group.create({
    data: {
      listingId: payload.listingId,
      creatorId: payload.creatorId,
      name: payload.name,
      targetPriceAed: payload.targetPriceAed,
      maxMembers: payload.maxMembers,
      isPublic: payload.isPublic ?? true,
      description: payload.description,
      members: {
        create: {
          userId: payload.creatorId,
          role: "ADMIN",
          ownershipShare: payload.creatorShare,
          isConfirmed: true,
        },
      },
    },
    include: { members: true },
  });

  res.status(201).json(group);
};

export const getGroupById = async (req: Request<{ id: string }>, res: Response) => {
  const groupId = String(req.params.id);

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: { include: { user: true } },
      invitations: true,
      listing: true,
    },
  });

  if (!group) {
    res.status(404).json({ message: "Group not found" });
    return;
  }

  res.status(200).json(group);
};

export const addGroupMember = async (req: Request<{ id: string }>, res: Response) => {
  const groupId = String(req.params.id);
  const payload = z
    .object({
      userId: z.string().min(1),
      ownershipShare: z.number().min(0).max(100),
    })
    .parse(req.body);

  const member = await prisma.groupMember.create({
    data: {
      groupId,
      userId: payload.userId,
      ownershipShare: payload.ownershipShare,
    },
  });

  res.status(201).json(member);
};

export const createGroupInvitation = async (req: Request<{ id: string }>, res: Response) => {
  const groupId = String(req.params.id);
  const payload = z
    .object({
      invitedUserId: z.string().min(1),
      invitedById: z.string().min(1),
    })
    .parse(req.body);

  const invitation = await prisma.groupInvitation.create({
    data: {
      groupId,
      invitedUserId: payload.invitedUserId,
      invitedById: payload.invitedById,
    },
  });

  res.status(201).json(invitation);
};

export const updateInvitationStatus = async (req: Request<{ invitationId: string }>, res: Response) => {
  const invitationId = String(req.params.invitationId);
  const payload = z.object({ status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "EXPIRED"]) }).parse(req.body);

  const invitation = await prisma.groupInvitation.update({
    where: { id: invitationId },
    data: { status: payload.status },
  });

  res.status(200).json(invitation);
};
