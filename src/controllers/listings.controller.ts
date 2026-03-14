import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { parsePagination } from "../routes/utils";

const createListingSchema = z.object({
  sellerId: z.string().min(1),
  assetClass: z.enum(["CAR", "TRUCK", "BIKE", "PLATE", "PART"]),
  category: z.enum(["CARS", "TRUCKS", "BIKES", "PARTS", "PLATES"]),
  listingType: z.enum(["SELL", "RENT"]),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "SOLD", "EXPIRED", "ARCHIVED"]).optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().optional(),
  description: z.string().optional(),
  bodyType: z.string().optional(),
  mileageKm: z.number().int().optional(),
  locationArea: z.string().optional(),
  priceSellAed: z.number().optional(),
  rentPriceDayAed: z.number().optional(),
  rentPriceWeekAed: z.number().optional(),
  rentPriceMonthAed: z.number().optional(),
  rentPriceYearAed: z.number().optional(),
  rentMinDurationDays: z.number().int().optional(),
  rentSecurityDepositAed: z.number().optional(),
});

const updateListingSchema = createListingSchema.partial();

const mediaSchema = z.object({
  mediaType: z.enum([
    "COVER_IMAGE",
    "GALLERY_IMAGE",
    "PHOTO",
    "GARAGE_360",
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

export const listListings = async (req: Request, res: Response) => {
  const { skip, limit, page } = parsePagination(req);
  const q = String(req.query.q ?? "").trim();
  const listingType = req.query.listingType as "SELL" | "RENT" | undefined;
  const category = req.query.category as "CARS" | "TRUCKS" | "BIKES" | "PARTS" | "PLATES" | undefined;
  const status = req.query.status as "DRAFT" | "ACTIVE" | "PAUSED" | "SOLD" | "EXPIRED" | "ARCHIVED" | undefined;

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
    ...(listingType ? { listingType } : {}),
    ...(category ? { category } : {}),
    ...(status ? { status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: { media: true },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.listing.count({ where }),
  ]);

  res.status(200).json({ items, total, page, limit });
};

export const createListing = async (req: Request, res: Response) => {
  const payload = createListingSchema.parse(req.body);

  const listing = await prisma.listing.create({
    data: payload,
  });

  res.status(201).json(listing);
};

export const getListingById = async (req: Request<{ id: string }>, res: Response) => {
  const listingId = String(req.params.id);

  const item = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      media: true,
      maintenanceLogs: { include: { items: true } },
    },
  });

  if (!item) {
    res.status(404).json({ message: "Listing not found" });
    return;
  }

  res.status(200).json(item);
};

export const updateListingById = async (req: Request<{ id: string }>, res: Response) => {
  const listingId = String(req.params.id);
  const payload = updateListingSchema.parse(req.body);

  const listing = await prisma.listing.update({
    where: { id: listingId },
    data: payload,
  });

  res.status(200).json(listing);
};

export const deleteListingById = async (req: Request<{ id: string }>, res: Response) => {
  const listingId = String(req.params.id);
  await prisma.listing.delete({ where: { id: listingId } });
  res.status(204).send();
};

export const addListingMedia = async (req: Request<{ id: string }>, res: Response) => {
  const listingId = String(req.params.id);
  const payload = mediaSchema.parse(req.body);

  const media = await prisma.listingMedia.create({
    data: {
      listingId,
      ...payload,
    },
  });

  res.status(201).json(media);
};

export const addMaintenanceLog = async (req: Request<{ id: string }>, res: Response) => {
  const listingId = String(req.params.id);
  const body = z
    .object({
      serviceDate: z.string().datetime().optional(),
      serviceKm: z.number().int().optional(),
      serviceCenter: z.string().optional(),
      items: z.array(z.string()).optional(),
    })
    .parse(req.body);

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
