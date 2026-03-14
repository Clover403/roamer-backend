import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const listPayments = async (_req: Request, res: Response) => {
  const items = await prisma.payment.findMany({
    include: {
      payer: true,
      rental: true,
      offer: true,
      promotion: true,
    },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(items);
};

export const createPayment = async (req: Request, res: Response) => {
  const payload = z
    .object({
      payerId: z.string().min(1),
      purpose: z.enum(["RENTAL", "LISTING_FEE", "COMMISSION", "PROMOTION", "SECURITY_DEPOSIT"]),
      amountAed: z.number().positive(),
      currency: z.string().default("AED"),
      provider: z.string().optional(),
      providerPaymentRef: z.string().optional(),
      rentalId: z.string().optional(),
      offerId: z.string().optional(),
      promotionId: z.string().optional(),
    })
    .parse(req.body);

  const item = await prisma.payment.create({ data: payload });
  res.status(201).json(item);
};

export const updatePaymentStatus = async (req: Request<{ id: string }>, res: Response) => {
  const paymentId = String(req.params.id);
  const payload = z
    .object({
      status: z.enum(["PENDING", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"]),
    })
    .parse(req.body);

  const item = await prisma.payment.update({
    where: { id: paymentId },
    data: {
      status: payload.status,
      paidAt: payload.status === "PAID" ? new Date() : undefined,
    },
  });

  res.status(200).json(item);
};
