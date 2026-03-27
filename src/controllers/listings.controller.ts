import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { ensurePlatformFeeSettings, mapPlatformFeeSettings } from "../lib/platform-fees";
import { parsePagination } from "../routes/utils";
import { purgeCancelledGroups } from "../lib/group-lifecycle";
import { getUserVerificationGate } from "../lib/identity-verification";
import { sanitizePlainText } from "../lib/security";

type AuthedRequest = Request & {
  authUser?: {
    id: string;
    role: "USER" | "ADMIN";
  };
};

const createListingSchema = z.object({
  assetClass: z.enum(["CAR", "TRUCK", "BIKE", "PLATE", "PART"]),
  category: z.enum(["CARS", "TRUCKS", "BIKES", "PARTS", "PLATES"]),
  listingType: z.enum(["SELL", "RENT"]),
  title: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().optional(),
  description: z.string().optional(),
  condition: z.enum(["NEW", "USED"]).optional(),
  bodyType: z.string().optional(),
  mileageKm: z.number().int().optional(),
  locationArea: z.string().optional(),
  locationCity: z.string().optional(),
  locationCountry: z.string().optional(),
  engine: z.string().optional(),
  engineShape: z.string().optional(),
  engineCylinders: z.number().int().optional(),
  engineDisplacementCc: z.number().int().optional(),
  forcedInduction: z.string().optional(),
  transmission: z.string().optional(),
  fuelType: z.string().optional(),
  horsepower: z.number().int().optional(),
  torqueNm: z.number().int().optional(),
  accelerationZeroTo100: z.string().optional(),
  quarterMile: z.string().optional(),
  topSpeedKph: z.number().int().optional(),
  driveType: z.string().optional(),
  regionSpec: z.string().optional(),
  exteriorColor: z.string().optional(),
  interiorColor: z.string().optional(),
  seatingCapacity: z.number().int().optional(),
  warranty: z.string().optional(),
  vin: z.string().optional(),
  truckPayloadKg: z.number().int().optional(),
  truckTowingCapacityKg: z.number().int().optional(),
  truckDriveType: z.string().optional(),
  bikeType: z.string().optional(),
  bikeTransmission: z.string().optional(),
  plateCode: z.string().optional(),
  plateNumber: z.string().optional(),
  plateEmirate: z.string().optional(),
  plateCategory: z.string().optional(),
  partName: z.string().optional(),
  partCategory: z.string().optional(),
  partBrand: z.string().optional(),
  partCompatibility: z.string().optional(),
  partSku: z.string().optional(),
  priceSellAed: z.number().optional(),
  rentPriceDayAed: z.number().optional(),
  rentPriceWeekAed: z.number().optional(),
  rentPriceMonthAed: z.number().optional(),
  rentPriceYearAed: z.number().optional(),
  rentMinDurationDays: z.number().int().optional(),
  rentSecurityDepositAed: z.number().optional(),
  paymentModel: z.string().optional(),
  commissionRatePct: z.number().optional(),
  listingFeeAed: z.number().optional(),
  enableGrouping: z.boolean().optional(),
  inspectorName: z.string().optional(),
  inspectorCompany: z.string().optional(),
  verificationType: z.enum(["NONE", "ROAMER", "THIRD_PARTY"]).optional(),
});

const updateListingSchema = createListingSchema.partial().extend({
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "SOLD", "EXPIRED", "ARCHIVED"]).optional(),
});

const adminReviewListingSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().min(3).max(400).optional(),
    rejectionArea: z.string().trim().min(2).max(120).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.decision === "REJECT" && !payload.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Reason is required when rejecting a listing",
      });
    }
  });

const adminReviewListingVerificationSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().min(3).max(400).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.decision === "REJECT" && !payload.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Reason is required when rejecting verification",
      });
    }
  });

const mediaSchema = z.object({
  mediaType: z.enum([
    "COVER_IMAGE",
    "GALLERY_IMAGE",
    "PHOTO",
    "GARAGE_VIDEO",
    "GARAGE_PHOTO",
    "DOCUMENT_MULKIYA",
    "DOCUMENT_INSPECTION",
  ]),
  url: z.string().min(1),
  sortOrder: z.number().int().optional(),
  mimeType: z.string().optional(),
  fileSizeBytes: z.number().int().optional(),
});

const MANUAL_GARAGE_ASSET_NOTES = "Created from Add to Garage";
const buildListingFeePaymentRef = (listingId: string) => `LISTING:${listingId}:FEE`;

const listListingsQuerySchema = z.object({
  q: z.string().optional(),
  sellerId: z.string().optional(),
  listingType: z.enum(["SELL", "RENT"]).optional(),
  category: z.enum(["CARS", "TRUCKS", "BIKES", "PARTS", "PLATES"]).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "SOLD", "EXPIRED", "ARCHIVED"]).optional(),
  moderationStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  verificationType: z.enum(["NONE", "ROAMER", "THIRD_PARTY"]).optional(),
  verificationLevel: z.enum(["NONE", "ROAMER", "THIRD_PARTY"]).optional(),
});

export const listListings = async (req: Request, res: Response) => {
  await purgeCancelledGroups(prisma);

  const { skip, limit, page } = parsePagination(req);
  const query = listListingsQuerySchema.parse(req.query);
  const q = query.q ? sanitizePlainText(query.q, 120) : "";
  const sellerId = query.sellerId;
  const listingType = query.listingType;
  const category = query.category;
  const status = query.status;
  const moderationStatus = query.moderationStatus;
  const verificationType = query.verificationType;
  const verificationLevel = query.verificationLevel;

  const where: any = {
    ...(q
      ? {
          OR: [
            { make: { contains: q, mode: "insensitive" as const } },
            { model: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(sellerId ? { sellerId } : {}),
    ...(listingType ? { listingType } : {}),
    ...(category ? { category } : {}),
    ...(status ? { status } : {}),
    ...(moderationStatus ? { moderationStatus } : {}),
    ...(verificationType ? { verificationType } : {}),
    ...(verificationLevel ? { verificationLevel } : {}),
    garageAssets: {
      none: {
        assetType: "OWNED",
        notes: MANUAL_GARAGE_ASSET_NOTES,
      },
    },
  };

  const [items, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: {
        media: true,
        _count: {
          select: {
            groups: {
              where: {
                status: {
                  in: ["FORMING", "ACTIVE"],
                },
              },
            },
          },
        },
        seller: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.listing.count({ where }),
  ]);

  res.status(200).json({
    items: items.map((item: (typeof items)[number]) => ({
      ...item,
      groupsActive: item._count.groups,
    })),
    total,
    page,
    limit,
  });
};

export const getListingFeeSettings = async (_req: Request, res: Response) => {
  const row = await ensurePlatformFeeSettings();
  res.status(200).json(mapPlatformFeeSettings(row));
};

export const createListing = async (req: Request, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const verificationGate = await getUserVerificationGate(authUserId);
  if (!verificationGate.allowed) {
    const baseMessage =
      verificationGate.status === "PENDING"
        ? "Your identity verification is still pending admin review"
        : verificationGate.status === "REJECTED"
          ? "Your identity verification was rejected. Please resubmit your documents"
          : "Identity verification is required before posting listings";

    res.status(403).json({
      message: verificationGate.rejectionReason
        ? `${baseMessage}. Reason: ${verificationGate.rejectionReason}`
        : baseMessage,
      verificationStatus: verificationGate.status,
      verificationRejectionReason: verificationGate.rejectionReason,
    });
    return;
  }

  const payload = createListingSchema.parse(req.body);
  const feeSettings = mapPlatformFeeSettings(await ensurePlatformFeeSettings());

  const requestedPaymentModel = String(payload.paymentModel ?? "commission").toLowerCase();
  const selectedPaymentModel =
    requestedPaymentModel === "listing_fee" || requestedPaymentModel === "hybrid" || requestedPaymentModel === "commission"
      ? requestedPaymentModel
      : "commission";

  let paymentModel: "listing_fee" | "commission" | "hybrid" = selectedPaymentModel;
  let commissionRatePct: number | undefined;
  let listingFeeAed: number | undefined;

  const sellPriceAed = payload.priceSellAed ?? 0;
  const listingFeeByPct = sellPriceAed > 0 ? Number(((sellPriceAed * feeSettings.listingFeePct) / 100).toFixed(2)) : undefined;
  const hybridUpfrontPct =
    feeSettings.hybridListingFeeAed > 0 && feeSettings.hybridListingFeeAed <= 100
      ? feeSettings.hybridListingFeeAed
      : feeSettings.listingFeePct;
  const hybridListingFeeByPct = sellPriceAed > 0 ? Number(((sellPriceAed * hybridUpfrontPct) / 100).toFixed(2)) : undefined;

  if (payload.listingType === "RENT") {
    paymentModel = "commission";
    commissionRatePct = feeSettings.rentalFeePct;
    listingFeeAed = undefined;
  } else if (paymentModel === "listing_fee") {
    commissionRatePct = 0;
    listingFeeAed = listingFeeByPct;
  } else if (paymentModel === "hybrid") {
    commissionRatePct = feeSettings.hybridCommissionPct;
    listingFeeAed = hybridListingFeeByPct;
  } else {
    commissionRatePct = feeSettings.saleCommissionPct;
    listingFeeAed = undefined;
  }

  const listing = await prisma.listing.create({
    data: {
      ...payload,
      paymentModel,
      commissionRatePct,
      listingFeeAed,
      sellerId: authUserId,
      status: "DRAFT",
      moderationStatus: "PENDING",
      moderationReason: null,
      verificationType: payload.verificationType ?? "NONE",
      verificationLevel: "NONE",
      reviewedAt: null,
      reviewedById: null,
      publishedAt: null,
    },
  });

  await prisma.analyticsEvent.create({
    data: {
      eventType: "LISTING_SAVE",
      actorUserId: authUserId,
      listingId: listing.id,
      metadata: {
        activityType: "USER_POST_LISTING",
        listingType: listing.listingType,
        category: listing.category,
      },
    },
  });

  if (
    listing.listingType === "SELL" &&
    (listing.paymentModel === "listing_fee" || listing.paymentModel === "hybrid") &&
    Number(listing.listingFeeAed ?? 0) > 0
  ) {
    await prisma.payment.create({
      data: {
        payerId: authUserId,
        purpose: "LISTING_FEE",
        status: "PENDING",
        amountAed: Number(listing.listingFeeAed ?? 0),
        currency: "AED",
        provider: "MANUAL_ADMIN_REVIEW",
        providerPaymentRef: buildListingFeePaymentRef(listing.id),
      },
    });
  }

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { id: true },
  });

  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((admin: { id: string }) => ({
        userId: admin.id,
        type: "LISTING",
        title: "New listing needs verification",
        body: `${payload.make ?? "Listing"} ${payload.model ?? ""}`.trim() || "A listing is waiting for admin review.",
        link: "/admin?tab=listings",
      })),
    });
  }

  await prisma.notification.create({
    data: {
      userId: authUserId,
      type: "LISTING",
      title: "Listing submitted for review",
      body: "Your listing is pending admin verification before going live.",
      link: "/seller-dashboard",
    },
  });

  res.status(201).json(listing);
};

export const getListingById = async (req: Request<{ id: string }>, res: Response) => {
  await purgeCancelledGroups(prisma);

  const listingId = String(req.params.id);

  const item = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      media: true,
      _count: {
        select: {
          groups: {
            where: {
              status: {
                in: ["FORMING", "ACTIVE"],
              },
            },
          },
        },
      },
      maintenanceLogs: { include: { items: true } },
      seller: {
        select: {
          id: true,
          fullName: true,
        },
      },
    },
  });

  if (!item) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  res.status(200).json({
    ...item,
    groupsActive: item._count.groups,
  });
};

export const trackListingView = async (req: Request<{ id: string }>, res: Response) => {
  const listingId = String(req.params.id);

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true },
  });

  if (!listing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  const [updatedListing] = await prisma.$transaction([
    prisma.listing.update({
      where: { id: listingId },
      data: {
        viewsCount: {
          increment: 1,
        },
      },
      select: {
        id: true,
        viewsCount: true,
      },
    }),
    prisma.analyticsEvent.create({
      data: {
        eventType: "LISTING_VIEW",
        listingId,
      },
    }),
  ]);

  res.status(200).json({
    listingId: updatedListing.id,
    viewsCount: updatedListing.viewsCount,
  });
};

export const updateListingById = async (req: Request<{ id: string }>, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const isAdmin = authedReq.authUser?.role === "ADMIN";
  const listingId = String(req.params.id);
  const payload = updateListingSchema.parse(req.body);

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      moderationStatus: true,
      make: true,
      model: true,
    },
  });

  if (!existing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  if (!isAdmin && existing.sellerId !== authUserId) {
    res.status(403).json({ message: "You can only edit your own listing" });
    return;
  }

  if (!isAdmin && payload.status === "ACTIVE" && existing.moderationStatus !== "APPROVED") {
    res.status(409).json({
      message: "Listing belum diverifikasi admin. Tidak bisa diaktifkan sebelum approved.",
    });
    return;
  }

  const shouldResubmitForReview = !isAdmin && existing.moderationStatus === "REJECTED";

  const data = {
    ...payload,
    ...(shouldResubmitForReview
      ? {
          status: "DRAFT" as const,
          moderationStatus: "PENDING" as const,
          moderationReason: null,
          reviewedAt: null,
          reviewedById: null,
        }
      : {}),
  };

  const listing = await prisma.listing.update({
    where: { id: listingId },
    data,
  });

  if (shouldResubmitForReview) {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });

    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((admin: { id: string }) => ({
          userId: admin.id,
          type: "LISTING",
          title: "Listing resubmitted",
          body: `${existing.make ?? "Listing"} ${existing.model ?? ""}`.trim() || "A listing has been resubmitted for review.",
          link: "/admin?tab=listings",
        })),
      });
    }
  }

  res.status(200).json(listing);
};

export const adminReviewListingById = async (req: Request<{ id: string }>, res: Response) => {
  const authedReq = req as AuthedRequest;
  const reviewerId = authedReq.authUser?.id;
  if (!reviewerId || authedReq.authUser?.role !== "ADMIN") {
    res.status(403).json({ message: "Admin access required" });
    return;
  }

  const listingId = String(req.params.id);
  const payload = adminReviewListingSchema.parse(req.body);

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      sellerId: true,
      make: true,
      model: true,
      listingType: true,
      paymentModel: true,
      listingFeeAed: true,
    },
  });

  if (!existing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  const now = new Date();
  const rejectionMessage = payload.decision === "REJECT"
    ? `${payload.rejectionArea ? `Ditolak pada bagian: ${payload.rejectionArea}. ` : ""}${payload.reason ?? "Perlu perbaikan pada data listing."}`
    : null;

  const updated = await prisma.$transaction(async (tx: typeof prisma) => {
    if (
      payload.decision === "APPROVE" &&
      existing.listingType === "SELL" &&
      (existing.paymentModel === "listing_fee" || existing.paymentModel === "hybrid") &&
      Number(existing.listingFeeAed ?? 0) > 0
    ) {
      const paymentRef = buildListingFeePaymentRef(existing.id);
      const latestListingFeePayment = await tx.payment.findFirst({
        where: {
          payerId: existing.sellerId,
          purpose: "LISTING_FEE",
          providerPaymentRef: paymentRef,
        },
        orderBy: { createdAt: "desc" },
      });

      if (!latestListingFeePayment) {
        await tx.payment.create({
          data: {
            payerId: existing.sellerId,
            purpose: "LISTING_FEE",
            status: "PAID",
            amountAed: Number(existing.listingFeeAed ?? 0),
            currency: "AED",
            provider: "MANUAL_ADMIN_APPROVED",
            providerPaymentRef: paymentRef,
            paidAt: now,
          },
        });
      } else if (latestListingFeePayment.status !== "PAID") {
        await tx.payment.update({
          where: { id: latestListingFeePayment.id },
          data: {
            status: "PAID",
            paidAt: now,
            provider: "MANUAL_ADMIN_APPROVED",
          },
        });
      }
    }

    return tx.listing.update({
      where: { id: listingId },
      data: {
        moderationStatus: payload.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        moderationReason: rejectionMessage,
        reviewedById: reviewerId,
        reviewedAt: now,
        status: payload.decision === "APPROVE" ? "ACTIVE" : "DRAFT",
        ...(payload.decision === "APPROVE" ? { publishedAt: now } : {}),
      },
    });
  });

  await prisma.notification.create({
    data: {
      userId: existing.sellerId,
      type: "LISTING",
      title: payload.decision === "APPROVE" ? "Listing verified and live" : "Listing rejected by admin",
      body:
        payload.decision === "APPROVE"
          ? `${existing.make ?? "Listing"} ${existing.model ?? ""}`.trim() + " sudah tayang di marketplace."
          : rejectionMessage ?? "Listing ditolak. Silakan perbaiki lalu submit ulang.",
      link: payload.decision === "APPROVE" ? `/car/${existing.id}` : `/seller/manage/${existing.id}`,
    },
  });

  res.status(200).json(updated);
};

export const adminReviewListingVerificationById = async (req: Request<{ id: string }>, res: Response) => {
  const authedReq = req as AuthedRequest;
  const reviewerId = authedReq.authUser?.id;

  if (!reviewerId || authedReq.authUser?.role !== "ADMIN") {
    res.status(403).json({ message: "Admin access required" });
    return;
  }

  const listingId = String(req.params.id);
  const payload = adminReviewListingVerificationSchema.parse(req.body);

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      sellerId: true,
      make: true,
      model: true,
      verificationType: true,
      verificationLevel: true,
    },
  });

  if (!existing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  if (existing.verificationType === "NONE") {
    res.status(409).json({ message: "Listing does not request verification" });
    return;
  }

  const approvedLevel = existing.verificationType;
  const rejectedMessage = payload.reason?.trim() || "Verification request was rejected by admin.";

  const updated = await prisma.listing.update({
    where: { id: listingId },
    data: {
      verificationLevel: payload.decision === "APPROVE" ? approvedLevel : "NONE",
      reviewedById: reviewerId,
      reviewedAt: new Date(),
      moderationReason: payload.decision === "REJECT" ? rejectedMessage : null,
    },
  });

  await prisma.notification.create({
    data: {
      userId: existing.sellerId,
      type: "LISTING",
      title: payload.decision === "APPROVE" ? "Listing verification approved" : "Listing verification rejected",
      body:
        payload.decision === "APPROVE"
          ? `${existing.make ?? "Listing"} ${existing.model ?? ""}`.trim() + " verification has been approved by admin."
          : rejectedMessage,
      link: `/seller/manage/${existing.id}`,
    },
  });

  res.status(200).json(updated);
};

export const deleteListingById = async (req: Request<{ id: string }>, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const listingId = String(req.params.id);
  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true },
  });

  if (!existing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  if (authedReq.authUser?.role !== "ADMIN" && existing.sellerId !== authUserId) {
    res.status(403).json({ message: "You can only delete your own listing" });
    return;
  }

  await prisma.listing.delete({ where: { id: listingId } });
  res.status(204).send();
};

export const addListingMedia = async (req: Request<{ id: string }>, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const listingId = String(req.params.id);
  const payload = mediaSchema.parse(req.body);

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true },
  });

  if (!existing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  if (authedReq.authUser?.role !== "ADMIN" && existing.sellerId !== authUserId) {
    res.status(403).json({ message: "You can only edit your own listing" });
    return;
  }

  const media = await prisma.listingMedia.create({
    data: {
      listingId,
      ...payload,
    },
  });

  res.status(201).json(media);
};

export const uploadListingMedia = async (
  req: Request<{ id: string }> & { file?: Express.Multer.File },
  res: Response
) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const listingId = String(req.params.id);
  const mediaType = String(req.body?.mediaType ?? "");
  const sortOrder = Number(req.body?.sortOrder ?? 0);

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true },
  });

  if (!existing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  if (authedReq.authUser?.role !== "ADMIN" && existing.sellerId !== authUserId) {
    res.status(403).json({ message: "You can only edit your own listing" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }

  const validMediaType = mediaSchema.shape.mediaType.safeParse(mediaType);
  if (!validMediaType.success) {
    res.status(400).json({ message: "Invalid mediaType" });
    return;
  }

  const host = req.get("host");
  const fileUrl = `${req.protocol}://${host}/uploads/listings/${req.file.filename}`;

  const media = await prisma.listingMedia.create({
    data: {
      listingId,
      mediaType: validMediaType.data,
      url: fileUrl,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
      mimeType: req.file.mimetype,
      fileSizeBytes: req.file.size,
    },
  });

  res.status(201).json(media);
};

export const addMaintenanceLog = async (req: Request<{ id: string }>, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const listingId = String(req.params.id);
  const body = z
    .object({
      serviceDate: z.string().datetime().optional(),
      serviceKm: z.number().int().optional(),
      serviceCenter: z.string().optional(),
      items: z.array(z.string()).optional(),
    })
    .parse(req.body);

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true },
  });

  if (!existing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  if (authedReq.authUser?.role !== "ADMIN" && existing.sellerId !== authUserId) {
    res.status(403).json({ message: "You can only edit your own listing" });
    return;
  }

  const log = await prisma.listingMaintenanceLog.create({
    data: {
      listingId,
      serviceDate: body.serviceDate ? new Date(body.serviceDate) : undefined,
      serviceKm: body.serviceKm,
      serviceCenter: body.serviceCenter,
      items: {
        create: (body.items ?? []).map((text, index) => ({ text, sortOrder: index })),
      },
    },
    include: { items: true },
  });

  res.status(201).json(log);
};
