import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { purgeCancelledGroups } from "../lib/group-lifecycle";
import { getUserVerificationGate } from "../lib/identity-verification";

type AuthedRequest = Request & {
  authUser?: {
    id: string;
    role: "USER" | "ADMIN";
  };
};

const createGroupSchema = z.object({
  listingId: z.string().min(1),
  creatorId: z.string().min(1).optional(),
  name: z.string().min(2),
  targetPriceAed: z.number().positive(),
  maxMembers: z.number().int().min(2),
  isPublic: z.boolean().optional(),
  description: z.string().optional(),
  creatorShare: z.number().min(1).max(100),
});

export const listGroups = async (req: Request, res: Response) => {
  await purgeCancelledGroups(prisma);

  const { listingId, status } = req.query;

  const where: Record<string, unknown> = {};
  if (listingId) where.listingId = String(listingId);
  if (status) where.status = String(status);

  const items = await prisma.group.findMany({
    where,
    include: {
      members: { include: { user: true } },
      listing: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(items);
};

export const createGroup = async (req: Request, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const payload = createGroupSchema.parse(req.body);

  const verificationGate = await getUserVerificationGate(authUserId);
  if (!verificationGate.allowed) {
    const baseMessage =
      verificationGate.status === "PENDING"
        ? "Your identity verification is still pending admin review"
        : verificationGate.status === "REJECTED"
          ? "Your identity verification was rejected. Please resubmit your documents"
          : "Identity verification is required before creating a group";

    res.status(403).json({
      message: verificationGate.rejectionReason
        ? `${baseMessage}. Reason: ${verificationGate.rejectionReason}`
        : baseMessage,
      verificationStatus: verificationGate.status,
      verificationRejectionReason: verificationGate.rejectionReason,
    });
    return;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: payload.listingId },
    select: { id: true, sellerId: true, listingType: true, status: true },
  });

  if (!listing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  if (listing.listingType !== "SELL") {
    res.status(400).json({ message: "Groups are only available for sell listings" });
    return;
  }

  if (listing.status === "SOLD") {
    res.status(400).json({ message: "Listing is already sold" });
    return;
  }

  if (listing.sellerId === authUserId) {
    res.status(403).json({ message: "You cannot create a purchase group for your own listing" });
    return;
  }

  const group = await prisma.group.create({
    data: {
      listingId: payload.listingId,
      creatorId: authUserId,
      name: payload.name,
      targetPriceAed: payload.targetPriceAed,
      maxMembers: payload.maxMembers,
      isPublic: payload.isPublic ?? true,
      description: payload.description,
      members: {
        create: {
          userId: authUserId,
          role: "ADMIN",
          ownershipShare: payload.creatorShare,
          isConfirmed: false,
        },
      },
    },
    include: { members: true },
  });

  res.status(201).json(group);
};

export const getGroupById = async (req: Request<{ id: string }>, res: Response) => {
  const groupId = String(req.params.id);

  await purgeCancelledGroups(prisma);

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

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: true,
      listing: {
        select: {
          sellerId: true,
          status: true,
          listingType: true,
        },
      },
    },
  });

  if (!group) {
    res.status(404).json({ message: "Group not found" });
    return;
  }

  if (group.status === "CANCELLED" || group.status === "COMPLETED") {
    res.status(400).json({ message: "This group is no longer active" });
    return;
  }

  if (group.listing.status === "SOLD") {
    res.status(400).json({ message: "Listing is already sold" });
    return;
  }

  if (group.listing.listingType !== "SELL") {
    res.status(400).json({ message: "This group cannot accept members" });
    return;
  }

  if (group.listing.sellerId === payload.userId) {
    res.status(403).json({ message: "Listing owner cannot join a buyer group for own listing" });
    return;
  }

  const existingMember = group.members.find((member: { userId: string }) => member.userId === payload.userId);
  if (existingMember) {
    res.status(409).json({ message: "User is already a member of this group" });
    return;
  }

  if (group.members.length >= group.maxMembers) {
    res.status(400).json({ message: "Group has reached maximum members" });
    return;
  }

  const usedShare = group.members.reduce(
    (sum: number, member: { ownershipShare: number | string }) => sum + Number(member.ownershipShare),
    0
  );
  const remainingShare = Math.max(0, 100 - usedShare);

  if (payload.ownershipShare <= 0 || payload.ownershipShare > remainingShare) {
    res.status(400).json({
      message: `Ownership share must be between 0 and ${remainingShare}`,
    });
    return;
  }

  const member = await prisma.groupMember.create({
    data: {
      groupId,
      userId: payload.userId,
      ownershipShare: payload.ownershipShare,
      role: "MEMBER",
      isConfirmed: false,
    },
  });

  res.status(201).json(member);
};

export const confirmGroupMemberTerms = async (
  req: Request<{ id: string; userId: string }>,
  res: Response
) => {
  const groupId = String(req.params.id);
  const userId = String(req.params.userId);

  const member = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId,
        userId,
      },
    },
  });

  if (!member) {
    res.status(404).json({ message: "Group member not found" });
    return;
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { status: true, listing: { select: { status: true } } },
  });

  if (!group || group.status === "CANCELLED" || group.status === "COMPLETED" || group.listing.status === "SOLD") {
    res.status(400).json({ message: "This group is no longer active" });
    return;
  }

  const updatedMember = await prisma.groupMember.update({
    where: {
      groupId_userId: {
        groupId,
        userId,
      },
    },
    data: {
      isConfirmed: true,
    },
  });

  res.status(200).json(updatedMember);
};

export const removeGroupMember = async (
  req: Request<{ id: string; userId: string }>,
  res: Response
) => {
  const groupId = String(req.params.id);
  const userId = String(req.params.userId);
  const payload = z
    .object({
      requesterId: z.string().min(1),
    })
    .parse(req.body);

  if (payload.requesterId !== userId) {
    res.status(403).json({ message: "You can only remove your own membership" });
    return;
  }

  const member = await prisma.groupMember.findUnique({
    where: {
      groupId_userId: {
        groupId,
        userId,
      },
    },
  });

  if (!member) {
    res.status(404).json({ message: "Group member not found" });
    return;
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { status: true },
  });

  if (!group || group.status === "CANCELLED" || group.status === "COMPLETED") {
    res.status(400).json({ message: "This group is no longer active" });
    return;
  }

  if (member.role === "ADMIN") {
    res.status(400).json({ message: "Admin cannot leave group. Delete the group instead." });
    return;
  }

  if (member.isConfirmed) {
    res.status(400).json({ message: "You cannot leave the group after confirming terms." });
    return;
  }

  await prisma.groupMember.delete({
    where: {
      groupId_userId: {
        groupId,
        userId,
      },
    },
  });

  res.status(200).json({ message: "Left group successfully" });
};

export const deleteGroup = async (req: Request<{ id: string }>, res: Response) => {
  const groupId = String(req.params.id);
  const payload = z
    .object({
      requesterId: z.string().min(1),
    })
    .parse(req.body);

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { members: true },
  });

  if (!group) {
    res.status(404).json({ message: "Group not found" });
    return;
  }

  const requesterMembership = group.members.find(
    (member: { userId: string }) => member.userId === payload.requesterId
  );
  if (!requesterMembership || requesterMembership.role !== "ADMIN") {
    res.status(403).json({ message: "Only group admin can delete this group" });
    return;
  }

  if (group.members.length !== 1) {
    res.status(400).json({ message: "Group can only be deleted when admin is the only member" });
    return;
  }

  await prisma.group.delete({
    where: { id: groupId },
  });

  res.status(200).json({ message: "Group deleted successfully" });
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
