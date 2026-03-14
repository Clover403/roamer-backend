import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { parsePagination } from "../routes/utils";
import { buildDayBuckets, getChangePercent, getRangeStart, makeDayKey, parseDashboardRange, rangeToDays } from "./dashboard.utils";

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

  const where = q
    ? {
        OR: [
          { fullName: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
    prisma.user.count({ where }),
  ]);

  res.status(200).json({ items, page, limit, total });
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

  res.status(200).json(user);
};

export const updateUserById = async (req: Request<{ id: string }>, res: Response) => {
  const userId = String(req.params.id);
  const data = updateUserSchema.parse(req.body);

  const user = await prisma.user.update({
    where: { id: userId },
    data,
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
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { renter: true, listing: true },
    }),
    prisma.jointOffer.findMany({
      where: { listing: { sellerId } },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { listing: true, participants: true, group: true },
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
