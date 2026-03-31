import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { getUserVerificationGate } from "../lib/identity-verification";
import { ensurePlatformFeeSettings, mapPlatformFeeSettings } from "../lib/platform-fees";

type AuthedRequest = Request & {
  authUser?: {
    id: string;
    role: "USER" | "ADMIN";
  };
};

type RentalMeta = {
  bankAccountNumber?: string;
  paymentSubmittedAt?: string;
  paymentConfirmedAt?: string;
  shippedAt?: string;
  receivedAt?: string;
  paymentDeadlineAt?: string;
  handoverConfirmedAt?: string;
  cancellationReason?: string;
  cancelledBy?: "SELLER" | "RENTER";
};

const isMissingRentalBookingTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; meta?: { modelName?: string } };
  return maybeError.code === "P2021" && maybeError.meta?.modelName === "RentalBooking";
};

const parseRentalMeta = (rawNotes?: string | null): RentalMeta => {
  if (!rawNotes) return {};

  try {
    const parsed = JSON.parse(rawNotes) as RentalMeta;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
};

const serializeRentalMeta = (meta: RentalMeta) => JSON.stringify(meta);

const computeEndDate = (start: Date, durationUnit: "DAY" | "WEEK" | "MONTH" | "YEAR", durationCount: number) => {
  const end = new Date(start);
  if (durationUnit === "DAY") {
    end.setDate(end.getDate() + durationCount);
    return end;
  }
  if (durationUnit === "WEEK") {
    end.setDate(end.getDate() + durationCount * 7);
    return end;
  }
  if (durationUnit === "MONTH") {
    end.setMonth(end.getMonth() + durationCount);
    return end;
  }
  end.setFullYear(end.getFullYear() + durationCount);
  return end;
};

const expireUnpaidApprovedRentals = async () => {
  // Payment step is intentionally removed from project scope.
  // Keep lifecycle signature stable for existing cron calls.
  return { expired: 0 };
};

const completeElapsedActiveRentals = async () => {
  const now = new Date();
  let result: { count: number };
  try {
    result = await prisma.rentalBooking.updateMany({
      where: {
        status: "ACTIVE",
        endDate: {
          lte: now,
        },
      },
      data: {
        status: "COMPLETED",
      },
    });
  } catch (error: unknown) {
    if (isMissingRentalBookingTableError(error)) {
      return { completed: 0 };
    }
    throw error;
  }

  if (result.count > 0) {
    const affected = await prisma.rentalBooking.findMany({
      where: {
        status: "COMPLETED",
        endDate: {
          lte: now,
        },
      },
      select: { listingId: true },
    });
    const listingIds = [...new Set(affected.map((r: (typeof affected)[number]) => r.listingId))];
    if (listingIds.length > 0) {
      await prisma.listing.updateMany({
        where: { id: { in: listingIds }, listingType: "RENT" },
        data: { availabilityStatus: "AVAILABLE" },
      });
    }
  }

  return { completed: result.count };
};

const runRentalLifecycle = async () => {
  await expireUnpaidApprovedRentals();
  await completeElapsedActiveRentals();
};

export const listRentals = async (req: Request, res: Response) => {
  await runRentalLifecycle();

  const listingId = req.query.listingId ? String(req.query.listingId) : undefined;
  const renterId = req.query.renterId ? String(req.query.renterId) : undefined;
  const sellerId = req.query.sellerId ? String(req.query.sellerId) : undefined;

  const items = await prisma.rentalBooking.findMany({
    where: {
      ...(listingId ? { listingId } : {}),
      ...(renterId ? { renterId } : {}),
      ...(sellerId ? { listing: { sellerId } } : {}),
    },
    include: {
      listing: {
        select: {
          id: true,
          sellerId: true,
          make: true,
          model: true,
          year: true,
          listingType: true,
          status: true,
          availabilityStatus: true,
        },
      },
      renter: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
        },
      },
      contract: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const activeApprovalByListing = new Map<string, string>();
  items.forEach((item: (typeof items)[number]) => {
    if (item.status !== "APPROVED") return;
    activeApprovalByListing.set(item.listingId, item.id);
  });

  const normalized = items.map((item: (typeof items)[number]) => {
    const meta = parseRentalMeta(item.notes);
    const disabledBy = activeApprovalByListing.get(item.listingId);
    const isSelectionDisabled =
      item.status === "REQUESTED" &&
      Boolean(disabledBy) &&
      disabledBy !== item.id;

    return {
      ...item,
      payment: {
        bankAccountNumber: meta.bankAccountNumber ?? null,
        submittedAt: meta.paymentSubmittedAt ?? null,
        confirmedAt: meta.paymentConfirmedAt ?? null,
        deadlineAt: meta.paymentDeadlineAt ?? null,
      },
      shipping: {
        shippedAt: meta.shippedAt ?? null,
        receivedAt: meta.receivedAt ?? null,
      },
      cancellationReason: meta.cancellationReason ?? null,
      isSelectionDisabled,
    };
  });

  res.status(200).json(normalized);
};

export const createRental = async (req: Request, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  await runRentalLifecycle();

  const payload = z
    .object({
      listingId: z.string().min(1),
      renterId: z.string().min(1).optional(),
      durationUnit: z.enum(["DAY", "WEEK", "MONTH", "YEAR"]),
      durationCount: z.number().int().positive(),
      startDate: z.string().datetime(),
      endDate: z.string().datetime(),
      rateAppliedAed: z.number().positive(),
      subtotalAed: z.number().nonnegative(),
      securityDepositAed: z.number().nonnegative().optional(),
      totalAed: z.number().positive(),
      agreedToTerms: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .parse(req.body);

  const verificationGate = await getUserVerificationGate(authUserId);
  if (!verificationGate.allowed) {
    const baseMessage =
      verificationGate.status === "PENDING"
        ? "Your identity verification is still pending admin review"
        : verificationGate.status === "REJECTED"
          ? "Your identity verification was rejected. Please resubmit your documents"
          : "Identity verification is required before placing rental requests";

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
    select: {
      sellerId: true,
      listingType: true,
      status: true,
      availabilityStatus: true,
    },
  });

  if (!listing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  if (listing.listingType !== "RENT") {
    res.status(400).json({ message: "This listing is not available for rent" });
    return;
  }

  if (listing.sellerId === authUserId) {
    res.status(403).json({ message: "You cannot rent your own listing" });
    return;
  }

  const existingRentalForRenter = await prisma.rentalBooking.findFirst({
    where: {
      listingId: payload.listingId,
      renterId: authUserId,
      status: {
        in: ["REQUESTED", "APPROVED", "ACTIVE"],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });

  if (existingRentalForRenter) {
    res.status(409).json({
      message:
        existingRentalForRenter.status === "ACTIVE"
          ? "You are already renting this listing"
          : "You already have a pending rental request for this listing",
    });
    return;
  }

  if (listing.status === "SOLD" || listing.availabilityStatus === "UNAVAILABLE") {
    res.status(400).json({ message: "This listing is currently unavailable for rental" });
    return;
  }

  const activeRental = await prisma.rentalBooking.findFirst({
    where: {
      listingId: payload.listingId,
      status: {
        in: ["APPROVED", "ACTIVE"],
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (activeRental?.status === "APPROVED" || activeRental?.status === "ACTIVE") {
    const availableAgainAt = activeRental.endDate?.toISOString();
    res.status(400).json({
      message:
        activeRental.status === "APPROVED"
          ? "This listing already has a confirmed booking and is temporarily unavailable"
          : "This listing is currently in an active rental session",
      availableAgainAt,
    });
    return;
  }

  const rental = await prisma.rentalBooking.create({
    data: {
      ...payload,
      renterId: authUserId,
      startDate: new Date(payload.startDate),
      endDate: new Date(payload.endDate),
      notes: payload.notes,
    },
  });

  await prisma.notification.create({
    data: {
      userId: listing.sellerId,
      type: "RENTAL",
      title: "New rental request",
      body: "A renter submitted a booking request. Please review and approve/reject.",
    },
  });

  res.status(201).json(rental);
};

export const sellerDecisionRental = async (req: Request<{ id: string }>, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  await runRentalLifecycle();

  const rentalId = String(req.params.id);
  const payload = z
    .object({
      sellerId: z.string().min(1).optional(),
      decision: z.enum(["APPROVE", "REJECT"]),
      reason: z.string().trim().max(500).optional(),
    })
    .parse(req.body);

  const rental = await prisma.rentalBooking.findUnique({
    where: { id: rentalId },
    include: {
      listing: {
        select: { id: true, sellerId: true, make: true, model: true },
      },
      renter: { select: { id: true, fullName: true } },
    },
  });

  if (!rental) {
    res.status(404).json({ message: "Rental request not found" });
    return;
  }

  if (rental.listing.sellerId !== authUserId) {
    res.status(403).json({ message: "Only listing seller can decide this request" });
    return;
  }

  if (rental.status !== "REQUESTED") {
    const isApproveIdempotent = payload.decision === "APPROVE" && rental.status === "APPROVED";
    const isRejectIdempotent = payload.decision === "REJECT" && (rental.status === "CANCELLED" || rental.status === "REJECTED");
    if (isApproveIdempotent || isRejectIdempotent) {
      res.status(200).json(rental);
      return;
    }

    res.status(400).json({ message: "Only pending requests can be decided" });
    return;
  }

  if (payload.decision === "REJECT") {
    const rejectionReason = payload.reason?.trim() || undefined;
    const listingName = [rental.listing.make, rental.listing.model].filter(Boolean).join(" ") || "this vehicle";

    const updated = await prisma.rentalBooking.update({
      where: { id: rental.id },
      data: {
        status: "CANCELLED",
        rejectedAt: new Date(),
        notes: serializeRentalMeta({
          ...parseRentalMeta(rental.notes),
          cancellationReason: rejectionReason,
          cancelledBy: "SELLER",
        }),
      },
    });

    await prisma.notification.create({
      data: {
        userId: rental.renterId,
        type: "RENTAL",
        title: "Rental request declined",
        body: `Your rental request for ${listingName} was declined by the owner.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}`,
      },
    });

    res.status(200).json(updated);
    return;
  }

  const activeConfirmed = await prisma.rentalBooking.findFirst({
    where: {
      listingId: rental.listingId,
      status: "APPROVED",
      id: { not: rental.id },
    },
    orderBy: { createdAt: "desc" },
  });

  if (activeConfirmed) {
    res.status(400).json({
      message: "Another renter is already confirmed for this listing.",
    });
    return;
  }

  const now = new Date();
  const updated = await prisma.rentalBooking.update({
    where: { id: rental.id },
    data: {
      status: "APPROVED",
      approvedAt: now,
    },
  });

  const listingName = [rental.listing.make, rental.listing.model].filter(Boolean).join(" ") || "listing";

  await prisma.contract.upsert({
    where: { rentalId: rental.id },
    create: {
      contractType: "RENTAL",
      status: "PENDING_SIGNATURE",
      listingId: rental.listingId,
      rentalId: rental.id,
      title: `${listingName} Rental Agreement`,
      version: "1.0",
      startsAt: rental.startDate,
      endsAt: rental.endDate,
      termsSnapshot: {
        rentalId: rental.id,
        listingId: rental.listingId,
        listingName,
        renterId: rental.renterId,
        renterName: rental.renter.fullName ?? null,
        durationUnit: rental.durationUnit,
        durationCount: rental.durationCount,
        startDate: rental.startDate.toISOString(),
        endDate: rental.endDate.toISOString(),
        rateAppliedAed: rental.rateAppliedAed.toString(),
        subtotalAed: rental.subtotalAed.toString(),
        securityDepositAed: rental.securityDepositAed?.toString() ?? null,
        totalAed: rental.totalAed.toString(),
        agreedToTerms: rental.agreedToTerms,
      },
    },
    update: {
      status: "PENDING_SIGNATURE",
      listingId: rental.listingId,
      title: `${listingName} Rental Agreement`,
      version: "1.0",
      startsAt: rental.startDate,
      endsAt: rental.endDate,
      termsSnapshot: {
        rentalId: rental.id,
        listingId: rental.listingId,
        listingName,
        renterId: rental.renterId,
        renterName: rental.renter.fullName ?? null,
        durationUnit: rental.durationUnit,
        durationCount: rental.durationCount,
        startDate: rental.startDate.toISOString(),
        endDate: rental.endDate.toISOString(),
        rateAppliedAed: rental.rateAppliedAed.toString(),
        subtotalAed: rental.subtotalAed.toString(),
        securityDepositAed: rental.securityDepositAed?.toString() ?? null,
        totalAed: rental.totalAed.toString(),
        agreedToTerms: rental.agreedToTerms,
      },
    },
  });

  const feeSettings = mapPlatformFeeSettings(await ensurePlatformFeeSettings());
  const rentalFeePct = Number(feeSettings.rentalFeePct ?? 0);
  const rentalBaseAmountAed = Number(rental.subtotalAed ?? rental.totalAed ?? 0);
  const expectedRentalFeeAed = Number(((rentalBaseAmountAed * rentalFeePct) / 100).toFixed(2));

  if (expectedRentalFeeAed > 0) {
    const existingRentalInvoice = await prisma.payment.findFirst({
      where: {
        rentalId: rental.id,
        payerId: rental.listing.sellerId,
        purpose: "RENTAL",
      },
      select: { id: true },
    });

    if (!existingRentalInvoice) {
      await prisma.payment.create({
        data: {
          payerId: rental.listing.sellerId,
          purpose: "RENTAL",
          status: "PENDING",
          amountAed: expectedRentalFeeAed,
          currency: "AED",
          provider: "MANUAL_ADMIN_REVIEW",
          providerPaymentRef: `RENTAL:${rental.id}:FEE`,
          rentalId: rental.id,
        },
      });
    }
  }

  const otherRequesters = await prisma.rentalBooking.findMany({
    where: {
      listingId: rental.listingId,
      status: "REQUESTED",
      id: { not: rental.id },
    },
    select: { id: true, renterId: true },
  });

  if (otherRequesters.length > 0) {
    await prisma.rentalBooking.updateMany({
      where: {
        id: {
          in: otherRequesters.map((row: (typeof otherRequesters)[number]) => row.id),
        },
      },
      data: {
        status: "REJECTED",
        rejectedAt: now,
      },
    });
  }

  const retryDateLabel = rental.endDate.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const notificationRows = [
    {
      userId: rental.renterId,
      type: "RENTAL" as const,
      title: "Booking confirmed",
      body: `Your rental request for ${listingName} has been confirmed by the owner.`,
    },
    ...otherRequesters.map((r: (typeof otherRequesters)[number]) => ({
      userId: r.renterId,
      type: "RENTAL" as const,
      title: "Rental request rejected",
      body: `Another renter was approved for ${listingName}. Please try again later on ${retryDateLabel}.`,
    })),
  ];

  await prisma.notification.createMany({ data: notificationRows });

  await prisma.analyticsEvent.create({
    data: {
      eventType: "RENTAL_CONFIRMED",
      actorUserId: authUserId,
      listingId: rental.listingId,
      metadata: {
        activityType: "RENTAL_COMPLETED",
        rentalId: rental.id,
      },
    },
  });

  res.status(200).json(updated);
};

export const confirmRentalHandoverBySeller = async (req: Request<{ id: string }>, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  await runRentalLifecycle();

  const rentalId = String(req.params.id);
  const rental = await prisma.rentalBooking.findUnique({
    where: { id: rentalId },
    include: {
      listing: {
        select: { id: true, sellerId: true, make: true, model: true },
      },
    },
  });

  if (!rental) {
    res.status(404).json({ message: "Rental request not found" });
    return;
  }

  if (rental.listing.sellerId !== authUserId) {
    res.status(403).json({ message: "Only listing seller can confirm handover" });
    return;
  }

  if (rental.status !== "APPROVED") {
    if (rental.status === "ACTIVE") {
      res.status(200).json(rental);
      return;
    }
    res.status(400).json({ message: "Seller handover is only allowed when booking is confirmed" });
    return;
  }

  const meta = parseRentalMeta(rental.notes);
  const now = new Date();
  const nextEndDate = computeEndDate(now, rental.durationUnit, rental.durationCount);
  const updated = await prisma.rentalBooking.update({
    where: { id: rental.id },
    data: {
      status: "ACTIVE",
      startDate: now,
      endDate: nextEndDate,
      notes: serializeRentalMeta({
        ...meta,
        handoverConfirmedAt: now.toISOString(),
        shippedAt: now.toISOString(),
      }),
    },
  });

  await prisma.contract.updateMany({
    where: { rentalId: rental.id },
    data: {
      status: "ACTIVE",
      startsAt: now,
      endsAt: nextEndDate,
    },
  });

  await prisma.listing.update({
    where: { id: rental.listingId },
    data: { availabilityStatus: "BOOKED" },
  });

  const listingName = [rental.listing.make, rental.listing.model].filter(Boolean).join(" ") || "listing";

  await prisma.notification.createMany({
    data: [
      {
        userId: rental.renterId,
        type: "RENTAL",
        title: "Rental is now active",
        body: `Seller confirmed shipment for ${listingName}. Rental timer is now running.`,
      },
      {
        userId: rental.listing.sellerId,
        type: "RENTAL",
        title: "Rental started",
        body: `You confirmed shipment for ${listingName}. Rental is now active.`,
      },
    ],
  });

  res.status(200).json(updated);
};

export const cancelRentalByRenter = async (req: Request<{ id: string }>, res: Response) => {
  await runRentalLifecycle();

  const rentalId = String(req.params.id);
  const payload = z
    .object({
      renterId: z.string().min(1),
      reason: z.string().trim().max(500).optional(),
    })
    .parse(req.body);

  const rental = await prisma.rentalBooking.findUnique({
    where: { id: rentalId },
    include: {
      listing: {
        select: { id: true, sellerId: true, make: true, model: true },
      },
    },
  });

  if (!rental) {
    res.status(404).json({ message: "Rental request not found" });
    return;
  }

  if (rental.renterId !== payload.renterId) {
    res.status(403).json({ message: "Only renter can cancel this booking" });
    return;
  }

  if (rental.status === "CANCELLED") {
    res.status(200).json(rental);
    return;
  }

  if (rental.status !== "REQUESTED") {
    res.status(400).json({ message: "Booking can only be cancelled before seller confirmation" });
    return;
  }

  const reason = payload.reason?.trim() || undefined;
  const updated = await prisma.rentalBooking.update({
    where: { id: rental.id },
    data: {
      status: "CANCELLED",
      rejectedAt: new Date(),
      notes: serializeRentalMeta({
        ...parseRentalMeta(rental.notes),
        cancellationReason: reason,
        cancelledBy: "RENTER",
      }),
    },
  });

  const listingName = [rental.listing.make, rental.listing.model].filter(Boolean).join(" ") || "listing";
  await prisma.notification.create({
    data: {
      userId: rental.listing.sellerId,
      type: "RENTAL",
      title: "Rental request cancelled",
      body: `A renter cancelled their booking request for ${listingName}.${reason ? ` Reason: ${reason}` : ""}`,
    },
  });

  res.status(200).json(updated);
};

export const submitRentalPayment = async (req: Request<{ id: string }>, res: Response) => {
  await runRentalLifecycle();

  const rentalId = String(req.params.id);
  const payload = z
    .object({
      renterId: z.string().min(1),
      bankAccountNumber: z.string().min(6),
    })
    .parse(req.body);

  const rental = await prisma.rentalBooking.findUnique({
    where: { id: rentalId },
    include: {
      listing: {
        select: { id: true, sellerId: true, make: true, model: true },
      },
    },
  });

  if (!rental) {
    res.status(404).json({ message: "Rental request not found" });
    return;
  }

  if (rental.renterId !== payload.renterId) {
    res.status(403).json({ message: "Only renter can submit payment" });
    return;
  }

  if (rental.status !== "APPROVED") {
    res.status(400).json({ message: "Payment can only be submitted after seller approval" });
    return;
  }

  const meta = parseRentalMeta(rental.notes);
  if (meta.paymentDeadlineAt && new Date(meta.paymentDeadlineAt) < new Date()) {
    await prisma.rentalBooking.update({ where: { id: rental.id }, data: { status: "EXPIRED" } });
    res.status(400).json({ message: "Payment deadline expired" });
    return;
  }

  const now = new Date();
  const updated = await prisma.rentalBooking.update({
    where: { id: rental.id },
    data: {
      notes: serializeRentalMeta({
        ...meta,
        bankAccountNumber: payload.bankAccountNumber,
        paymentSubmittedAt: now.toISOString(),
      }),
    },
  });

  await prisma.notification.create({
    data: {
      userId: rental.listing.sellerId,
      type: "RENTAL",
      title: "Manual payment submitted",
      body: "Renter submitted payment details. Confirm payment to continue shipment.",
    },
  });

  res.status(200).json(updated);
};

export const confirmRentalPayment = async (req: Request<{ id: string }>, res: Response) => {
  await runRentalLifecycle();

  const rentalId = String(req.params.id);
  const payload = z
    .object({
      sellerId: z.string().min(1),
      confirmed: z.boolean(),
    })
    .parse(req.body);

  const rental = await prisma.rentalBooking.findUnique({
    where: { id: rentalId },
    include: {
      listing: {
        select: { id: true, sellerId: true, make: true, model: true },
      },
    },
  });

  if (!rental) {
    res.status(404).json({ message: "Rental request not found" });
    return;
  }

  if (rental.listing.sellerId !== payload.sellerId) {
    res.status(403).json({ message: "Only listing seller can confirm payment" });
    return;
  }

  if (rental.status !== "APPROVED") {
    res.status(400).json({ message: "Rental is not in approved state" });
    return;
  }

  const meta = parseRentalMeta(rental.notes);
  if (!meta.paymentSubmittedAt) {
    res.status(400).json({ message: "Renter has not submitted payment yet" });
    return;
  }

  if (!payload.confirmed) {
    const updated = await prisma.rentalBooking.update({
      where: { id: rental.id },
      data: {
        notes: serializeRentalMeta({
          ...meta,
          paymentSubmittedAt: undefined,
          paymentConfirmedAt: undefined,
        }),
      },
    });

    await prisma.notification.create({
      data: {
        userId: rental.renterId,
        type: "RENTAL",
        title: "Payment needs resubmission",
        body: "Seller did not confirm your payment yet. Please resubmit payment details.",
      },
    });

    res.status(200).json(updated);
    return;
  }

  const now = new Date();
  const updated = await prisma.rentalBooking.update({
    where: { id: rental.id },
    data: {
      notes: serializeRentalMeta({
        ...meta,
        paymentConfirmedAt: now.toISOString(),
      }),
    },
  });

  await prisma.rentalBooking.updateMany({
    where: {
      listingId: rental.listingId,
      status: "REQUESTED",
      id: { not: rental.id },
    },
    data: {
      status: "REJECTED",
      rejectedAt: now,
    },
  });

  const rejectedOthers = await prisma.rentalBooking.findMany({
    where: {
      listingId: rental.listingId,
      status: "REJECTED",
      id: { not: rental.id },
    },
    select: { renterId: true },
  });

  const listingName = [rental.listing.make, rental.listing.model].filter(Boolean).join(" ") || "listing";
  await prisma.notification.createMany({
    data: [
      {
        userId: rental.renterId,
        type: "RENTAL",
        title: "Payment confirmed",
        body: `Seller confirmed your payment for ${listingName}. Waiting for shipment.`,
      },
      ...rejectedOthers.map((r: (typeof rejectedOthers)[number]) => ({
        userId: r.renterId,
        type: "RENTAL" as const,
        title: "Booking request closed",
        body: `Another renter completed payment for ${listingName}. Your request is now rejected.`,
      })),
    ],
  });

  res.status(200).json(updated);
};

export const dispatchRental = async (req: Request<{ id: string }>, res: Response) => {
  const rentalId = String(req.params.id);
  const payload = z
    .object({ sellerId: z.string().min(1) })
    .parse(req.body);

  const rental = await prisma.rentalBooking.findUnique({
    where: { id: rentalId },
    include: {
      listing: {
        select: { sellerId: true, make: true, model: true },
      },
    },
  });

  if (!rental) {
    res.status(404).json({ message: "Rental request not found" });
    return;
  }

  if (rental.listing.sellerId !== payload.sellerId) {
    res.status(403).json({ message: "Only listing seller can dispatch" });
    return;
  }

  if (rental.status !== "APPROVED") {
    res.status(400).json({ message: "Only approved rentals can be dispatched" });
    return;
  }

  const meta = parseRentalMeta(rental.notes);
  if (!meta.paymentConfirmedAt) {
    res.status(400).json({ message: "Payment must be confirmed before dispatch" });
    return;
  }

  const now = new Date();
  const updated = await prisma.rentalBooking.update({
    where: { id: rental.id },
    data: {
      notes: serializeRentalMeta({
        ...meta,
        shippedAt: now.toISOString(),
      }),
    },
  });

  await prisma.notification.create({
    data: {
      userId: rental.renterId,
      type: "RENTAL",
      title: "Vehicle dispatched",
      body: "Seller has dispatched your rental vehicle. Confirm when you receive it.",
    },
  });

  res.status(200).json(updated);
};

export const confirmRentalReceived = async (req: Request<{ id: string }>, res: Response) => {
  const rentalId = String(req.params.id);
  const payload = z
    .object({ renterId: z.string().min(1) })
    .parse(req.body);

  const rental = await prisma.rentalBooking.findUnique({
    where: { id: rentalId },
    include: {
      listing: {
        select: { id: true, sellerId: true, make: true, model: true },
      },
    },
  });

  if (!rental) {
    res.status(404).json({ message: "Rental request not found" });
    return;
  }

  if (rental.renterId !== payload.renterId) {
    res.status(403).json({ message: "Only renter can confirm item received" });
    return;
  }

  if (rental.status === "ACTIVE") {
    res.status(200).json(rental);
    return;
  }

  if (rental.status !== "APPROVED") {
    res.status(400).json({ message: "Rental is not in a receivable state" });
    return;
  }

  res.status(400).json({ message: "Rental activation is controlled by seller handover confirmation" });
};

export const runRentalCronNow = async (_req: Request, res: Response) => {
  const [expiredResult, completedResult] = await Promise.all([
    expireUnpaidApprovedRentals(),
    completeElapsedActiveRentals(),
  ]);

  res.status(200).json({
    message: "Rental cron executed",
    expiredApprovals: expiredResult.expired,
    completedRentals: completedResult.completed,
    executedAt: new Date().toISOString(),
  });
};

export { runRentalLifecycle };
