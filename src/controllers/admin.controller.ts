import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { buildDayBuckets, getRangeStart, makeDayKey, parseDashboardRange } from "./dashboard.utils";

export const getAdminDashboardOverview = async (_req: Request, res: Response) => {
  const [users, listings, pendingVerifications, activePromotions, totalPayments, pendingBadgeQueue] = await Promise.all([
    prisma.user.count(),
    prisma.listing.count(),
    prisma.verificationSubmission.count({ where: { status: "PENDING" } }),
    prisma.promotionCampaign.count({ where: { status: "ACTIVE" } }),
    prisma.payment.aggregate({ _sum: { amountAed: true } }),
    prisma.verificationSubmission.count({ where: { status: "PENDING" } }),
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
