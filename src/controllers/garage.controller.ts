import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";

type AuthedRequest = Request & {
  authUser?: {
    id: string;
    role: "USER" | "ADMIN";
  };
};

type GarageAssetResponse = {
  id: string;
  assetType: "SAVED" | "OWNED" | "RENTED";  // 🆕 Add asset type
  rentalRequestId?: string | null;
  rentalStatus?: "REQUESTED" | "APPROVED" | "ACTIVE" | null;
  rentalStartsAt?: string | null;
  rentalEndsAt?: string | null;
  rentalStage?: string | null;
  isManual: boolean;
  make: string;
  model: string;
  year: number | null;
  image: string;
  purchasePrice: number;
  currentValue: number | null;
  latestValue: number | null;
  specs: string;
  engine: string;
  transmission: string;
  fuelType: string;
  drivetrain: string;
  plateNumber: string;
  mileage: number | null;
  color: string;
  purchaseDate: string | null;
  ownershipShare: number;
  changePctFromPurchase: number | null;
};

const MANUAL_ASSET_NOTES = "Created from Add to Garage";

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object" && value !== null && "toString" in value && typeof (value as { toString: () => string }).toString === "function") {
    const parsed = Number((value as { toString: () => string }).toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const createGarageAssetSchema = z.object({
  make: z.string().trim().min(1),
  model: z.string().trim().min(1),
  year: z.coerce.number().int().min(1900).max(2100),
  bodyType: z.string().trim().optional(),
  engine: z.string().trim().optional(),
  transmission: z.string().trim().optional(),
  fuelType: z.string().trim().optional(),
  drivetrain: z.string().trim().optional(),
  mileage: z.coerce.number().int().nonnegative().optional(),
  horsepower: z.coerce.number().int().nonnegative().optional(),
  torque: z.coerce.number().int().nonnegative().optional(),
  specs: z.string().trim().optional(),
  purchasePrice: z.coerce.number().nonnegative().optional(),
  currentPrice: z.coerce.number().nonnegative().optional(),
  value: z.coerce.number().nonnegative().optional(),
  purchaseDate: z.string().trim().optional(),
  plateNumber: z.string().trim().optional(),
});

const updateGarageAssetSchema = createGarageAssetSchema.partial().extend({
  make: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
});

export const createMyGarageAsset = async (req: AuthedRequest, res: Response) => {
  const userId = req.authUser?.id;
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const payload = createGarageAssetSchema.parse(req.body);

  const parsedPurchaseDate = payload.purchaseDate ? new Date(payload.purchaseDate) : null;
  const isValidPurchaseDate = parsedPurchaseDate ? !Number.isNaN(parsedPurchaseDate.getTime()) : false;

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const purchasePrice = payload.purchasePrice ?? payload.value;
    const currentPrice = payload.currentPrice ?? payload.value;

    const listing = await tx.listing.create({
      data: {
        sellerId: userId,
        assetClass: "CAR",
        category: "CARS",
        listingType: "SELL",
        status: "ARCHIVED",
        moderationStatus: "APPROVED",
        title: `${payload.make} ${payload.model}`,
        make: payload.make,
        model: payload.model,
        year: payload.year,
        bodyType: payload.bodyType,
        engine: payload.engine,
        transmission: payload.transmission,
        fuelType: payload.fuelType,
        driveType: payload.drivetrain,
        mileageKm: payload.mileage,
        horsepower: payload.horsepower,
        torqueNm: payload.torque,
        regionSpec: payload.specs,
        plateNumber: payload.plateNumber,
        priceSellAed: purchasePrice,
        soldAt: isValidPurchaseDate ? parsedPurchaseDate ?? undefined : undefined,
      },
      select: { id: true },
    });

    const garageAsset = await tx.garageAsset.create({
      data: {
        userId,
        listingId: listing.id,
        assetType: "OWNED",
        currentValue: currentPrice,
        notes: MANUAL_ASSET_NOTES,
      },
      select: { id: true, listingId: true },
    });

    return garageAsset;
  });

  res.status(201).json(created);
};

export const updateMyGarageAsset = async (req: AuthedRequest, res: Response) => {
  const userId = req.authUser?.id;
  const listingId = String(req.params.listingId ?? "").trim();

  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  if (!listingId) {
    res.status(400).json({ message: "listingId is required" });
    return;
  }

  const payload = updateGarageAssetSchema.parse(req.body);

  const existing = await prisma.garageAsset.findFirst({
    where: {
      userId,
      listingId,
      assetType: "OWNED",
    },
    include: {
      listing: {
        select: {
          sellerId: true,
        },
      },
    },
  });

  if (!existing) {
    res.status(404).json({ message: "Garage asset not found" });
    return;
  }

  if (existing.notes !== MANUAL_ASSET_NOTES || existing.listing.sellerId !== userId) {
    res.status(403).json({ message: "Only manually added assets can be edited" });
    return;
  }

  const parsedPurchaseDate = payload.purchaseDate ? new Date(payload.purchaseDate) : null;
  const isValidPurchaseDate = parsedPurchaseDate ? !Number.isNaN(parsedPurchaseDate.getTime()) : false;

  const purchasePrice = payload.purchasePrice ?? payload.value;
  const currentPrice = payload.currentPrice ?? payload.value;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.listing.update({
      where: { id: listingId },
      data: {
        title:
          payload.make || payload.model
            ? `${payload.make ?? ""} ${payload.model ?? ""}`.trim() || undefined
            : undefined,
        make: payload.make,
        model: payload.model,
        year: payload.year,
        bodyType: payload.bodyType,
        engine: payload.engine,
        transmission: payload.transmission,
        fuelType: payload.fuelType,
        driveType: payload.drivetrain,
        mileageKm: payload.mileage,
        horsepower: payload.horsepower,
        torqueNm: payload.torque,
        regionSpec: payload.specs,
        plateNumber: payload.plateNumber,
        priceSellAed: purchasePrice,
        soldAt: isValidPurchaseDate ? parsedPurchaseDate ?? undefined : undefined,
      },
    });

    await tx.garageAsset.update({
      where: { id: existing.id },
      data: {
        currentValue: currentPrice,
      },
    });
  });

  res.status(200).json({ id: existing.id, listingId });
};

export const listMyGarageAssets = async (req: AuthedRequest, res: Response) => {
  const userId = req.authUser?.id;
  const listingIdFilter = typeof req.query.id === "string" ? req.query.id : undefined;
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const ownedAssets = await prisma.garageAsset.findMany({
    where: {
      userId,
      assetType: "OWNED",
      ...(listingIdFilter ? { listingId: listingIdFilter } : {}),
    },
    include: {
      listing: {
        include: {
          media: true,
        },
      },
    },
    orderBy: { addedAt: "desc" },
  });

  const acceptedParticipantOffers = await prisma.offerParticipant.findMany({
    where: {
      userId,
      offer: {
        status: "ACCEPTED",
        ...(listingIdFilter ? { listingId: listingIdFilter } : {}),
      },
    },
    include: {
      offer: {
        include: {
          listing: {
            include: {
              media: true,
            },
          },
        },
      },
    },
    orderBy: { offer: { createdAt: "desc" } },
  });

  const renterRentals = await prisma.rentalBooking.findMany({
    where: {
      renterId: userId,
      status: { in: ["REQUESTED", "APPROVED", "ACTIVE"] },
      ...(listingIdFilter ? { listingId: listingIdFilter } : {}),
    },
    include: {
      listing: {
        include: {
          media: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const latestAcceptedOfferByListing = new Map<string, (typeof acceptedParticipantOffers)[number]>();
  for (const row of acceptedParticipantOffers) {
    if (!latestAcceptedOfferByListing.has(row.offer.listingId)) {
      latestAcceptedOfferByListing.set(row.offer.listingId, row);
    }
  }

  const ownedAssetByListing = new Map<string, (typeof ownedAssets)[number]>();
  for (const owned of ownedAssets) {
    if (!ownedAssetByListing.has(owned.listingId)) {
      ownedAssetByListing.set(owned.listingId, owned);
    }
  }

  const activeRentalByListing = new Map<string, (typeof renterRentals)[number]>();
  for (const rental of renterRentals) {
    if (!activeRentalByListing.has(rental.listingId)) {
      activeRentalByListing.set(rental.listingId, rental);
    }
  }

  const listingIds = new Set<string>([
    ...Array.from(ownedAssetByListing.keys()),
    ...Array.from(latestAcceptedOfferByListing.keys()),
    ...Array.from(activeRentalByListing.keys()),
  ]);

  const listingIdList = Array.from(listingIds);
  const latestValueRows = listingIdList.length
    ? (await prisma.$queryRaw(Prisma.sql`
        SELECT "listingId", MAX("currentValue") AS "latestValue"
        FROM "GarageAsset"
        WHERE "assetType" = 'OWNED'
          AND "listingId" IN (${Prisma.join(listingIdList)})
        GROUP BY "listingId"
      `)) as Array<{ listingId: string; latestValue: number | null }>
    : [];

  const latestValueByListing = new Map<string, number | null>(
    latestValueRows.map((row) => [row.listingId, row.latestValue === null ? null : Number(row.latestValue)])
  );

  const dedupedByListing = new Map<string, GarageAssetResponse>();

  for (const listingId of listingIds) {
    const owned = ownedAssetByListing.get(listingId);
    const acceptedOfferRow = latestAcceptedOfferByListing.get(listingId);
    const activeRental = activeRentalByListing.get(listingId);
    const listing = owned?.listing ?? acceptedOfferRow?.offer.listing ?? activeRental?.listing;
    const acceptedOffer = acceptedOfferRow?.offer;
    if (!listing) continue;

    const sortedMedia = [...listing.media].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const image =
      sortedMedia.find((m) => m.mediaType === "COVER_IMAGE")?.url ??
      sortedMedia[0]?.url ??
      "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?q=80&w=1400&auto=format&fit=crop";

    const isRentalAsset = !owned && !acceptedOfferRow && Boolean(activeRental);
    const ownershipShare = isRentalAsset ? 0 : acceptedOfferRow ? toNumber(acceptedOfferRow.ownershipShare) : 100;
    const participantContribution = acceptedOfferRow ? toNumber(acceptedOfferRow.contributionAed) : 0;
    const fallbackListingPrice = toNumber(listing.priceSellAed);
    const purchasePrice = isRentalAsset
      ? toNumber(activeRental?.totalAed ?? activeRental?.subtotalAed ?? 0)
      : participantContribution > 0
        ? participantContribution
        : fallbackListingPrice > 0
          ? Math.round((fallbackListingPrice * ownershipShare) / 100)
          : 0;

    const listingLatestValue = isRentalAsset ? null : latestValueByListing.get(listingId) ?? owned?.currentValue ?? null;
    const currentValue = listingLatestValue !== null
      ? Math.round((listingLatestValue * ownershipShare) / 100)
      : null;

    const purchaseDate =
      listing.soldAt?.toISOString() ??
      acceptedOffer?.createdAt?.toISOString() ??
      activeRental?.startDate?.toISOString() ??
      owned?.addedAt?.toISOString() ??
      null;

    const rentalStage =
      activeRental?.status === "REQUESTED"
        ? "Waiting seller approval"
        : activeRental?.status === "APPROVED"
          ? "Approved by seller"
          : activeRental?.status === "ACTIVE"
            ? "Rental active"
            : null;

    const item: GarageAssetResponse = {
      id: listing.id,
      assetType: isRentalAsset ? "RENTED" : "OWNED",
      rentalRequestId: activeRental?.id ?? null,
      rentalStatus: activeRental?.status ?? null,
      rentalStartsAt: activeRental?.startDate?.toISOString() ?? null,
      rentalEndsAt: activeRental?.endDate?.toISOString() ?? null,
      rentalStage,
      isManual: Boolean(owned && owned.notes === MANUAL_ASSET_NOTES),
      make: listing.make ?? "Unknown",
      model: listing.model ?? "Model",
      year: listing.year ?? null,
      image,
      purchasePrice,
      currentValue,
      latestValue: listingLatestValue,
      specs: listing.regionSpec ?? listing.bodyType ?? "-",
      engine: listing.engine ?? "-",
      transmission: listing.transmission ?? "-",
      fuelType: listing.fuelType ?? "-",
      drivetrain: listing.driveType ?? "-",
      plateNumber: listing.plateNumber ?? "",
      mileage: listing.mileageKm ?? null,
      color: listing.exteriorColor ?? "-",
      purchaseDate,
      ownershipShare,
      changePctFromPurchase:
        currentValue !== null && purchasePrice > 0
          ? Number((((currentValue - purchasePrice) / purchasePrice) * 100).toFixed(2))
          : null,
    };

    if (!dedupedByListing.has(listing.id)) {
      dedupedByListing.set(listing.id, item);
    }
  }

  const items = Array.from(dedupedByListing.values()).sort((a, b) => {
    const ta = a.purchaseDate ? new Date(a.purchaseDate).getTime() : 0;
    const tb = b.purchaseDate ? new Date(b.purchaseDate).getTime() : 0;
    return tb - ta;
  });

  res.status(200).json(items);
};

export const updateGarageLatestValue = async (req: AuthedRequest, res: Response) => {
  const actor = req.authUser;
  const payload = req.body as { listingId?: string; latestValue?: number };
  const listingId = String(payload.listingId ?? "").trim();
  const latestValue = Number(payload.latestValue);

  if (!actor?.id) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  if (!listingId) {
    res.status(400).json({ message: "listingId is required" });
    return;
  }

  if (!Number.isFinite(latestValue) || latestValue < 0) {
    res.status(400).json({ message: "latestValue must be a non-negative number" });
    return;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { id: true, sellerId: true, status: true },
  });

  if (!listing) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  const isPlatformAdmin = actor.role === "ADMIN";
  const isListingSeller = listing.sellerId === actor.id;

  if (!isPlatformAdmin && !isListingSeller) {
    res.status(403).json({ message: "Not allowed to update latest value for this listing" });
    return;
  }

  if (listing.status !== "SOLD") {
    res.status(400).json({ message: "Latest value can only be updated for SOLD listings" });
    return;
  }

  const existingOwnedCount = await prisma.garageAsset.count({
    where: {
      listingId,
      assetType: "OWNED",
    },
  });

  if (existingOwnedCount === 0) {
    const acceptedParticipants = await prisma.offerParticipant.findMany({
      where: {
        offer: {
          listingId,
          status: "ACCEPTED",
        },
      },
      select: {
        userId: true,
      },
      distinct: ["userId"],
    });

    if (acceptedParticipants.length > 0) {
      await prisma.garageAsset.createMany({
        data: acceptedParticipants.map((participant: { userId: string }) => ({
          userId: participant.userId,
          listingId,
          assetType: "OWNED" as const,
          currentValue: null,
          notes: "Auto-backfilled from accepted offer participants",
        })),
        skipDuplicates: true,
      });
    }
  }

  const updatedCount = Number(await prisma.$executeRaw(Prisma.sql`
    UPDATE "GarageAsset"
    SET "currentValue" = ${latestValue}
    WHERE "listingId" = ${listingId}
      AND "assetType" = 'OWNED'
  `));

  if (updatedCount === 0) {
    res.status(404).json({ message: "No owned garage assets found for this SOLD listing" });
    return;
  }

  res.status(200).json({ updatedCount, listingId, latestValue });
};
