import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  ensurePlatformFeeSettings,
  mapPlatformFeeSettings,
  updatePlatformFeeSettings,
} from "../lib/platform-fees";
import { buildDayBuckets, getRangeStart, makeDayKey, parseDashboardRange } from "./dashboard.utils";

type AuthedRequest = Request & {
  authUser?: {
    id: string;
    role: "USER" | "ADMIN";
  };
};

const makeMonthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const buildMonthBuckets = (months = 12) => {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const keys: string[] = [];
  const labels: string[] = [];
  const map = new Map<string, number>();

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - i, 1);
    const key = makeMonthKey(d);
    keys.push(key);
    labels.push(d.toLocaleDateString("en-US", { month: "short" }));
    map.set(key, 0);
  }

  const startDate = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() - (months - 1), 1);
  return { keys, labels, map, startDate };
};

const toMoney = (value: unknown) => Number((Number(value ?? 0)).toFixed(2));
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

export const getAdminDashboardOverview = async (_req: Request, res: Response) => {
  const [
    users,
    listings,
    pendingVerifications,
    activePromotions,
    pendingBadgeQueue,
    roamerVerifiedListings,
    thirdPartyVerifiedListings,
    pendingVerificationListings,
    salePayments,
    rentalPayments,
    promotionPayments,
    acceptedOffersWithoutCommissionInvoice,
    recentUsers,
    recentLogoutEvents,
    recentPostedListings,
    recentAcceptedOffers,
    recentSuccessfulRentals,
    recentPromotionPayments,
    recentActiveBannerAds,
    soldListingsWithoutAcceptedOffer,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.listing.count(),
    prisma.verificationSubmission.count({ where: { status: "PENDING" } }),
    prisma.promotionCampaign.count({ where: { status: "ACTIVE" } }),
    prisma.verificationSubmission.count({ where: { status: "PENDING" } }),
    prisma.listing.count({ where: { verificationLevel: "ROAMER" } }),
    prisma.listing.count({ where: { verificationLevel: "THIRD_PARTY" } }),
    prisma.listing.count({ where: { verificationType: { in: ["ROAMER", "THIRD_PARTY"] }, verificationLevel: "NONE" } }),
    prisma.payment.aggregate({
      where: {
        purpose: { in: ["LISTING_FEE", "COMMISSION"] },
        status: { in: ["PAID", "PENDING"] },
      },
      _sum: { amountAed: true },
    }),
    prisma.payment.aggregate({
      where: {
        purpose: "RENTAL",
        status: { in: ["PAID", "PENDING"] },
      },
      _sum: { amountAed: true },
    }),
    prisma.payment.aggregate({
      where: {
        purpose: "PROMOTION",
        status: { in: ["PAID", "PENDING"] },
      },
      _sum: { amountAed: true },
    }),
    prisma.jointOffer.findMany({
      where: {
        status: "ACCEPTED",
        listing: {
          paymentModel: { in: ["commission", "hybrid"] },
        },
        payments: {
          none: {
            purpose: "COMMISSION",
          },
        },
      },
      select: {
        offerPriceAed: true,
        listing: {
          select: {
            commissionRatePct: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, fullName: true, email: true, createdAt: true },
    }),
    prisma.analyticsEvent.findMany({
      where: { eventType: "CHAT_MESSAGE" },
      include: {
        actor: {
          select: { fullName: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.listing.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        seller: {
          select: { fullName: true, email: true },
        },
      },
    }),
    prisma.jointOffer.findMany({
      where: { status: "ACCEPTED" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        listing: {
          select: { make: true, model: true, year: true },
        },
        group: {
          select: { name: true },
        },
      },
    }),
    prisma.rentalBooking.findMany({
      where: {
        status: { in: ["APPROVED", "ACTIVE", "COMPLETED"] },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        listing: {
          select: { make: true, model: true, year: true },
        },
        renter: {
          select: { fullName: true, email: true },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        purpose: "PROMOTION",
        status: { in: ["PAID", "PENDING"] },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        payer: {
          select: { fullName: true, email: true },
        },
        promotion: {
          include: {
            listing: {
              select: { make: true, model: true, year: true },
            },
          },
        },
      },
    }),
    prisma.bannerAd.findMany({
      where: {
        status: "ACTIVE",
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        seller: {
          select: { fullName: true, email: true },
        },
        listing: {
          select: { make: true, model: true, year: true },
        },
      },
    }),
    prisma.listing.findMany({
      where: {
        status: "SOLD",
        paymentModel: { in: ["commission", "hybrid"] },
        offers: {
          none: {
            status: "ACCEPTED",
          },
        },
      },
      select: {
        priceSellAed: true,
        commissionRatePct: true,
      },
    }),
  ]);

  const [activeListings, soldListings, draftListings] = await Promise.all([
    prisma.listing.count({ where: { status: "ACTIVE" } }),
    prisma.listing.count({ where: { status: "SOLD" } }),
    prisma.listing.count({ where: { status: "DRAFT" } }),
  ]);

  const missingCommissionRevenue = acceptedOffersWithoutCommissionInvoice.reduce((acc: number, item: any) => {
    const saleAmountAed = Number(item.offerPriceAed ?? 0);
    const commissionRatePct = Number(item.listing.commissionRatePct ?? 0);
    const expected = Number(((saleAmountAed * commissionRatePct) / 100).toFixed(2));
    return acc + expected;
  }, 0);

  const soldListingFallbackRevenue = soldListingsWithoutAcceptedOffer.reduce((acc: number, listing: any) => {
    const saleAmountAed = Number(listing.priceSellAed ?? 0);
    const commissionRatePct = Number(listing.commissionRatePct ?? 0);
    const expected = Number(((saleAmountAed * commissionRatePct) / 100).toFixed(2));
    return acc + expected;
  }, 0);

  const totalRevenueAed = Number(
    (
      Number(salePayments._sum.amountAed ?? 0) +
      Number(rentalPayments._sum.amountAed ?? 0) +
      Number(promotionPayments._sum.amountAed ?? 0) +
      missingCommissionRevenue +
      soldListingFallbackRevenue
    ).toFixed(2)
  );

  const activityRows = [
    ...recentUsers.map((user: any) => ({
      id: `register-${user.id}-${user.createdAt.toISOString()}`,
      type: "USER_REGISTERED",
      title: "User registered",
      description: `${user.fullName?.trim() || user.email || "User"} created a new account`,
      createdAt: user.createdAt.toISOString(),
    })),
    ...recentLogoutEvents
      .filter((event: any) => {
        const metadata = (event.metadata ?? {}) as Record<string, unknown>;
        return String(metadata.activityType ?? "") === "USER_LOGOUT";
      })
      .map((event: any) => ({
        id: `logout-${event.id}`,
        type: "USER_LOGOUT",
        title: "User logged out",
        description: `${event.actor?.fullName?.trim() || event.actor?.email || "User"} logged out`,
        createdAt: event.createdAt.toISOString(),
      })),
    ...recentPostedListings.map((listing: any) => ({
      id: `listing-${listing.id}-${listing.createdAt.toISOString()}`,
      type: "LISTING_POSTED",
      title: "Listing posted",
      description: `${listing.seller?.fullName?.trim() || listing.seller?.email || "Seller"} posted ${buildListingTitle(listing)}`,
      createdAt: listing.createdAt.toISOString(),
    })),
    ...recentAcceptedOffers.map((offer: any) => ({
      id: `sale-${offer.id}-${offer.updatedAt.toISOString()}`,
      type: "BUYING_COMPLETED",
      title: "Buying completed",
      description: `${offer.group?.name || "A buyer group"} completed purchase for ${buildListingTitle(offer.listing)}`,
      createdAt: offer.updatedAt.toISOString(),
    })),
    ...recentSuccessfulRentals.map((rental: any) => ({
      id: `rental-${rental.id}-${rental.updatedAt.toISOString()}`,
      type: "RENTAL_COMPLETED",
      title: "Rental confirmed",
      description: `${rental.renter?.fullName?.trim() || rental.renter?.email || "Renter"} confirmed rental for ${buildListingTitle(rental.listing)}`,
      createdAt: rental.updatedAt.toISOString(),
    })),
    ...recentPromotionPayments.map((payment: any) => ({
      id: `promo-${payment.id}-${payment.createdAt.toISOString()}`,
      type: "PROMOTION_PURCHASED",
      title: "Promotion purchased",
      description: `${payment.payer.fullName?.trim() || payment.payer.email || "Seller"} purchased promotion for ${buildListingTitle(payment.promotion?.listing)}`,
      createdAt: payment.createdAt.toISOString(),
    })),
    ...recentActiveBannerAds.map((ad: any) => {
      const occurredAt = ad.reviewedAt ?? ad.startsAt ?? ad.updatedAt ?? ad.createdAt;
      return {
        id: `banner-active-${ad.id}-${occurredAt.toISOString()}`,
        type: "BANNER_ACTIVATED",
        title: "Banner activated",
        description: `${ad.seller?.fullName?.trim() || ad.seller?.email || "Seller"} activated banner for ${buildListingTitle(ad.listing)}`,
        createdAt: occurredAt.toISOString(),
      };
    }),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);

  res.status(200).json({
    users,
    listings,
    pendingVerifications,
    pendingBadgeQueue,
    activePromotions,
    revenueAed: totalRevenueAed,
    listingBreakdown: {
      active: activeListings,
      sold: soldListings,
      draft: draftListings,
    },
    verificationBreakdown: {
      roamer: roamerVerifiedListings,
      thirdParty: thirdPartyVerifiedListings,
      pending: pendingVerificationListings,
    },
    recentActivity: activityRows,
  });
};

export const getAdminDashboardCharts = async (req: Request, res: Response) => {
  const range = parseDashboardRange(req.query.range);
  const startDate = getRangeStart(range);

  const [listingsCreated, usersCreated, verificationSubmitted, payments, events] = await Promise.all([
    prisma.listing.findMany({ where: { createdAt: { gte: startDate } }, select: { createdAt: true } }),
    prisma.user.findMany({ where: { createdAt: { gte: startDate } }, select: { createdAt: true } }),
    prisma.verificationSubmission.findMany({ where: { submittedAt: { gte: startDate } }, select: { submittedAt: true } }),
    prisma.payment.findMany({ where: { createdAt: { gte: startDate }, status: "PAID" }, select: { createdAt: true, amountAed: true } }),
    prisma.analyticsEvent.findMany({ where: { createdAt: { gte: startDate } }, select: { createdAt: true, eventType: true } }),
  ]);

  const buckets = {
    listings: buildDayBuckets(range),
    users: buildDayBuckets(range),
    verifications: buildDayBuckets(range),
    revenue: buildDayBuckets(range),
    inquiries: buildDayBuckets(range),
  };

  for (const row of listingsCreated) {
    const key = makeDayKey(row.createdAt);
    if (buckets.listings.map.has(key)) buckets.listings.map.set(key, (buckets.listings.map.get(key) ?? 0) + 1);
  }

  for (const row of usersCreated) {
    const key = makeDayKey(row.createdAt);
    if (buckets.users.map.has(key)) buckets.users.map.set(key, (buckets.users.map.get(key) ?? 0) + 1);
  }

  for (const row of verificationSubmitted) {
    const key = makeDayKey(row.submittedAt);
    if (buckets.verifications.map.has(key)) buckets.verifications.map.set(key, (buckets.verifications.map.get(key) ?? 0) + 1);
  }

  for (const row of payments) {
    const key = makeDayKey(row.createdAt);
    if (buckets.revenue.map.has(key)) {
      const current = buckets.revenue.map.get(key) ?? 0;
      buckets.revenue.map.set(key, current + Number(row.amountAed));
    }
  }

  for (const row of events) {
    if (row.eventType !== "LISTING_INQUIRY") continue;
    const key = makeDayKey(row.createdAt);
    if (buckets.inquiries.map.has(key)) buckets.inquiries.map.set(key, (buckets.inquiries.map.get(key) ?? 0) + 1);
  }

  res.status(200).json({
    range,
    labels: buckets.listings.labels,
    series: {
      listings: buckets.listings.labels.map((k) => buckets.listings.map.get(k) ?? 0),
      users: buckets.users.labels.map((k) => buckets.users.map.get(k) ?? 0),
      verifications: buckets.verifications.labels.map((k) => buckets.verifications.map.get(k) ?? 0),
      listingInquiries: buckets.inquiries.labels.map((k) => buckets.inquiries.map.get(k) ?? 0),
      revenueAed: buckets.revenue.labels.map((k) => Number((buckets.revenue.map.get(k) ?? 0).toFixed(2))),
    },
  });
};

export const getAdminModerationQueue = async (_req: Request, res: Response) => {
  const [verificationQueue, promotionQueue, flaggedListings] = await Promise.all([
    prisma.verificationSubmission.findMany({
      where: { status: "PENDING" },
      include: { user: true, documents: true },
      take: 20,
      orderBy: { submittedAt: "desc" },
    }),
    prisma.promotionCampaign.findMany({
      where: { status: { in: ["DRAFT", "PENDING_PAYMENT"] } },
      include: { creator: true, listing: true },
      take: 20,
      orderBy: { createdAt: "desc" },
    }),
    prisma.analyticsEvent.findMany({
      where: { eventType: "LISTING_INQUIRY" },
      include: { listing: true },
      take: 20,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  res.status(200).json({
    verificationQueue,
    promotionQueue,
    flaggedListings,
  });
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
    .refine((value) => Object.values(value).some((item) => item !== undefined), {
      message: "At least one fee field must be provided",
    })
    .parse(req.body);

  const current = mapPlatformFeeSettings(await ensurePlatformFeeSettings());

  const nextSaleCommission = payload.saleCommissionPct ?? current.saleCommissionPct;
  const nextListingFeePct = payload.listingFeePct ?? current.listingFeePct;

  if (nextListingFeePct >= nextSaleCommission) {
    res.status(400).json({
      message: "Listing fee percentage must be cheaper than sale commission percentage",
    });
    return;
  }

  const updated = await updatePlatformFeeSettings(payload, req.authUser?.id);

  res.status(200).json(mapPlatformFeeSettings(updated));
};

export const getAdminRevenueOverview = async (_req: Request, res: Response) => {
  const buckets = buildMonthBuckets(12);

  const [payments, bannerAds, acceptedOffersWithoutCommissionInvoice, soldListingsWithoutAcceptedOffer] = await Promise.all([
    prisma.payment.findMany({
      where: {
        status: { in: ["PAID", "PENDING"] },
        createdAt: { gte: buckets.startDate },
        purpose: { in: ["RENTAL", "LISTING_FEE", "COMMISSION", "PROMOTION"] },
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
        promotion: {
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
        status: { in: ["ACTIVE", "EXPIRED"] },
        OR: [
          { reviewedAt: { gte: buckets.startDate } },
          { startsAt: { gte: buckets.startDate } },
          { createdAt: { gte: buckets.startDate } },
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
    prisma.jointOffer.findMany({
      where: {
        status: "ACCEPTED",
        updatedAt: { gte: buckets.startDate },
        listing: {
          paymentModel: { in: ["commission", "hybrid"] },
        },
        payments: {
          none: {
            purpose: "COMMISSION",
          },
        },
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
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.listing.findMany({
      where: {
        status: "SOLD",
        updatedAt: { gte: buckets.startDate },
        paymentModel: { in: ["commission", "hybrid"] },
        offers: {
          none: {
            status: "ACCEPTED",
          },
        },
      },
      include: {
        seller: {
          select: {
            fullName: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const saleSeries = new Map(buckets.map);
  const rentalSeries = new Map(buckets.map);
  const adsSeries = new Map(buckets.map);

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
    const key = makeMonthKey(payment.createdAt);
    const fee = toMoney(payment.amountAed);
    const listing = payment.rental?.listing ?? payment.offer?.listing ?? payment.promotion?.listing ?? null;
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
        createdAt: payment.createdAt.toISOString(),
      });
      continue;
    }

    if (payment.purpose === "PROMOTION") {
      if (adsSeries.has(key)) adsSeries.set(key, (adsSeries.get(key) ?? 0) + fee);
      transactions.push({
        id: payment.id,
        source: "PAYMENT",
        type: "ads",
        amountAed: fee,
        feeAed: fee,
        seller: sellerName,
        vehicle: vehicleName,
        createdAt: payment.createdAt.toISOString(),
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
        createdAt: payment.createdAt.toISOString(),
      });
    }
  }

  for (const ad of bannerAds) {
    const occurredAt = ad.reviewedAt ?? ad.startsAt ?? ad.createdAt;
    const key = makeMonthKey(occurredAt);
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

  for (const offer of acceptedOffersWithoutCommissionInvoice) {
    const occurredAt = offer.updatedAt;
    const key = makeMonthKey(occurredAt);
    const saleAmountAed = toMoney(offer.offerPriceAed);
    const commissionRatePct = Number(offer.listing.commissionRatePct ?? 0);
    const fee = toMoney((saleAmountAed * commissionRatePct) / 100);

    if (saleSeries.has(key)) saleSeries.set(key, (saleSeries.get(key) ?? 0) + fee);

    transactions.push({
      id: `accepted-offer-${offer.id}`,
      source: "PAYMENT",
      type: "sale",
      amountAed: fee,
      feeAed: fee,
      seller: offer.listing.seller.fullName?.trim() || "Unknown Seller",
      vehicle: buildListingTitle(offer.listing),
      createdAt: occurredAt.toISOString(),
    });
  }

  for (const listing of soldListingsWithoutAcceptedOffer) {
    const occurredAt = listing.updatedAt;
    const key = makeMonthKey(occurredAt);
    const saleAmountAed = toMoney(listing.priceSellAed);
    const commissionRatePct = Number(listing.commissionRatePct ?? 0);
    const fee = toMoney((saleAmountAed * commissionRatePct) / 100);

    if (saleSeries.has(key)) saleSeries.set(key, (saleSeries.get(key) ?? 0) + fee);

    transactions.push({
      id: `sold-listing-${listing.id}`,
      source: "PAYMENT",
      type: "sale",
      amountAed: fee,
      feeAed: fee,
      seller: listing.seller.fullName?.trim() || "Unknown Seller",
      vehicle: buildListingTitle(listing),
      createdAt: occurredAt.toISOString(),
    });
  }

  const saleAed = buckets.keys.map((key) => toMoney(saleSeries.get(key) ?? 0));
  const rentalAed = buckets.keys.map((key) => toMoney(rentalSeries.get(key) ?? 0));
  const adsAed = buckets.keys.map((key) => toMoney(adsSeries.get(key) ?? 0));
  const totalAed = buckets.keys.map((_, idx) => toMoney(saleAed[idx] + rentalAed[idx] + adsAed[idx]));

  const revenueTransactions = transactions
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);

  const sum = (values: number[]) => values.reduce((acc, current) => acc + current, 0);

  res.status(200).json({
    labels: buckets.labels,
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
    transactions: revenueTransactions,
  });
};

export const getAdminCommissionTracking = async (_req: Request, res: Response) => {
  const payments = await prisma.payment.findMany({
    where: {
      purpose: {
        in: ["LISTING_FEE", "COMMISSION"],
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
    const listing = listingFromOffer ?? listingFromRef;
    const saleAmountAed = toMoney(payment.offer?.offerPriceAed ?? Number((listingFromRef as { priceSellAed?: unknown } | null)?.priceSellAed ?? 0));
    const commissionRatePct = payment.purpose === "COMMISSION" ? toMoney(listingFromOffer?.commissionRatePct ?? 0) : 0;
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
    totalInvoices: items.length,
    paidInvoices: items.filter((item: (typeof items)[number]) => item.status === "PAID").length,
    unpaidInvoices: items.filter((item: (typeof items)[number]) => item.status === "UNPAID").length,
    totalExpectedCommissionAed: toMoney(
      items.reduce((acc: number, item: (typeof items)[number]) => acc + item.expectedCommissionAed, 0)
    ),
    totalPaidCommissionAed: toMoney(
      items.reduce((acc: number, item: (typeof items)[number]) => acc + item.paidAmountAed, 0)
    ),
  };

  res.status(200).json({ items, summary });
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

  if (payment.purpose !== "LISTING_FEE" && payment.purpose !== "COMMISSION") {
    res.status(400).json({ message: "Only LISTING_FEE or COMMISSION invoices can be confirmed here" });
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
      body: `Your ${payment.purpose === "LISTING_FEE" ? "listing fee" : "commission"} invoice has been confirmed by admin.`,
      link: "/seller-activity",
    },
  });

  res.status(200).json(updated);
};
