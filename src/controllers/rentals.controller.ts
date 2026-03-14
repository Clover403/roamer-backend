import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const listRentals = async (_req: Request, res: Response) => {
  const items = await prisma.rentalBooking.findMany({
    include: { listing: true, renter: true },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(items);
};

export const createRental = async (req: Request, res: Response) => {
  const payload = z
    .object({
      listingId: z.string().min(1),
      renterId: z.string().min(1),
      durationUnit: z.enum(["DAY", "WEEK", "MONTH", "YEAR"]),
      durationCount: z.number().int().positive(),
      startDate: z.string().datetime(),
      endDate: z.string().datetime(),
      rateAppliedAed: z.number().positive(),
      subtotalAed: z.number().nonnegative(),
      securityDepositAed: z.number().nonnegative().optional(),
      totalAed: z.number().positive(),
      agreedToTerms: z.boolean().optional(),
    })
    .parse(req.body);

  const rental = await prisma.rentalBooking.create({
    data: {
      ...payload,
      startDate: new Date(payload.startDate),
      endDate: new Date(payload.endDate),
    },
  });

  res.status(201).json(rental);
};

export const updateRentalStatus = async (req: Request<{ id: string }>, res: Response) => {
  const rentalId = String(req.params.id);
  const payload = z
    .object({
      status: z.enum(["REQUESTED", "APPROVED", "REJECTED", "ACTIVE", "COMPLETED", "CANCELLED", "EXPIRED"]),
    })
    .parse(req.body);

  const rental = await prisma.rentalBooking.update({
    where: { id: rentalId },
    data: {
      status: payload.status,
      approvedAt: payload.status === "APPROVED" ? new Date() : undefined,
      rejectedAt: payload.status === "REJECTED" ? new Date() : undefined,
    },
  });

  res.status(200).json(rental);
};
