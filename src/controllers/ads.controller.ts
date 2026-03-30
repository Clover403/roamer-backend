import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { getBannerAdPricingSettings, updateBannerAdPricingSettings } from "../lib/ads-pricing";

const MAX_ACTIVE_BANNER_SLOTS: Record<"MARKETPLACE" | "RENTAL", number> = {
  MARKETPLACE: 3,
  RENTAL: 3,
};

type AuthedRequest = Request & {
  authUser?: {
    id: string;
    role: "USER" | "ADMIN";
  };
};

const createBannerAdSchema = z.object({
  listingId: z.string().min(1),
  placementTarget: z.enum(["MARKETPLACE", "RENTAL"]).default("MARKETPLACE"),
  packageDays: z.number().int().positive(),
  packagePriceAed: z.number().positive(),
  packageLabel: z.string().max(40).optional(),
  topText: z.string().trim().max(80).optional(),
  headline: z.string().trim().min(3).max(80),
  descriptionText: z.string().trim().max(180).optional(),
  subtitle: z.string().trim().max(120).optional(),
  ctaLabel: z.string().trim().max(30).optional(),
  bannerImageUrl: z.string().trim().min(1),
  paymentSubmission: z
    .object({
      senderName: z.string().trim().max(80).optional(),
      senderBank: z.string().trim().max(80).optional(),
      senderAccountNumber: z.string().trim().max(40).optional(),
      transferReference: z.string().trim().max(120).optional(),
      transferredAt: z.string().datetime().optional(),
      note: z.string().trim().max(300).optional(),
      declaredAmountAed: z.number().positive(),
    })
    .optional(),
  slotChoice: z.enum(["WAITLIST", "LATER"]).optional(),
});

const rejectBannerAdSchema = z.object({
  reason: z.string().trim().min(3).max(240).optional(),
});

const isActiveAdTimeWindow = {
  OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
} as const;

const resolveDevTestingDurationMinutes = (packageDays: number) => {
  if (packageDays === 3) return 3;
  if (packageDays === 7) return 7;
  return null;
};

const buildAdExpiry = (startsAt: Date, packageDays: number) => {
  const endsAt = new Date(startsAt);

  if (process.env.NODE_ENV === "development") {
    const durationMinutes = resolveDevTestingDurationMinutes(packageDays);
    if (durationMinutes !== null) {
      endsAt.setMinutes(endsAt.getMinutes() + durationMinutes);
      return endsAt;
    }
  }

  endsAt.setDate(endsAt.getDate() + packageDays);
  return endsAt;
};

export const getBannerAdSlots = async (req: Request, res: Response) => {
  const query = z
    .object({
      placementTarget: z.enum(["MARKETPLACE", "RENTAL"]).default("MARKETPLACE"),
    })
    .parse(req.query);

  const maxSlots = MAX_ACTIVE_BANNER_SLOTS[query.placementTarget];
  const activeSlots = await prisma.bannerAd.count({
    where: {
      status: "ACTIVE",
      placementTarget: query.placementTarget,
      ...isActiveAdTimeWindow,
    },
  });

  res.status(200).json({
    placementTarget: query.placementTarget,
    maxSlots,
    activeSlots,
    availableSlots: Math.max(0, maxSlots - activeSlots),
  });
};

export const getBannerAdPricing = async (_req: Request, res: Response) => {
  const pricing = await getBannerAdPricingSettings();
  res.status(200).json(pricing);
};

export const adminUpdateBannerAdPricing = async (req: AuthedRequest, res: Response) => {
  const authUserId = req.authUser?.id;
  if (!authUserId || req.authUser?.role !== "ADMIN") {
    res.status(403).json({ message: "Admin access required" });
    return;
  }

  const payload = z
    .object({
      package3DaysAed: z.number().positive().max(1_000_000).optional(),
      package7DaysAed: z.number().positive().max(1_000_000).optional(),
      package30DaysAed: z.number().positive().max(1_000_000).optional(),
    })
    .refine((value) => Object.values(value).some((item) => item !== undefined), {
      message: "At least one package price must be provided",
    })
    .parse(req.body);

  const nextThree = payload.package3DaysAed;
  const nextSeven = payload.package7DaysAed;
  const nextThirty = payload.package30DaysAed;

  if (nextThree !== undefined && nextSeven !== undefined && nextThree > nextSeven) {
    res.status(400).json({ message: "3-day package price cannot be higher than 7-day package price" });
    return;
  }
  if (nextSeven !== undefined && nextThirty !== undefined && nextSeven > nextThirty) {
    res.status(400).json({ message: "7-day package price cannot be higher than 30-day package price" });
    return;
  }

  const updated = await updateBannerAdPricingSettings(payload, authUserId);
  res.status(200).json(updated);
};

export const listActiveBannerAds = async (req: Request, res: Response) => {
  const query = z
    .object({
      placementTarget: z.enum(["MARKETPLACE", "RENTAL"]).default("MARKETPLACE"),
    })
    .parse(req.query);

  const items = await prisma.bannerAd.findMany({
    where: {
      status: "ACTIVE",
      placementTarget: query.placementTarget,
      ...isActiveAdTimeWindow,
    },
    include: {
      listing: {
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
          media: {
            select: { url: true, mediaType: true, sortOrder: true },
            orderBy: { sortOrder: "asc" },
          },
          seller: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
      },
    },
    orderBy: [{ startsAt: "desc" }, { createdAt: "desc" }],
    take: MAX_ACTIVE_BANNER_SLOTS[query.placementTarget],
  });

  res.status(200).json(items);
};

export const listMyBannerAds = async (req: AuthedRequest, res: Response) => {
  const authUserId = req.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const items = await prisma.bannerAd.findMany({
    where: { sellerId: authUserId },
    include: {
      listing: {
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(items);
};

export const listBannerAdsForAdmin = async (req: AuthedRequest, res: Response) => {
  if (req.authUser?.role !== "ADMIN") {
    res.status(403).json({ message: "Admin access required" });
    return;
  }

  const query = z
    .object({
      status: z
        .enum(["PENDING_REVIEW", "ACTIVE", "REJECTED", "WAITLIST", "EXPIRED", "CANCELLED"])
        .optional(),
    })
    .parse(req.query);

  const items = await prisma.bannerAd.findMany({
    where: {
      status: query.status,
    },
    include: {
      listing: {
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
          seller: {
            select: {
              id: true,
              fullName: true,
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
    orderBy: [{ createdAt: "desc" }],
  });

  res.status(200).json(items);
};

export const createBannerAd = async (req: AuthedRequest, res: Response) => {
  const authUserId = req.authUser?.id;
  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const payload = createBannerAdSchema.parse(req.body);
  const pricing = await getBannerAdPricingSettings();

  const expectedPriceByDays: Record<number, number> = {
    3: pricing.package3DaysAed,
    7: pricing.package7DaysAed,
    30: pricing.package30DaysAed,
  };

  const expectedPackagePriceAed = expectedPriceByDays[payload.packageDays];
  if (!expectedPackagePriceAed) {
    res.status(400).json({ message: "Unsupported package duration" });
    return;
  }

  if (Math.abs(payload.packagePriceAed - expectedPackagePriceAed) > 0.01) {
    res.status(409).json({
      message: `Promotion package price changed. Please refresh and retry (AED ${expectedPackagePriceAed}).`,
    });
    return;
  }

  const sellerProfile = await prisma.user.findUnique({
    where: { id: authUserId },
    select: { fullName: true, email: true, phone: true },
  });

  const listing = await prisma.listing.findUnique({
    where: { id: payload.listingId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      make: true,
      model: true,
    },
  });

  if (!listing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  if (listing.sellerId !== authUserId) {
    res.status(403).json({ message: "You can only promote your own listing" });
    return;
  }

  if (listing.status !== "ACTIVE") {
    res.status(409).json({ message: "Only active listings can be promoted" });
    return;
  }

  const existing = await prisma.bannerAd.findFirst({
    where: {
      listingId: payload.listingId,
      sellerId: authUserId,
      status: {
        in: ["PENDING_REVIEW", "WAITLIST", "ACTIVE"],
      },
    },
    select: { id: true, status: true },
  });

  if (existing) {
    res.status(409).json({
      message: `An ad request already exists for this listing (${existing.status})`,
    });
    return;
  }

  const maxSlots = MAX_ACTIVE_BANNER_SLOTS[payload.placementTarget];
  const activeSlots = await prisma.bannerAd.count({
    where: {
      status: "ACTIVE",
      placementTarget: payload.placementTarget,
      ...isActiveAdTimeWindow,
    },
  });

  const isSlotsFull = activeSlots >= maxSlots;
  if (isSlotsFull && payload.slotChoice !== "WAITLIST") {
    res.status(409).json({ message: "All banner slots are currently full. Choose waitlist." });
    return;
  }

  const status = "PENDING_REVIEW";

  const paymentSubmission = {
    senderName: payload.paymentSubmission?.senderName ?? sellerProfile?.fullName,
    senderAccountNumber: payload.paymentSubmission?.senderAccountNumber ?? sellerProfile?.phone ?? undefined,
    transferReference: payload.paymentSubmission?.transferReference,
    transferredAt: payload.paymentSubmission?.transferredAt,
    note:
      payload.paymentSubmission?.note ??
      (sellerProfile?.email ? `Submitted by ${sellerProfile.email}` : undefined),
    declaredAmountAed: payload.paymentSubmission?.declaredAmountAed ?? payload.packagePriceAed,
    senderBank: payload.paymentSubmission?.senderBank,
  };

  const ad = await prisma.bannerAd.create({
    data: {
      listingId: payload.listingId,
      sellerId: authUserId,
      placementTarget: payload.placementTarget,
      packageDays: payload.packageDays,
      packagePriceAed: new Prisma.Decimal(payload.packagePriceAed),
      packageLabel: payload.packageLabel,
      topText: payload.topText,
      headline: payload.headline,
      descriptionText: payload.descriptionText,
      subtitle: payload.subtitle,
      ctaLabel: payload.ctaLabel,
      bannerImageUrl: payload.bannerImageUrl,
      paymentSubmission,
      slotChoice: payload.slotChoice,
      status,
    },
    include: {
      listing: {
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
        },
      },
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
        type: "PROMOTION",
        title: "New banner ad request",
        body: `${listing.make ?? "Vehicle"} ${listing.model ?? "listing"} is waiting for review.`,
        link: "/admin?tab=promotions",
      })),
    });
  }

  res.status(201).json(ad);
};

export const adminActivateBannerAd = async (req: AuthedRequest, res: Response) => {
  const authUserId = req.authUser?.id;
  if (!authUserId || req.authUser?.role !== "ADMIN") {
    res.status(403).json({ message: "Admin access required" });
    return;
  }

  const adId = String(req.params.id);
  const existing = await prisma.bannerAd.findUnique({
    where: { id: adId },
    include: {
      listing: {
        select: {
          id: true,
          make: true,
          model: true,
        },
      },
      seller: {
        select: {
          id: true,
          fullName: true,
        },
      },
    },
  });

  if (!existing) {
    res.status(404).json({ message: "Banner ad not found" });
    return;
  }

  if (["REJECTED", "EXPIRED", "CANCELLED"].includes(existing.status)) {
    res.status(409).json({ message: `Cannot activate ad with status ${existing.status}` });
    return;
  }

  const placementTarget = (existing.placementTarget ?? "MARKETPLACE") as "MARKETPLACE" | "RENTAL";
  const activeSlots = await prisma.bannerAd.count({
    where: {
      status: "ACTIVE",
      placementTarget,
      ...isActiveAdTimeWindow,
    },
  });

  const maxSlots = MAX_ACTIVE_BANNER_SLOTS[placementTarget];
  if (activeSlots >= maxSlots) {
    const queued = await prisma.bannerAd.update({
      where: { id: adId },
      data: {
        status: "WAITLIST",
        reviewedById: authUserId,
        reviewedAt: new Date(),
      },
      include: {
        listing: {
          select: {
            id: true,
            make: true,
            model: true,
            year: true,
          },
        },
        seller: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    await prisma.notification.create({
      data: {
        userId: existing.sellerId,
        type: "PROMOTION",
        title: "Banner verified, waiting for slot",
        body: `Payment and content were verified. Your ${placementTarget.toLowerCase()} promotion is queued and will go live when a slot opens.`,
        link: "/seller-dashboard",
      },
    });

    res.status(200).json(queued);
    return;
  }

  const startsAt = new Date();
  const endsAt = buildAdExpiry(startsAt, existing.packageDays);

  const updated = await prisma.bannerAd.update({
    where: { id: adId },
    data: {
      status: "ACTIVE",
      startsAt,
      endsAt,
      rejectionReason: null,
      reviewedById: authUserId,
      reviewedAt: startsAt,
    },
    include: {
      listing: {
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
        },
      },
      seller: {
        select: {
          id: true,
          fullName: true,
        },
      },
    },
  });

  await prisma.notification.create({
    data: {
      userId: existing.sellerId,
      type: "PROMOTION",
      title: "Your banner ad is now live",
      body: `${existing.listing.make ?? "Your listing"} ${existing.listing.model ?? ""} is now featured on ${placementTarget.toLowerCase()} banners.`,
      link: `/car/${existing.listing.id}`,
    },
  });

  res.status(200).json(updated);
};

export const adminRejectBannerAd = async (req: AuthedRequest, res: Response) => {
  const authUserId = req.authUser?.id;
  if (!authUserId || req.authUser?.role !== "ADMIN") {
    res.status(403).json({ message: "Admin access required" });
    return;
  }

  const adId = String(req.params.id);
  const payload = rejectBannerAdSchema.parse(req.body);

  const existing = await prisma.bannerAd.findUnique({
    where: { id: adId },
    include: {
      listing: {
        select: {
          id: true,
          make: true,
          model: true,
        },
      },
    },
  });

  if (!existing) {
    res.status(404).json({ message: "Banner ad not found" });
    return;
  }

  const updated = await prisma.bannerAd.update({
    where: { id: adId },
    data: {
      status: "REJECTED",
      rejectionReason: payload.reason ?? "Submission does not meet banner quality guidelines.",
      reviewedById: authUserId,
      reviewedAt: new Date(),
    },
  });

  await prisma.notification.create({
    data: {
      userId: existing.sellerId,
      type: "PROMOTION",
      title: "Banner ad rejected",
      body: payload.reason ?? "Your banner submission needs changes before it can go live.",
      link: `/promote/${existing.listingId}`,
    },
  });

  res.status(200).json(updated);
};

export const uploadBannerAdImage = async (
  req: Request & { file?: Express.Multer.File },
  res: Response
) => {
  if (!req.file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }

  const host = req.get("host");
  if (!host) {
    res.status(400).json({ message: "Unable to determine host" });
    return;
  }

  const fileUrl = `${req.protocol}://${host}/uploads/promotions/${req.file.filename}`;
  res.status(201).json({ url: fileUrl });
};

export const runBannerAdsLifecycle = async () => {
  const now = new Date();

  const expiringAds = await prisma.bannerAd.findMany({
    where: {
      status: "ACTIVE",
      endsAt: { lte: now },
    },
    select: {
      id: true,
      sellerId: true,
      listingId: true,
    },
  });

  if (expiringAds.length > 0) {
    await prisma.bannerAd.updateMany({
      where: {
        id: {
          in: expiringAds.map((ad: { id: string }) => ad.id),
        },
      },
      data: {
        status: "EXPIRED",
      },
    });

    await prisma.notification.createMany({
      data: expiringAds.map((ad: { sellerId: string; listingId: string }) => ({
        userId: ad.sellerId,
        type: "PROMOTION",
        title: "Banner ad expired",
        body: "Your featured banner has ended. You can submit a new promotion any time.",
        link: `/promote/${ad.listingId}`,
      })),
    });
  }

  const placementTargets: Array<"MARKETPLACE" | "RENTAL"> = ["MARKETPLACE", "RENTAL"];

  for (const placementTarget of placementTargets) {
    const activeSlots = await prisma.bannerAd.count({
      where: {
        status: "ACTIVE",
        placementTarget,
        ...isActiveAdTimeWindow,
      },
    });

    const availableSlots = Math.max(0, MAX_ACTIVE_BANNER_SLOTS[placementTarget] - activeSlots);
    if (availableSlots <= 0) {
      continue;
    }

    const waitlisted = await prisma.bannerAd.findMany({
      where: {
        status: "WAITLIST",
        placementTarget,
        reviewedAt: {
          not: null,
        },
      },
      select: {
        id: true,
        sellerId: true,
        listingId: true,
        packageDays: true,
      },
      orderBy: { createdAt: "asc" },
      take: availableSlots,
    });

    if (waitlisted.length === 0) {
      continue;
    }

    const startsAt = new Date();
    const adIdsByPackageDays = new Map<number, string[]>();

    for (const ad of waitlisted) {
      const current = adIdsByPackageDays.get(ad.packageDays) ?? [];
      current.push(ad.id);
      adIdsByPackageDays.set(ad.packageDays, current);
    }

    const activationOps = Array.from(adIdsByPackageDays.entries()).map(([packageDays, ids]) => {
      const endsAt = buildAdExpiry(startsAt, packageDays);

      return prisma.bannerAd.updateMany({
        where: {
          id: { in: ids },
        },
        data: {
          status: "ACTIVE",
          startsAt,
          endsAt,
          rejectionReason: null,
        },
      });
    });

    if (activationOps.length > 0) {
      await prisma.$transaction(activationOps);
    }

    await prisma.notification.createMany({
      data: waitlisted.map((ad: { sellerId: string; listingId: string }) => ({
        userId: ad.sellerId,
        type: "PROMOTION",
        title: "Your waitlisted banner is now live",
        body: `A ${placementTarget.toLowerCase()} slot opened and your approved waitlisted banner has been activated automatically.`,
        link: `/car/${ad.listingId}`,
      })),
    });
  }
};
