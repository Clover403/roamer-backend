import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  ensurePlatformFeeSettings,
  mapPlatformFeeSettings,
  updatePlatformFeeSettings,
} from "../lib/platform-fees";
import {
  buildDayBuckets,
  buildRangeBuckets,
  getRangeStart,
  makeDayKey,
  parseDashboardRange,
  parseDashboardYear,
} from "./dashboard.utils";

type AuthedRequest = Request & {
  authUser?: {
    id: string;
    role: "USER" | "ADMIN";
  };
};

const toMoney = (value: unknown) => Number((Number(value ?? 0)).toFixed(2));
const parsePageLimit = (query: Request["query"], defaults?: { page?: number; limit?: number; maxLimit?: number }) => {
  const page = Math.max(1, Number(query.page ?? defaults?.page ?? 1) || 1);
  const rawLimit = Math.max(1, Number(query.limit ?? defaults?.limit ?? 10) || 10);
  const maxLimit = Math.max(1, defaults?.maxLimit ?? 50);
  const limit = Math.min(rawLimit, maxLimit);
  return { page, limit, skip: (page - 1) * limit };
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

const buildListingTitle = (listing?: { make?: string | null; model?: string | null; year?: number | null } | null) =>
  [listing?.make, listing?.model, listing?.year ? String(listing.year) : null].filter(Boolean).join(" ") || "Listing";

const getPaidRevenueOccurredAt = (payment: { paidAt?: Date | null; updatedAt: Date; createdAt: Date }) =>
  payment.paidAt ?? payment.updatedAt ?? payment.createdAt;

const monetizedBannerStatuses: Array<"WAITLIST" | "ACTIVE" | "EXPIRED"> = ["WAITLIST", "ACTIVE", "EXPIRED"];

export const getAdminDashboardOverview = async (_req: Request, res: Response) => {
  const [
    users,
    listings,
    pendingVerifications,
    activePromotions,
    activeListings,
    activeSaleListings,
    activeRentListings,
    soldListings,
    draftListings,
    roamerVerifiedListings,
    thirdPartyVerifiedListings,
    pendingVerificationListings,
    salePayments,
    rentalPayments,
    promotionRevenueAgg,
    recentUsers,
    recentPostedListings,
    recentAcceptedOffers,
    recentSuccessfulRentals,
    recentApprovedBannerAds,
    recentActiveBannerAds,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.listing.count(),
    prisma.verificationSubmission.count({ where: { status: "PENDING" } }),
    prisma.bannerAd.count({ where: { status: "ACTIVE" } }),
    prisma.listing.count({ where: { status: "ACTIVE" } }),
    prisma.listing.count({ where: { status: "ACTIVE", listingType: "SELL" } }),
    prisma.listing.count({ where: { status: "ACTIVE", listingType: "RENT" } }),
    prisma.listing.count({ where: { status: "SOLD" } }),
    prisma.listing.count({ where: { status: { in: ["DRAFT", "PAUSED"] } } }),
    prisma.listing.count({ where: { verificationLevel: "ROAMER" } }),
    prisma.listing.count({ where: { verificationLevel: "THIRD_PARTY" } }),
    prisma.listing.count({ where: { verificationType: { in: ["ROAMER", "THIRD_PARTY"] }, verificationLevel: "NONE" } }),
    prisma.payment.aggregate({
      where: { purpose: { in: ["LISTING_FEE", "COMMISSION"] }, status: "PAID" },
      _sum: { amountAed: true },
    }),
    prisma.payment.aggregate({
      where: { purpose: "RENTAL", status: "PAID" },
      _sum: { amountAed: true },
    }),
    prisma.bannerAd.aggregate({
      where: {
        status: { in: monetizedBannerStatuses },
      },
      _sum: { packagePriceAed: true },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, fullName: true, email: true, createdAt: true },
    }),
    prisma.listing.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { seller: { select: { fullName: true, email: true } } },
    }),
    prisma.jointOffer.findMany({
      where: { status: "ACCEPTED" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        listing: { select: { make: true, model: true, year: true } },
        group: { select: { name: true } },
      },
    }),
    prisma.rentalBooking.findMany({
      where: { status: { in: ["APPROVED", "ACTIVE", "COMPLETED"] } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        listing: { select: { make: true, model: true, year: true } },
        renter: { select: { fullName: true, email: true } },
      },
    }),
    prisma.bannerAd.findMany({
      where: {
        status: { in: monetizedBannerStatuses },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        seller: { select: { fullName: true, email: true } },
        listing: { select: { make: true, model: true, year: true } },
      },
    }),
    prisma.bannerAd.findMany({
      where: { status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        seller: { select: { fullName: true, email: true } },
        listing: { select: { make: true, model: true, year: true } },
      },
    }),
  ]);

  const recentActivity = [
    ...recentUsers.map((item: (typeof recentUsers)[number]) => ({
      id: `user-${item.id}`,
      type: "USER_REGISTERED",
      title: `${item.fullName?.trim() || item.email || "New user"} joined`,
      description: item.email || "New account registration",
      createdAt: item.createdAt.toISOString(),
    })),
    ...recentPostedListings.map((item: (typeof recentPostedListings)[number]) => ({
      id: `listing-${item.id}`,
      type: "LISTING_POSTED",
      title: `${item.seller?.fullName?.trim() || item.seller?.email || "Seller"} posted a listing`,
      description: buildListingTitle(item),
      createdAt: item.createdAt.toISOString(),
    })),
    ...recentAcceptedOffers.map((item: (typeof recentAcceptedOffers)[number]) => ({
      id: `offer-${item.id}`,
      type: "BUYING_COMPLETED",
      title: `Offer accepted in ${item.group?.name || "group"}`,
      description: buildListingTitle(item.listing),
      createdAt: item.updatedAt.toISOString(),
    })),
    ...recentSuccessfulRentals.map((item: (typeof recentSuccessfulRentals)[number]) => ({
      id: `rental-${item.id}`,
      type: "RENTAL_COMPLETED",
      title: `${item.renter?.fullName?.trim() || item.renter?.email || "Renter"} rental confirmed`,
      description: buildListingTitle(item.listing),
      createdAt: item.updatedAt.toISOString(),
    })),
    ...recentApprovedBannerAds.map((item: (typeof recentApprovedBannerAds)[number]) => ({
      id: `promo-approved-${item.id}`,
      type: "PROMOTION_PURCHASED",
      title: `${item.seller?.fullName?.trim() || item.seller?.email || "Seller"} promotion approved`,
      description: buildListingTitle(item.listing),
      createdAt: (item.reviewedAt ?? item.createdAt).toISOString(),
    })),
    ...recentActiveBannerAds.map((item: (typeof recentActiveBannerAds)[number]) => ({
      id: `banner-${item.id}`,
      type: "BANNER_ACTIVATED",
      title: `${item.seller?.fullName?.trim() || item.seller?.email || "Seller"} activated banner ad`,
      description: buildListingTitle(item.listing),
      createdAt: item.updatedAt.toISOString(),
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);

  const revenueAed =
    Number(salePayments._sum.amountAed ?? 0) +
    Number(rentalPayments._sum.amountAed ?? 0) +
    Number(promotionRevenueAgg._sum.packagePriceAed ?? 0);

  res.status(200).json({
    users,
    listings,
    pendingVerifications,
    pendingBadgeQueue: pendingVerifications,
    activePromotions,
    revenueAed: toMoney(revenueAed),
    listingBreakdown: {
      active: activeListings,
      activeSale: activeSaleListings,
      activeRent: activeRentListings,
      sold: soldListings,
      draft: draftListings,
    },
    verificationBreakdown: {
      roamer: roamerVerifiedListings,
      thirdParty: thirdPartyVerifiedListings,
      pending: pendingVerificationListings,
    },
    recentActivity,
  });
};

export const getAdminDashboardCharts = async (req: Request, res: Response) => {
  const range = parseDashboardRange(req.query.range);
  const selectedYear = parseDashboardYear(req.query.year, new Date().getFullYear());
  const buckets = buildRangeBuckets(range, selectedYear);

  const [users, activeListings, activeRentalListings, activeRentals, inquiries, payments, bannerAds] = await Promise.all([
    prisma.user.findMany({ where: { createdAt: { gte: buckets.start, lt: buckets.end } }, select: { createdAt: true } }),
    prisma.listing.findMany({
      where: {
        status: "ACTIVE",
        listingType: "SELL",
        OR: [{ createdAt: { gte: buckets.start, lt: buckets.end } }, { publishedAt: { gte: buckets.start, lt: buckets.end } }],
      },
      select: { createdAt: true, publishedAt: true },
    }),
    prisma.listing.findMany({
      where: {
        status: "ACTIVE",
        listingType: "RENT",
        OR: [{ createdAt: { gte: buckets.start, lt: buckets.end } }, { publishedAt: { gte: buckets.start, lt: buckets.end } }],
      },
      select: { createdAt: true, publishedAt: true },
    }),
    prisma.rentalBooking.findMany({
      where: { status: "ACTIVE", updatedAt: { gte: buckets.start, lt: buckets.end } },
      select: { updatedAt: true },
    }),
    prisma.analyticsEvent.findMany({ where: { eventType: "LISTING_INQUIRY", createdAt: { gte: buckets.start, lt: buckets.end } }, select: { createdAt: true } }),
    prisma.payment.findMany({
      where: {
        status: "PAID",
        OR: [
          { paidAt: { gte: buckets.start, lt: buckets.end } },
          { AND: [{ paidAt: null }, { updatedAt: { gte: buckets.start, lt: buckets.end } }] },
          { AND: [{ paidAt: null }, { updatedAt: null }, { createdAt: { gte: buckets.start, lt: buckets.end } }] },
        ],
        purpose: { in: ["LISTING_FEE", "COMMISSION", "RENTAL"] },
      },
      select: { createdAt: true, updatedAt: true, paidAt: true, amountAed: true, purpose: true },
    }),
    prisma.bannerAd.findMany({
      where: {
        status: { in: monetizedBannerStatuses },
        OR: [
          { reviewedAt: { gte: buckets.start, lt: buckets.end } },
          { updatedAt: { gte: buckets.start, lt: buckets.end } },
          { createdAt: { gte: buckets.start, lt: buckets.end } },
        ],
      },
      select: { reviewedAt: true, updatedAt: true, createdAt: true, packagePriceAed: true },
    }),
  ]);

  const activeListingsSeries = new Map(buckets.map);
  const usersSeries = new Map(buckets.map);
  const activeRentalsSeries = new Map(buckets.map);
  const inquiriesSeries = new Map(buckets.map);
  const revenueSeries = new Map(buckets.map);

  for (const item of activeListings) {
    const key = buckets.keyFn(item.publishedAt ?? item.createdAt);
    if (activeListingsSeries.has(key)) activeListingsSeries.set(key, (activeListingsSeries.get(key) ?? 0) + 1);
  }
  for (const item of users) {
    const key = buckets.keyFn(item.createdAt);
    if (usersSeries.has(key)) usersSeries.set(key, (usersSeries.get(key) ?? 0) + 1);
  }
  for (const item of activeRentalListings) {
    const key = buckets.keyFn(item.publishedAt ?? item.createdAt);
    if (activeRentalsSeries.has(key)) activeRentalsSeries.set(key, (activeRentalsSeries.get(key) ?? 0) + 1);
  }
  for (const item of activeRentals) {
    const key = buckets.keyFn(item.updatedAt);
    if (activeRentalsSeries.has(key)) activeRentalsSeries.set(key, (activeRentalsSeries.get(key) ?? 0) + 1);
  }
  for (const item of inquiries) {
    const key = buckets.keyFn(item.createdAt);
    if (inquiriesSeries.has(key)) inquiriesSeries.set(key, (inquiriesSeries.get(key) ?? 0) + 1);
  }
  for (const item of payments) {
    const key = buckets.keyFn(getPaidRevenueOccurredAt(item));
    if (revenueSeries.has(key)) {
      revenueSeries.set(key, toMoney((revenueSeries.get(key) ?? 0) + Number(item.amountAed ?? 0)));
    }
  }

  for (const item of bannerAds) {
    const occurredAt = item.reviewedAt ?? item.updatedAt ?? item.createdAt;
    const key = buckets.keyFn(occurredAt);
    if (revenueSeries.has(key)) {
      revenueSeries.set(key, toMoney((revenueSeries.get(key) ?? 0) + Number(item.packagePriceAed ?? 0)));
    }
  }

  const bucketKeys = Array.from(buckets.map.keys());
  const labels =
    buckets.granularity === "month"
      ? buckets.labels.map((key) => {
          const [year, month] = key.split("-").map(Number);
          return new Date(year, (month ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short" });
        })
      : buckets.labels;

  res.status(200).json({
    range,
    year: selectedYear,
    labels,
    series: {
      activeListings: bucketKeys.map((key) => activeListingsSeries.get(key) ?? 0),
      users: bucketKeys.map((key) => usersSeries.get(key) ?? 0),
      activeRentals: bucketKeys.map((key) => activeRentalsSeries.get(key) ?? 0),
      listingInquiries: bucketKeys.map((key) => inquiriesSeries.get(key) ?? 0),
      revenueAed: bucketKeys.map((key) => toMoney(revenueSeries.get(key) ?? 0)),
    },
  });
};

export const getAdminModerationQueue = async (_req: Request, res: Response) => {
  const [verificationQueue, promotionQueue, flaggedListings] = await Promise.all([
    prisma.verificationSubmission.findMany({ where: { status: "PENDING" }, include: { user: true, documents: true }, take: 20, orderBy: { submittedAt: "desc" } }),
    prisma.promotionCampaign.findMany({ where: { status: { in: ["DRAFT", "PENDING_PAYMENT"] } }, include: { creator: true, listing: true }, take: 20, orderBy: { createdAt: "desc" } }),
    prisma.analyticsEvent.findMany({ where: { eventType: "LISTING_INQUIRY" }, include: { listing: true }, take: 20, orderBy: { createdAt: "desc" } }),
  ]);

  res.status(200).json({ verificationQueue, promotionQueue, flaggedListings });
};

export const getAdminFeeSettings = async (_req: Request, res: Response) => {
  const row = await ensurePlatformFeeSettings();
  res.status(200).json(mapPlatformFeeSettings(row));
};

export const updateAdminFeeSettings = async (req: AuthedRequest, res: Response) => {
  const payload = z
    .object({
      saleCommissionPct: z.number().min(0).max(100).optional(),
      rentalFeePct: z.number().min(0).max(100).optional(),
      listingFeePct: z.number().min(0).max(100).optional(),
      hybridCommissionPct: z.number().min(0).max(100).optional(),
      hybridListingFeeAed: z.number().min(0).max(100).optional(),
    })
    .refine((value) => Object.values(value).some((item) => item !== undefined), { message: "At least one fee field must be provided" })
    .parse(req.body);

  const current = mapPlatformFeeSettings(await ensurePlatformFeeSettings());
  const nextSaleCommission = payload.saleCommissionPct ?? current.saleCommissionPct;
  const nextListingFeePct = payload.listingFeePct ?? current.listingFeePct;

  if (nextListingFeePct >= nextSaleCommission) {
    res.status(400).json({ message: "Listing fee percentage must be cheaper than sale commission percentage" });
    return;
  }

  const updated = await updatePlatformFeeSettings(payload, req.authUser?.id);
  res.status(200).json(mapPlatformFeeSettings(updated));
};

export const getAdminRevenueOverview = async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePageLimit(req.query, { page: 1, limit: 5, maxLimit: 50 });
  const range = parseDashboardRange(req.query.range);
  const selectedYear = parseDashboardYear(req.query.year, new Date().getFullYear());

  let bucketMap = new Map<string, number>();
  let bucketKeys: string[] = [];
  let startDate = getRangeStart(range);
  let endDate = new Date();
  let toBucketKey = (date: Date) => makeDayKey(date);

  if (range === "1Y") {
    const yearlyBuckets = buildRangeBuckets("1Y", selectedYear);
    bucketMap = yearlyBuckets.map;
    bucketKeys = Array.from(yearlyBuckets.map.keys());
    startDate = yearlyBuckets.start;
    endDate = yearlyBuckets.end;
    toBucketKey = yearlyBuckets.keyFn;
  } else {
    const dayBuckets = buildDayBuckets(range);
    bucketMap = dayBuckets.map;
    bucketKeys = dayBuckets.labels;
  }

  const toLabel = (key: string) => {
    if (range === "1Y") {
      const [year, month] = key.split("-").map(Number);
      return new Date(year, (month ?? 1) - 1, 1).toLocaleDateString("en-US", { month: "short" });
    }

    const d = new Date(key);
    if (Number.isNaN(d.getTime())) return key;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const [payments, bannerAds] = await Promise.all([
    prisma.payment.findMany({
      where: {
        status: { in: ["PAID", "PENDING"] },
        createdAt: { gte: startDate, lt: endDate },
        purpose: { in: ["RENTAL", "LISTING_FEE", "COMMISSION"] },
      },
      include: {
        rental: {
          include: {
            listing: {
              include: {
                seller: {
                  select: {
                    fullName: true,
                  },
                },
              },
            },
          },
        },
        offer: {
          include: {
            listing: {
              include: {
                seller: {
                  select: {
                    fullName: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.bannerAd.findMany({
      where: {
        status: { in: monetizedBannerStatuses },
        OR: [
          { reviewedAt: { gte: startDate, lt: endDate } },
          { updatedAt: { gte: startDate, lt: endDate } },
          { startsAt: { gte: startDate, lt: endDate } },
          { createdAt: { gte: startDate, lt: endDate } },
        ],
      },
      include: {
        listing: {
          include: {
            seller: {
              select: {
                fullName: true,
              },
            },
          },
        },
        seller: {
          select: {
            fullName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const saleSeries = new Map(bucketMap);
  const rentalSeries = new Map(bucketMap);
  const adsSeries = new Map(bucketMap);

  const transactions: Array<{
    id: string;
    source: "PAYMENT" | "BANNER_AD";
    type: "sale" | "rental" | "ads";
    amountAed: number;
    feeAed: number;
    seller: string;
    vehicle: string;
    createdAt: string;
  }> = [];

  for (const payment of payments) {
    const occurredAt = getPaidRevenueOccurredAt(payment);
    const key = toBucketKey(occurredAt);
    const fee = toMoney(payment.amountAed);
    const listing = payment.rental?.listing ?? payment.offer?.listing ?? null;
    const sellerName =
      listing?.seller?.fullName?.trim() ||
      "Unknown Seller";
    const vehicleName = [listing?.make, listing?.model, listing?.year ? String(listing.year) : null]
      .filter(Boolean)
      .join(" ") || "-";

    if (payment.purpose === "RENTAL") {
      if (rentalSeries.has(key)) rentalSeries.set(key, (rentalSeries.get(key) ?? 0) + fee);
      transactions.push({
        id: payment.id,
        source: "PAYMENT",
        type: "rental",
        amountAed: fee,
        feeAed: fee,
        seller: sellerName,
        vehicle: vehicleName,
        createdAt: occurredAt.toISOString(),
      });
      continue;
    }

    if (payment.purpose === "LISTING_FEE" || payment.purpose === "COMMISSION") {
      if (saleSeries.has(key)) saleSeries.set(key, (saleSeries.get(key) ?? 0) + fee);
      transactions.push({
        id: payment.id,
        source: "PAYMENT",
        type: "sale",
        amountAed: fee,
        feeAed: fee,
        seller: sellerName,
        vehicle: vehicleName,
        createdAt: occurredAt.toISOString(),
      });
    }
  }

  for (const ad of bannerAds) {
    const occurredAt = ad.reviewedAt ?? ad.startsAt ?? ad.updatedAt ?? ad.createdAt;
    const key = toBucketKey(occurredAt);
    const fee = toMoney(ad.packagePriceAed);

    if (adsSeries.has(key)) adsSeries.set(key, (adsSeries.get(key) ?? 0) + fee);

    const vehicleName = [ad.listing.make, ad.listing.model, ad.listing.year ? String(ad.listing.year) : null]
      .filter(Boolean)
      .join(" ") || "-";

    transactions.push({
      id: ad.id,
      source: "BANNER_AD",
      type: "ads",
      amountAed: fee,
      feeAed: fee,
      seller: ad.seller.fullName?.trim() || ad.listing.seller.fullName?.trim() || "Unknown Seller",
      vehicle: vehicleName,
      createdAt: occurredAt.toISOString(),
    });
  }

  const saleAed = bucketKeys.map((key) => toMoney(saleSeries.get(key) ?? 0));
  const rentalAed = bucketKeys.map((key) => toMoney(rentalSeries.get(key) ?? 0));
  const adsAed = bucketKeys.map((key) => toMoney(adsSeries.get(key) ?? 0));
  const totalAed = bucketKeys.map((_, idx) => toMoney(saleAed[idx] + rentalAed[idx] + adsAed[idx]));

  const revenueTransactions = transactions
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pagedTransactions = revenueTransactions.slice(skip, skip + limit);

  const sum = (values: number[]) => values.reduce((acc, current) => acc + current, 0);

  res.status(200).json({
    range,
    year: selectedYear,
    labels: bucketKeys.map(toLabel),
    series: {
      saleAed,
      rentalAed,
      adsAed,
      totalAed,
    },
    kpis: {
      totalRevenueAed: toMoney(sum(totalAed)),
      saleRevenueAed: toMoney(sum(saleAed)),
      rentalRevenueAed: toMoney(sum(rentalAed)),
      adsRevenueAed: toMoney(sum(adsAed)),
      totalTransactions: revenueTransactions.length,
    },
    transactions: pagedTransactions,
    transactionsPagination: {
      page,
      limit,
      total: revenueTransactions.length,
      hasMore: skip + pagedTransactions.length < revenueTransactions.length,
    },
  });
};

export const getAdminCommissionTracking = async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePageLimit(req.query, { page: 1, limit: 5, maxLimit: 50 });

  const feeSettings = mapPlatformFeeSettings(await ensurePlatformFeeSettings());
  const rentalFeePct = Number(feeSettings.rentalFeePct ?? 0);

  const rentalBookings = await prisma.rentalBooking.findMany({
    where: {
      status: { in: ["APPROVED", "ACTIVE", "COMPLETED"] },
    },
    select: {
      id: true,
      subtotalAed: true,
      listing: {
        select: {
          sellerId: true,
        },
      },
    },
  });

  const rentalIds = rentalBookings.map((booking: (typeof rentalBookings)[number]) => booking.id);
  const existingRentalPayments = rentalIds.length
    ? await prisma.payment.findMany({
        where: {
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

  const missingRentalRows = rentalBookings
    .filter((booking: (typeof rentalBookings)[number]) => !existingRentalPaymentIds.has(booking.id))
    .map((booking: (typeof rentalBookings)[number]) => {
      const baseAmountAed = Number(booking.subtotalAed ?? 0);
      const expectedRentalFeeAed = Number(((baseAmountAed * rentalFeePct) / 100).toFixed(2));
      if (expectedRentalFeeAed <= 0) return null;

      return {
        payerId: booking.listing.sellerId,
        purpose: "RENTAL" as const,
        status: "PENDING" as const,
        amountAed: expectedRentalFeeAed,
        currency: "AED",
        provider: "MANUAL_ADMIN_REVIEW",
        providerPaymentRef: `RENTAL:${booking.id}:FEE`,
        rentalId: booking.id,
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

  const [payments, totalInvoices, paidInvoicesAgg, unpaidInvoicesAgg] = await Promise.all([
    prisma.payment.findMany({
      where: {
        purpose: {
          in: ["LISTING_FEE", "COMMISSION", "RENTAL"],
        },
      },
      include: {
        payer: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
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
                priceSellAed: true,
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
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: limit,
    }),
    prisma.payment.count({
      where: {
        purpose: {
          in: ["LISTING_FEE", "COMMISSION", "RENTAL"],
        },
      },
    }),
    prisma.payment.aggregate({
      where: {
        purpose: {
          in: ["LISTING_FEE", "COMMISSION", "RENTAL"],
        },
        status: "PAID",
      },
      _count: { _all: true },
      _sum: { amountAed: true },
    }),
    prisma.payment.aggregate({
      where: {
        purpose: {
          in: ["LISTING_FEE", "COMMISSION", "RENTAL"],
        },
        status: { not: "PAID" },
      },
      _count: { _all: true },
      _sum: { amountAed: true },
    }),
  ]);

  const totalExpectedOnPage = payments.reduce((acc: number, payment: (typeof payments)[number]) => acc + Number(payment.amountAed ?? 0), 0);

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

  const listingRefs = listingIdsFromPaymentRef.length
    ? await prisma.listing.findMany({
        where: {
          id: {
            in: listingIdsFromPaymentRef,
          },
        },
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

  const listingRefMap = new Map(listingRefs.map((listing: (typeof listingRefs)[number]) => [listing.id, listing]));

  const items = payments.map((payment: (typeof payments)[number]) => {
    const listingFromOffer = payment.offer?.listing;
    const listingFromRefId = (() => {
      const ref = parsePaymentRefBase(payment.providerPaymentRef);
      const match = /^LISTING:([^:|]+):FEE$/i.exec(ref);
      return match?.[1] ?? null;
    })();
    const listingFromRef = listingFromRefId ? listingRefMap.get(listingFromRefId) : null;
    const listingFromRental = payment.rental?.listing;
    const listing = listingFromOffer ?? listingFromRef ?? listingFromRental;
    const saleAmountAed =
      payment.purpose === "RENTAL"
        ? toMoney(payment.rental?.subtotalAed ?? payment.rental?.totalAed ?? 0)
        : toMoney(payment.offer?.offerPriceAed ?? Number((listingFromRef as { priceSellAed?: unknown } | null)?.priceSellAed ?? 0));
    const commissionRatePct =
      payment.purpose === "COMMISSION"
        ? toMoney(listingFromOffer?.commissionRatePct ?? 0)
        : payment.purpose === "RENTAL"
          ? toMoney(rentalFeePct)
          : 0;
    const transferMeta = parseTransferMetaFromPaymentRef(payment.providerPaymentRef);
    const transferStatus =
      payment.status === "PAID"
        ? "PAID"
        : payment.provider === "MANUAL_TRANSFER_SUBMITTED"
          ? "WAITING_ADMIN"
          : "NOT_SUBMITTED";

    return {
      invoiceId: payment.id,
      paymentId: payment.id,
      offerId: payment.offerId,
      listingId: listing?.id ?? null,
      listingTitle: [listing?.make, listing?.model, listing?.year ? String(listing.year) : null]
        .filter(Boolean)
        .join(" ") || "Listing",
      seller: {
        id: payment.payer.id,
        name: payment.payer.fullName?.trim() || "Unknown Seller",
        email: payment.payer.email,
      },
      paymentModel: listing?.paymentModel,
      invoiceType: payment.purpose,
      transferStatus,
      transferReference: transferMeta.transferReference,
      transferredAt: transferMeta.transferredAt,
      transferNote: transferMeta.note,
      saleAmountAed,
      commissionRatePct,
      expectedCommissionAed: toMoney(payment.amountAed),
      status: payment.status === "PAID" ? "PAID" : "UNPAID",
      paidAmountAed: payment.status === "PAID" ? toMoney(payment.amountAed) : 0,
      paidAt: payment.paidAt?.toISOString() ?? null,
      paymentReference: payment.providerPaymentRef ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.paidAt?.toISOString() ?? payment.createdAt.toISOString(),
      chatLink: `/my-groups?tab=personals&targetUserId=${payment.payer.id}`,
    };
  });

  const summary = {
    totalInvoices,
    paidInvoices: Number(paidInvoicesAgg._count._all ?? 0),
    unpaidInvoices: Number(unpaidInvoicesAgg._count._all ?? 0),
    totalExpectedCommissionAed: toMoney(Number(paidInvoicesAgg._sum.amountAed ?? 0) + Number(unpaidInvoicesAgg._sum.amountAed ?? 0)),
    totalPaidCommissionAed: toMoney(paidInvoicesAgg._sum.amountAed),
    pageExpectedCommissionAed: toMoney(totalExpectedOnPage),
  };

  res.status(200).json({
    items,
    summary,
    pagination: {
      page,
      limit,
      total: totalInvoices,
      hasMore: skip + items.length < totalInvoices,
    },
  });
};

export const confirmAdminFeeInvoice = async (req: AuthedRequest, res: Response) => {
  const reviewerId = req.authUser?.id;
  if (!reviewerId || req.authUser?.role !== "ADMIN") {
    res.status(403).json({ message: "Admin access required" });
    return;
  }

  const paymentId = String(req.params.id);

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      payer: {
        select: {
          id: true,
        },
      },
    },
  });

  if (!payment) {
    res.status(404).json({ message: "Fee invoice not found" });
    return;
  }

  if (payment.purpose !== "LISTING_FEE" && payment.purpose !== "COMMISSION" && payment.purpose !== "RENTAL") {
    res.status(400).json({ message: "Only LISTING_FEE, COMMISSION, or RENTAL invoices can be confirmed here" });
    return;
  }

  if (payment.status === "PAID") {
    res.status(200).json(payment);
    return;
  }

  if (payment.provider !== "MANUAL_TRANSFER_SUBMITTED") {
    res.status(400).json({ message: "Seller has not submitted transfer confirmation yet" });
    return;
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      provider: "MANUAL_ADMIN_APPROVED",
    },
  });

  await prisma.notification.create({
    data: {
      userId: payment.payer.id,
      type: "SYSTEM",
      priority: "NORMAL",
      title: "Fee payment confirmed",
      body: `Your ${payment.purpose === "LISTING_FEE" ? "listing fee" : payment.purpose === "RENTAL" ? "rental fee" : "commission"} invoice has been confirmed by admin.`,
      link: "/seller-activity",
    },
  });

  res.status(200).json(updated);
};
