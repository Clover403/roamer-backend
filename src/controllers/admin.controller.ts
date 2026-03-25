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

export const getAdminDashboardOverview = async (_req: Request, res: Response) => {
  const [
    users,
    listings,
    pendingVerifications,
    activePromotions,
    totalPayments,
    pendingBadgeQueue,
    roamerVerifiedListings,
    thirdPartyVerifiedListings,
    pendingVerificationListings,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.listing.count(),
    prisma.verificationSubmission.count({ where: { status: "PENDING" } }),
    prisma.promotionCampaign.count({ where: { status: "ACTIVE" } }),
    prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amountAed: true } }),
    prisma.verificationSubmission.count({ where: { status: "PENDING" } }),
    prisma.listing.count({ where: { verificationLevel: "ROAMER" } }),
    prisma.listing.count({ where: { verificationLevel: "THIRD_PARTY" } }),
    prisma.listing.count({ where: { verificationType: { in: ["ROAMER", "THIRD_PARTY"] }, verificationLevel: "NONE" } }),
  ]);

  const [activeListings, soldListings, draftListings] = await Promise.all([
    prisma.listing.count({ where: { status: "ACTIVE" } }),
    prisma.listing.count({ where: { status: "SOLD" } }),
    prisma.listing.count({ where: { status: "DRAFT" } }),
  ]);

  res.status(200).json({
    users,
    listings,
    pendingVerifications,
    pendingBadgeQueue,
    activePromotions,
    revenueAed: totalPayments._sum.amountAed ?? 0,
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
      hybridListingFeeAed: z.number().min(0).max(200000).optional(),
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

  const [payments, bannerAds] = await Promise.all([
    prisma.payment.findMany({
      where: {
        status: "PAID",
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
  const offers = await prisma.jointOffer.findMany({
    where: {
      status: "ACCEPTED",
      listing: {
        paymentModel: {
          in: ["commission", "hybrid"],
        },
      },
    },
    include: {
      listing: {
        select: {
          id: true,
          make: true,
          model: true,
          year: true,
          paymentModel: true,
          commissionRatePct: true,
          seller: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      },
      payments: {
        where: {
          purpose: "COMMISSION",
        },
        select: {
          id: true,
          amountAed: true,
          status: true,
          paidAt: true,
          providerPaymentRef: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const items = offers.map((offer: (typeof offers)[number]) => {
    const saleAmountAed = toMoney(offer.offerPriceAed);
    const commissionRatePct = toMoney(offer.listing.commissionRatePct);
    const expectedCommissionAed = toMoney((saleAmountAed * commissionRatePct) / 100);
    const paidPayment = offer.payments.find((payment: (typeof offer.payments)[number]) => payment.status === "PAID");

    return {
      invoiceId: offer.id,
      offerId: offer.id,
      listingId: offer.listing.id,
      listingTitle: [offer.listing.make, offer.listing.model, offer.listing.year ? String(offer.listing.year) : null]
        .filter(Boolean)
        .join(" ") || "Listing",
      seller: {
        id: offer.listing.seller.id,
        name: offer.listing.seller.fullName?.trim() || "Unknown Seller",
        email: offer.listing.seller.email,
      },
      paymentModel: offer.listing.paymentModel,
      saleAmountAed,
      commissionRatePct,
      expectedCommissionAed,
      status: paidPayment ? "PAID" : "UNPAID",
      paidAmountAed: paidPayment ? toMoney(paidPayment.amountAed) : 0,
      paidAt: paidPayment?.paidAt?.toISOString() ?? null,
      paymentReference: paidPayment?.providerPaymentRef ?? null,
      createdAt: offer.createdAt.toISOString(),
      updatedAt: offer.updatedAt.toISOString(),
      chatLink: `/my-groups?tab=personals&targetUserId=${offer.listing.seller.id}`,
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
