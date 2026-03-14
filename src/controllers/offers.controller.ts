import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const listOffers = async (_req: Request, res: Response) => {
  const items = await prisma.jointOffer.findMany({
    include: { participants: true, group: true, listing: true },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(items);
};

export const createOffer = async (req: Request, res: Response) => {
  const payload = z
    .object({
      groupId: z.string().min(1),
      listingId: z.string().min(1),
      createdById: z.string().min(1),
      offerPriceAed: z.number().positive(),
      downPaymentAed: z.number().optional(),
      expiryDate: z.string().datetime().optional(),
      termsMessage: z.string().optional(),
      participants: z.array(
        z.object({
          userId: z.string().min(1),
          ownershipShare: z.number().min(0).max(100),
          contributionAed: z.number().nonnegative(),
        })
      ),
    })
    .parse(req.body);

  const offer = await prisma.jointOffer.create({
    data: {
      groupId: payload.groupId,
      listingId: payload.listingId,
      createdById: payload.createdById,
      offerPriceAed: payload.offerPriceAed,
      downPaymentAed: payload.downPaymentAed,
      expiryDate: payload.expiryDate ? new Date(payload.expiryDate) : undefined,
      termsMessage: payload.termsMessage,
      participants: {
        create: payload.participants,
      },
    },
    include: { participants: true },
  });

  res.status(201).json(offer);
};

export const updateOffer = async (req: Request<{ id: string }>, res: Response) => {
  const offerId = String(req.params.id);
  const payload = z
    .object({
      status: z
        .enum(["DRAFT", "PENDING_MEMBER_APPROVAL", "PENDING_SELLER_REVIEW", "ACCEPTED", "REJECTED", "EXPIRED"])
        .optional(),
      submittedToSellerAt: z.string().datetime().optional(),
    })
    .parse(req.body);

  const offer = await prisma.jointOffer.update({
    where: { id: offerId },
    data: {
      status: payload.status,
      submittedToSellerAt: payload.submittedToSellerAt ? new Date(payload.submittedToSellerAt) : undefined,
    },
  });

  res.status(200).json(offer);
};

export const updateOfferParticipantDecision = async (
  req: Request<{ id: string; userId: string }>,
  res: Response
) => {
  const offerId = String(req.params.id);
  const userId = String(req.params.userId);
  const payload = z
    .object({
      decision: z.enum(["PENDING", "APPROVED", "REJECTED"]),
    })
    .parse(req.body);

  const participant = await prisma.offerParticipant.update({
    where: {
      offerId_userId: {
        offerId,
        userId,
      },
    },
    data: {
      decision: payload.decision,
      decidedAt: payload.decision === "PENDING" ? null : new Date(),
    },
  });

  res.status(200).json(participant);
};
