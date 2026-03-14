import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const listPromotions = async (_req: Request, res: Response) => {
  const items = await prisma.promotionCampaign.findMany({
    include: { listing: true, creator: true },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(items);
};

export const createPromotion = async (req: Request, res: Response) => {
  const payload = z
    .object({
      listingId: z.string().min(1),
      createdById: z.string().min(1),
      packageDays: z.number().int().positive(),
      packagePriceAed: z.number().positive(),
      packageLabel: z.string().optional(),
      headline: z.string().optional(),
      subtitle: z.string().optional(),
      ctaLabel: z.string().optional(),
      bannerImageUrl: z.string().optional(),
      slotChoice: z.enum(["WAITLIST", "LATER"]).optional(),
    })
    .parse(req.body);

  const item = await prisma.promotionCampaign.create({ data: payload });
  res.status(201).json(item);
};

export const updatePromotionStatus = async (req: Request<{ id: string }>, res: Response) => {
  const promotionId = String(req.params.id);
  const payload = z
    .object({
      status: z.enum(["DRAFT", "PENDING_PAYMENT", "ACTIVE", "EXPIRED", "CANCELLED"]),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
    })
    .parse(req.body);

  const item = await prisma.promotionCampaign.update({
    where: { id: promotionId },
    data: {
      status: payload.status,
      startsAt: payload.startsAt ? new Date(payload.startsAt) : undefined,
      endsAt: payload.endsAt ? new Date(payload.endsAt) : undefined,
    },
  });

  res.status(200).json(item);
};
