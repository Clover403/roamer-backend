import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ensurePlatformFeeSettings, mapPlatformFeeSettings } from "../lib/platform-fees";
import { parsePagination } from "../routes/utils";
import { buildDayBuckets, getChangePercent, getRangeStart, makeDayKey, parseDashboardRange, rangeToDays } from "./dashboard.utils";
import { storageService } from "../services/storageService";

const DEFAULT_SIGNED_URL_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
const VERIFICATION_SIGNED_URL_EXPIRY_MS = 15 * 60 * 1000;

const signAvatar = async (avatarUrl?: string | null) => {
  if (!avatarUrl) return avatarUrl ?? null;
  return storageService.getSignedUrl(avatarUrl, DEFAULT_SIGNED_URL_EXPIRY_MS);
};

const signVerificationDocuments = async <T extends { documents: Array<{ fileUrl: string }> }>(
  submission: T | null
): Promise<T | null> => {
  if (!submission) return null;
  const signed = await Promise.all(
    submission.documents.map((doc) => storageService.getSignedUrl(doc.fileUrl, VERIFICATION_SIGNED_URL_EXPIRY_MS))
  );
  return {
    ...submission,
    documents: submission.documents.map((doc, idx) => ({
      ...doc,
      fileUrl: signed[idx] || doc.fileUrl,
    })),
  };
};

const parsePaymentRefBase = (value?: string | null) => String(value ?? "").split("|")[0] ?? "";

const parseTransferMetaFromPaymentRef = (value?: string | null) => {
  const raw = String(value ?? "");
  const parts = raw.split("|").slice(1);
  const map = new Map<string, string>();

  for (const part of parts) {
    const [k, ...rest] = part.split("=");
    if (!k || rest.length === 0) continue;
    map.set(k, decodeURIComponent(rest.join("=")));
  }

  return {
    transferReference: map.get("transferReference") ?? null,
    transferredAt: map.get("transferredAt") ?? null,
    note: map.get("note") ?? null,
  };
};

const appendTransferMetaToPaymentRef = (
  baseRef: string,
  payload: { transferReference?: string; transferredAt?: string; note?: string }
) => {
  const suffix: string[] = [];
  if (payload.transferReference) suffix.push(`transferReference=${encodeURIComponent(payload.transferReference)}`);
  if (payload.transferredAt) suffix.push(`transferredAt=${encodeURIComponent(payload.transferredAt)}`);
  if (payload.note) suffix.push(`note=${encodeURIComponent(payload.note)}`);
  return suffix.length ? `${baseRef}|${suffix.join("|")}` : baseRef;
};

const updateUserSchema = z.object({
  fullName: z.string().min(2).optional(),
  phone: z.string().optional(),
  preferredLanguage: z.string().optional(),
  isDarkMode: z.boolean().optional(),
  status: z.enum(["ACTIVE", "PENDING", "SUSPENDED"]).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
});

const updateIdentitySchema = z.object({
  dateOfBirth: z.string().datetime().optional(),
  nationality: z.string().optional(),
  emiratesIdNumber: z.string().optional(),
  emiratesIdExpiry: z.string().datetime().optional(),
  drivingLicenseNo: z.string().optional(),
  drivingLicenseExpiry: z.string().datetime().optional(),
  passportNumber: z.string().optional(),
  passportExpiry: z.string().datetime().optional(),
  addressLine: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
});

export const listUsers = async (req: Request, res: Response) => {
  const { skip, limit, page } = parsePagination(req);
  const q = String(req.query.q ?? "").trim();
  const roleQuery = String(req.query.role ?? "").trim().toUpperCase();
  const statusQuery = String(req.query.status ?? "").trim().toUpperCase();
  const verificationQuery = String(req.query.verificationStatus ?? "").trim().toUpperCase();

  const role = roleQuery === "USER" || roleQuery === "ADMIN" ? roleQuery : undefined;
  const status =
    statusQuery === "ACTIVE" || statusQuery === "PENDING" || statusQuery === "SUSPENDED"
      ? statusQuery
      : undefined;

  const verificationStatus =
    verificationQuery === "UNVERIFIED" ||
    verificationQuery === "PENDING" ||
    verificationQuery === "APPROVED" ||
    verificationQuery === "REJECTED" ||
    verificationQuery === "EXPIRED"
      ? verificationQuery
      : undefined;

  const where: {
    OR?: Array<{ fullName?: { contains: string; mode: "insensitive" }; email?: { contains: string; mode: "insensitive" } }>;
    role?: "USER" | "ADMIN";
    status?: "ACTIVE" | "PENDING" | "SUSPENDED";
    verificationStatus?: "UNVERIFIED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  } = {};

  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  if (role) where.role = role;
  if (status) where.status = status;
  if (verificationStatus) where.verificationStatus = verificationStatus;

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        role: true,
        status: true,
        verificationStatus: true,
        createdAt: true,
        verificationSubmissions: {
          orderBy: {
            submittedAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            status: true,
            reviewerNotes: true,
            submittedAt: true,
            reviewedAt: true,
            documents: {
              select: {
                id: true,
                documentType: true,
                fileUrl: true,
                createdAt: true,
              },
            },
          },
        },
        _count: {
          select: {
            ownedListings: true,
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const mappedItems = await Promise.all(
    items.map(async (item: (typeof items)[number]) => ({
      ...item,
      avatarUrl: await signAvatar(item.avatarUrl),
      verificationSubmissions:
        item.verificationSubmissions.length > 0
          ? [await signVerificationDocuments(item.verificationSubmissions[0])].filter(Boolean)
          : [],
    }))
  );

  res.status(200).json({ items: mappedItems, page, limit, total });
};

export const getSellerCommissionInvoices = async (req: Request<{ id: string }>, res: Response) => {
  const sellerId = String(req.params.id);
  const feeSettings = mapPlatformFeeSettings(await ensurePlatformFeeSettings());

  const acceptedCommissionOffers = await prisma.jointOffer.findMany({
    where: {
      status: "ACCEPTED",
      listing: {
        sellerId,
        paymentModel: {
          in: ["commission", "hybrid"],
        },
      },
    },
    select: {
      id: true,
      offerPriceAed: true,
      listing: {
        select: {
          commissionRatePct: true,
        },
      },
      payments: {
        where: {
          purpose: "COMMISSION",
        },
        select: {
          id: true,
        },
      },
    },
  });

  const missingCommissionPayments = acceptedCommissionOffers.filter(
    (offer: (typeof acceptedCommissionOffers)[number]) => offer.payments.length === 0
  );

  const missingCommissionRows = missingCommissionPayments
    .map((offer: (typeof missingCommissionPayments)[number]) => {
      const saleAmountAed = Number(offer.offerPriceAed ?? 0);
      const commissionRatePct = Number(offer.listing.commissionRatePct ?? 0);
      const expectedCommissionAed = Number(((saleAmountAed * commissionRatePct) / 100).toFixed(2));
      if (expectedCommissionAed <= 0) return null;

      return {
        payerId: sellerId,
        purpose: "COMMISSION" as const,
        status: "PENDING" as const,
        amountAed: expectedCommissionAed,
        currency: "AED",
        provider: "MANUAL_ADMIN_REVIEW",
        providerPaymentRef: `OFFER:${offer.id}:COMMISSION`,
        offerId: offer.id,
      };
    })
    .filter(Boolean) as Array<{
    payerId: string;
    purpose: "COMMISSION";
    status: "PENDING";
    amountAed: number;
    currency: string;
    provider: string;
    providerPaymentRef: string;
    offerId: string;
  }>;

  if (missingCommissionRows.length > 0) {
    await prisma.payment.createMany({ data: missingCommissionRows });
  }

  const rentalBookings = await prisma.rentalBooking.findMany({
    where: {
      listing: { sellerId },
      status: { in: ["APPROVED", "ACTIVE", "COMPLETED"] },
    },
    select: {
      id: true,
      subtotalAed: true,
      listing: {
        select: {
          commissionRatePct: true,
        },
      },
    },
  });

  const rentalIds = rentalBookings.map((booking: (typeof rentalBookings)[number]) => booking.id);

  const existingRentalPayments = rentalIds.length
    ? await prisma.payment.findMany({
        where: {
          payerId: sellerId,
          purpose: "RENTAL",
          rentalId: { in: rentalIds },
        },
        select: {
          rentalId: true,
        },
      })
    : [];

  const existingRentalPaymentIds = new Set(
    existingRentalPayments.map((payment: (typeof existingRentalPayments)[number]) => payment.rentalId).filter(Boolean)
  );

  const rentalFeePct = Number(feeSettings.rentalFeePct ?? 0);
  const missingRentalRows = rentalBookings
    .filter((rental: (typeof rentalBookings)[number]) => !existingRentalPaymentIds.has(rental.id))
    .map((rental: (typeof rentalBookings)[number]) => {
      const baseAmountAed = Number(rental.subtotalAed ?? 0);
      const expectedRentalFeeAed = Number(((baseAmountAed * rentalFeePct) / 100).toFixed(2));
      if (expectedRentalFeeAed <= 0) return null;

      return {
        payerId: sellerId,
        purpose: "RENTAL" as const,
        status: "PENDING" as const,
        amountAed: expectedRentalFeeAed,
        currency: "AED",
        provider: "MANUAL_ADMIN_REVIEW",
        providerPaymentRef: `RENTAL:${rental.id}:FEE`,
        rentalId: rental.id,
      };
    })
    .filter(Boolean) as Array<{
    payerId: string;
    purpose: "RENTAL";
    status: "PENDING";
    amountAed: number;
    currency: string;
    provider: string;
    providerPaymentRef: string;
    rentalId: string;
  }>;

  if (missingRentalRows.length > 0) {
    await prisma.payment.createMany({ data: missingRentalRows });
  }

  const payments = await prisma.payment.findMany({
    where: {
      payerId: sellerId,
      purpose: {
        in: ["COMMISSION", "LISTING_FEE", "RENTAL"],
      },
    },
    include: {
      offer: {
        select: {
          id: true,
          offerPriceAed: true,
          listing: {
            select: {
              id: true,
              make: true,
              model: true,
              year: true,
              paymentModel: true,
              commissionRatePct: true,
            },
          },
        },
      },
      rental: {
        select: {
          id: true,
          subtotalAed: true,
          totalAed: true,
          listing: {
            select: {
              id: true,
              make: true,
              model: true,
              year: true,
              paymentModel: true,
              commissionRatePct: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const listingIdsFromPaymentRef = Array.from(
    new Set(
      payments
        .map((payment: (typeof payments)[number]) => {
          if (payment.purpose !== "LISTING_FEE") return null;
          const ref = parsePaymentRefBase(payment.providerPaymentRef);
          const match = /^LISTING:([^:|]+):FEE$/i.exec(ref);
          return match?.[1] ?? null;
        })
        .filter(Boolean)
    )
  ) as string[];

  const referencedListings = listingIdsFromPaymentRef.length
    ? await prisma.listing.findMany({
        where: { id: { in: listingIdsFromPaymentRef }, sellerId },
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
          paymentModel: true,
          priceSellAed: true,
        },
      })
    : [];

  const listingById = new Map(referencedListings.map((listing: (typeof referencedListings)[number]) => [listing.id, listing]));

  const invoices = payments.map((payment: (typeof payments)[number]) => {
    const isPaid = payment.status === "PAID";
    const listingFromOffer = payment.offer?.listing;
    const listingFromRefId = (() => {
      const ref = parsePaymentRefBase(payment.providerPaymentRef);
      const match = /^LISTING:([^:|]+):FEE$/i.exec(ref);
      return match?.[1] ?? null;
    })();
    const listingFromRef = listingFromRefId ? listingById.get(listingFromRefId) : null;
    const listingFromRental = payment.rental?.listing;
    const listing = listingFromOffer ?? listingFromRef ?? listingFromRental;

    const listingFromRefPriceAed = Number((listingFromRef as { priceSellAed?: unknown } | null)?.priceSellAed ?? 0);
    const rentalSubtotalAed = Number(payment.rental?.subtotalAed ?? payment.rental?.totalAed ?? 0);
    const saleAmountAed =
      payment.purpose === "RENTAL"
        ? rentalSubtotalAed
        : Number(payment.offer?.offerPriceAed ?? listingFromRefPriceAed ?? 0);
    const commissionRatePct =
      payment.purpose === "COMMISSION"
        ? Number(listingFromOffer?.commissionRatePct ?? 0)
        : payment.purpose === "RENTAL"
          ? rentalFeePct
          : 0;
    const expectedCommissionAed = Number(payment.amountAed ?? 0);
    const transferMeta = parseTransferMetaFromPaymentRef(payment.providerPaymentRef);
    const transferStatus =
      payment.status === "PAID"
        ? "PAID"
        : payment.provider === "MANUAL_TRANSFER_SUBMITTED"
          ? "WAITING_ADMIN"
          : "NOT_SUBMITTED";

    return {
      invoiceId: payment.id,
      offerId: payment.offerId ?? null,
      listingId: listing?.id ?? null,
      listingTitle: [listing?.make, listing?.model, listing?.year ? String(listing.year) : null]
        .filter(Boolean)
        .join(" ") || "Listing",
      paymentModel: listing?.paymentModel ?? null,
      invoiceType: payment.purpose,
      transferStatus,
      transferReference: transferMeta.transferReference,
      transferredAt: transferMeta.transferredAt,
      transferNote: transferMeta.note,
      saleAmountAed,
      commissionRatePct,
      expectedCommissionAed,
      status: isPaid ? "PAID" : "UNPAID",
      paidAmountAed: isPaid ? Number(payment.amountAed ?? 0) : 0,
      paidAt: payment.paidAt?.toISOString() ?? null,
      paymentReference: payment.providerPaymentRef ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.paidAt?.toISOString() ?? payment.createdAt.toISOString(),
      contactLink: "/my-groups?tab=personals",
    };
  });

  res.status(200).json({
    items: invoices,
    summary: {
      total: invoices.length,
      paid: invoices.filter((item: (typeof invoices)[number]) => item.status === "PAID").length,
      unpaid: invoices.filter((item: (typeof invoices)[number]) => item.status === "UNPAID").length,
      expectedCommissionAed: Number(
        invoices
          .reduce((acc: number, item: (typeof invoices)[number]) => acc + item.expectedCommissionAed, 0)
          .toFixed(2)
      ),
      paidCommissionAed: Number(
        invoices
          .reduce((acc: number, item: (typeof invoices)[number]) => acc + item.paidAmountAed, 0)
          .toFixed(2)
      ),
    },
  });
};

export const submitSellerFeeInvoiceTransfer = async (req: Request<{ id: string; paymentId: string }>, res: Response) => {
  const sellerId = String(req.params.id);
  const paymentId = String(req.params.paymentId);
  const authUserId = (req as Request & { authUser?: { id: string } }).authUser?.id;

  if (!authUserId || authUserId !== sellerId) {
    res.status(403).json({ message: "Only authenticated seller can submit transfer" });
    return;
  }

  const payload = z
    .object({
      transferReference: z.string().trim().min(3).max(120),
      transferredAt: z.string().datetime(),
      note: z.string().trim().max(500).optional(),
    })
    .parse(req.body);

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      payerId: true,
      purpose: true,
      status: true,
      amountAed: true,
      providerPaymentRef: true,
    },
  });

  if (!payment || payment.payerId !== sellerId) {
    res.status(404).json({ message: "Fee invoice not found" });
    return;
  }

  if (payment.purpose !== "LISTING_FEE" && payment.purpose !== "COMMISSION" && payment.purpose !== "RENTAL") {
    res.status(400).json({ message: "Only LISTING_FEE, COMMISSION, or RENTAL invoices are allowed" });
    return;
  }

  if (payment.status === "PAID") {
    res.status(409).json({ message: "Invoice already paid" });
    return;
  }

  const baseRef = parsePaymentRefBase(payment.providerPaymentRef) || `PAYMENT:${payment.id}`;
  const providerPaymentRef = appendTransferMetaToPaymentRef(baseRef, {
    transferReference: payload.transferReference,
    transferredAt: payload.transferredAt,
    note: payload.note,
  });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      provider: "MANUAL_TRANSFER_SUBMITTED",
      providerPaymentRef,
    },
  });

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((admin: { id: string }) => ({
        userId: admin.id,
        type: "SYSTEM",
        priority: "HIGH",
        title: "Fee transfer submitted",
        body: `Seller submitted transfer for ${payment.purpose} invoice (AED ${Number(payment.amountAed).toFixed(2)}).`,
        link: "/admin?tab=fee-settings",
      })),
    });
  }

  res.status(200).json(updated);
};

export const uploadUserAvatar = async (
  req: Request<{ id: string }> & { file?: Express.Multer.File; authUser?: { id: string; role: "USER" | "ADMIN" } },
  res: Response
) => {
  const userId = String(req.params.id);
  const authUser = req.authUser;

  if (!authUser) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  if (authUser.id !== userId && authUser.role !== "ADMIN") {
    res.status(403).json({ message: "You are not allowed to update this avatar" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }

  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  const avatarPath = await storageService.uploadFile(req.file.buffer, req.file.originalname, "profiles/users", req.file.mimetype);

  try {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: avatarPath },
      select: {
        id: true,
        avatarUrl: true,
      },
    });

    if (current?.avatarUrl && current.avatarUrl !== avatarPath) {
      await storageService.deleteFile(current.avatarUrl);
    }

    const signedAvatarUrl = await signAvatar(updated.avatarUrl);
    res.status(200).json({ ...updated, avatarUrl: signedAvatarUrl });
  } catch (error) {
    await storageService.deleteFile(avatarPath);
    throw error;
  }
};

export const getUserById = async (req: Request<{ id: string }>, res: Response) => {
  const userId = String(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      identityProfile: true,
    },
  });

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.status(200).json({
    ...user,
    avatarUrl: await signAvatar(user.avatarUrl),
  });
};

export const getAdminUserDetail = async (req: Request<{ id: string }>, res: Response) => {
  const userId = String(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      verificationStatus: true,
      createdAt: true,
      verificationSubmissions: {
        orderBy: {
          submittedAt: "desc",
        },
        take: 1,
        select: {
          id: true,
          status: true,
          reviewerNotes: true,
          submittedAt: true,
          reviewedAt: true,
          documents: {
            orderBy: {
              createdAt: "asc",
            },
            select: {
              id: true,
              documentType: true,
              fileUrl: true,
              mimeType: true,
              fileSizeBytes: true,
              createdAt: true,
            },
          },
        },
      },
      _count: {
        select: {
          ownedListings: true,
        },
      },
    },
  });

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const latestVerificationSubmission = await signVerificationDocuments(user.verificationSubmissions[0] ?? null);

  const listingTypeCounts = await prisma.listing.groupBy({
    by: ["listingType"],
    where: {
      sellerId: userId,
    },
    _count: {
      _all: true,
    },
  });

  const saleListings =
    listingTypeCounts.find((item: { listingType: "SELL" | "RENT"; _count: { _all: number } }) => item.listingType === "SELL")
      ?._count._all ?? 0;
  const rentListings =
    listingTypeCounts.find((item: { listingType: "SELL" | "RENT"; _count: { _all: number } }) => item.listingType === "RENT")
      ?._count._all ?? 0;

  res.status(200).json({
    ...user,
    avatarUrl: await signAvatar(user.avatarUrl),
    verificationSubmissions: latestVerificationSubmission ? [latestVerificationSubmission] : [],
    listingsSummary: {
      total: user._count.ownedListings,
      sale: saleListings,
      rent: rentListings,
    },
    latestVerificationSubmission,
  });
};

export const updateUserById = async (req: Request<{ id: string }>, res: Response) => {
  const userId = String(req.params.id);
  const data = updateUserSchema.parse(req.body);

  const shouldAutoApproveIdentity = data.role === "ADMIN";

  const user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: shouldAutoApproveIdentity
        ? {
            ...data,
            verificationStatus: "APPROVED",
          }
        : data,
    });

    if (shouldAutoApproveIdentity) {
      await tx.userIdentityProfile.upsert({
        where: { userId },
        update: {
          verificationStatus: "APPROVED",
          verifiedAt: new Date(),
        },
        create: {
          userId,
          verificationStatus: "APPROVED",
          verifiedAt: new Date(),
        },
      });
    }

    return updated;
  });

  res.status(200).json(user);
};

export const upsertUserIdentity = async (req: Request<{ id: string }>, res: Response) => {
  const userId = String(req.params.id);
  const payload = updateIdentitySchema.parse(req.body);

  const identity = await prisma.userIdentityProfile.upsert({
    where: { userId },
    update: {
      ...payload,
      dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : undefined,
      emiratesIdExpiry: payload.emiratesIdExpiry ? new Date(payload.emiratesIdExpiry) : undefined,
      drivingLicenseExpiry: payload.drivingLicenseExpiry ? new Date(payload.drivingLicenseExpiry) : undefined,
      passportExpiry: payload.passportExpiry ? new Date(payload.passportExpiry) : undefined,
    },
    create: {
      userId,
      ...payload,
      dateOfBirth: payload.dateOfBirth ? new Date(payload.dateOfBirth) : undefined,
      emiratesIdExpiry: payload.emiratesIdExpiry ? new Date(payload.emiratesIdExpiry) : undefined,
      drivingLicenseExpiry: payload.drivingLicenseExpiry ? new Date(payload.drivingLicenseExpiry) : undefined,
      passportExpiry: payload.passportExpiry ? new Date(payload.passportExpiry) : undefined,
    },
  });

  res.status(200).json(identity);
};

export const getSellerDashboardOverview = async (req: Request<{ id: string }>, res: Response) => {
  const sellerId = String(req.params.id);
  const range = parseDashboardRange(req.query.range);
  const startDate = getRangeStart(range);

  const [
    totalListings,
    activeSellListings,
    activeRentListings,
    soldListings,
    pendingRentRequests,
    groupsActive,
    offerPendingSellerReview,
    recentRentals,
    recentOffers,
    unreadConversations,
    unreadNotifications,
    sellerRevenue,
  ] = await Promise.all([
    prisma.listing.count({ where: { sellerId } }),
    prisma.listing.count({ where: { sellerId, listingType: "SELL", status: "ACTIVE" } }),
    prisma.listing.count({ where: { sellerId, listingType: "RENT", status: "ACTIVE" } }),
    prisma.listing.count({ where: { sellerId, status: "SOLD" } }),
    prisma.rentalBooking.count({ where: { listing: { sellerId }, status: "REQUESTED" } }),
    prisma.group.count({ where: { listing: { sellerId }, status: { in: ["FORMING", "ACTIVE"] } } }),
    prisma.jointOffer.count({ where: { listing: { sellerId }, status: "PENDING_SELLER_REVIEW" } }),
    prisma.rentalBooking.findMany({
      where: { listing: { sellerId } },
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        renter: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
        listing: true,
      },
    }),
    prisma.jointOffer.findMany({
      where: { listing: { sellerId } },
        take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        listing: true,
        participants: true,
        group: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    email: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.conversationParticipant.count({
      where: {
        userId: sellerId,
        conversation: {
          messages: {
            some: {
              senderId: { not: sellerId },
              createdAt: {
                gt: startDate,
              },
            },
          },
        },
      },
    }),
      prisma.notification.count({
        where: {
          userId: sellerId,
          isRead: false,
        },
      }),
    prisma.payment.aggregate({
      where: {
        status: "PAID",
        OR: [
          { rental: { listing: { sellerId } } },
          { offer: { listing: { sellerId } } },
        ],
      },
      _sum: { amountAed: true },
    }),
  ]);

  const [eventsCurrentRange, eventsPreviousRange] = await Promise.all([
    prisma.analyticsEvent.count({
      where: {
        OR: [{ actorUserId: sellerId }, { listing: { sellerId } }],
        createdAt: { gte: startDate },
      },
    }),
    prisma.analyticsEvent.count({
      where: {
        OR: [{ actorUserId: sellerId }, { listing: { sellerId } }],
        createdAt: {
          gte: new Date(startDate.getTime() - rangeToDays(range) * 24 * 60 * 60 * 1000),
          lt: startDate,
        },
      },
    }),
  ]);

  const activityDeltaPct = getChangePercent(eventsCurrentRange, eventsPreviousRange);

  res.status(200).json({
    range,
    summary: {
      totalListings,
      activeSellListings,
      activeRentListings,
      soldListings,
      pendingRentRequests,
      groupsActive,
      offerPendingSellerReview,
      unreadConversations,
        unreadNotifications,
      activityDeltaPct,
      revenueAed: sellerRevenue._sum.amountAed ?? 0,
    },
    recent: {
      rentals: recentRentals,
      offers: recentOffers,
    },
  });
};

export const getSellerDashboardCharts = async (req: Request<{ id: string }>, res: Response) => {
  const sellerId = String(req.params.id);
  const range = parseDashboardRange(req.query.range);
  const startDate = getRangeStart(range);

  const [views, inquiries, offers, bookings, revenuePayments] = await Promise.all([
    prisma.analyticsEvent.findMany({
      where: {
        eventType: "LISTING_VIEW",
        listing: { sellerId },
        createdAt: { gte: startDate },
      },
      select: { createdAt: true },
    }),
    prisma.analyticsEvent.findMany({
      where: {
        eventType: "LISTING_INQUIRY",
        listing: { sellerId },
        createdAt: { gte: startDate },
      },
      select: { createdAt: true },
    }),
    prisma.analyticsEvent.findMany({
      where: {
        eventType: "OFFER_SUBMITTED",
        listing: { sellerId },
        createdAt: { gte: startDate },
      },
      select: { createdAt: true },
    }),
    prisma.rentalBooking.findMany({
      where: { listing: { sellerId }, createdAt: { gte: startDate } },
      select: { createdAt: true },
    }),
    prisma.payment.findMany({
      where: {
        status: "PAID",
        createdAt: { gte: startDate },
        OR: [{ rental: { listing: { sellerId } } }, { offer: { listing: { sellerId } } }],
      },
      select: { createdAt: true, amountAed: true },
    }),
  ]);

  const buckets = {
    views: buildDayBuckets(range),
    inquiries: buildDayBuckets(range),
    offers: buildDayBuckets(range),
    bookings: buildDayBuckets(range),
    revenue: buildDayBuckets(range),
  };

  for (const row of views) {
    const key = makeDayKey(row.createdAt);
    if (buckets.views.map.has(key)) buckets.views.map.set(key, (buckets.views.map.get(key) ?? 0) + 1);
  }

  for (const row of inquiries) {
    const key = makeDayKey(row.createdAt);
    if (buckets.inquiries.map.has(key)) buckets.inquiries.map.set(key, (buckets.inquiries.map.get(key) ?? 0) + 1);
  }

  for (const row of offers) {
    const key = makeDayKey(row.createdAt);
    if (buckets.offers.map.has(key)) buckets.offers.map.set(key, (buckets.offers.map.get(key) ?? 0) + 1);
  }

  for (const row of bookings) {
    const key = makeDayKey(row.createdAt);
    if (buckets.bookings.map.has(key)) buckets.bookings.map.set(key, (buckets.bookings.map.get(key) ?? 0) + 1);
  }

  for (const row of revenuePayments) {
    const key = makeDayKey(row.createdAt);
    if (buckets.revenue.map.has(key)) {
      const current = buckets.revenue.map.get(key) ?? 0;
      buckets.revenue.map.set(key, current + Number(row.amountAed));
    }
  }

  res.status(200).json({
    range,
    labels: buckets.views.labels,
    series: {
      views: buckets.views.labels.map((key) => buckets.views.map.get(key) ?? 0),
      inquiries: buckets.inquiries.labels.map((key) => buckets.inquiries.map.get(key) ?? 0),
      offers: buckets.offers.labels.map((key) => buckets.offers.map.get(key) ?? 0),
      bookings: buckets.bookings.labels.map((key) => buckets.bookings.map.get(key) ?? 0),
      revenueAed: buckets.revenue.labels.map((key) => Number((buckets.revenue.map.get(key) ?? 0).toFixed(2))),
    },
  });
};
