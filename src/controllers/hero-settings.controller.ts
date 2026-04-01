import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { storageService } from "../services/storageService";

const DEFAULT_SIGNED_URL_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
const HERO_SETTINGS_FILE = path.resolve(process.cwd(), "data/hero-settings.json");
const HERO_SETTINGS_STORAGE_PATH = "hero/hero-settings.json";

const bannerItemSchema = z.object({
  topText: z.string().trim().max(80),
  mainText: z.string().trim().max(120),
  description: z.string().trim().max(220),
  image: z.string().trim().min(1).max(4000),
  cta: z.string().trim().max(40).nullable().optional(),
  listingId: z.string().trim().max(64).nullable().optional(),
});

type BannerItem = z.infer<typeof bannerItemSchema>;

const DEFAULT_MARKETPLACE_BANNERS: BannerItem[] = [
  {
    topText: "01 / ELECTRIC ERA",
    mainText: "SILENT SPEED ANGEL",
    description: "Discover the pinnacle of automotive engineering and aesthetic rarity.",
    image: "https://images.unsplash.com/photo-1592198084033-aade902d1aae?w=900&auto=format&fit=crop&q=60",
    cta: null,
    listingId: null,
  },
  {
    topText: "02 / GT3 HERITAGE",
    mainText: "PURE RACING MACHINE",
    description: "Discover the pinnacle of automotive engineering and aesthetic rarity.",
    image: "https://images.unsplash.com/photo-1729118655662-352c4a776ebd?q=80&w=1298",
    cta: null,
    listingId: null,
  },
  {
    topText: "03 / ELECTRIC AGE",
    mainText: "SPECIAL RAMADAN OFFER",
    description: "Discover the pinnacle of automotive engineering and aesthetic rarity.",
    image: "https://images.unsplash.com/photo-1626966490756-6ac9354255c6?q=80&w=3687",
    cta: null,
    listingId: null,
  },
];

const DEFAULT_RENTAL_BANNERS: BannerItem[] = [
  {
    topText: "01 / RENTAL PREMIUM",
    mainText: "FLEXIBLE LUXURY RENTALS",
    description: "Book premium rentals with flexible plans.",
    image: "https://images.unsplash.com/photo-1592198084033-aade902d1aae?w=900&auto=format&fit=crop&q=60",
    cta: null,
    listingId: null,
  },
  {
    topText: "02 / WEEKEND ESCAPE",
    mainText: "DRIVE THE EXTRAORDINARY",
    description: "Choose from curated high-performance assets for your next drive.",
    image: "https://images.unsplash.com/photo-1729118655662-352c4a776ebd?q=80&w=1298",
    cta: null,
    listingId: null,
  },
  {
    topText: "03 / DAILY ELITE",
    mainText: "ROAMER RENTAL COLLECTION",
    description: "Reliable, verified, and ready for your schedule.",
    image: "https://images.unsplash.com/photo-1626966490756-6ac9354255c6?q=80&w=3687",
    cta: null,
    listingId: null,
  },
];

type HeroSettingsFileData = {
  headline: string | null;
  subheadline: string | null;
  ctaLabel: string | null;
  mediaPath: string | null;
  marketplaceBanners: BannerItem[];
  rentalBanners: BannerItem[];
};

const normalizeOptionalText = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeBannerList = (value: unknown, fallback: BannerItem[]) => {
  const parsed = z.array(bannerItemSchema).safeParse(value);
  if (!parsed.success) {
    return fallback;
  }

  const withThreeItems = parsed.data.slice(0, 3);
  if (withThreeItems.length < 3) {
    return [...withThreeItems, ...fallback.slice(withThreeItems.length, 3)];
  }

  return withThreeItems;
};

const readHeroSettingsFile = async (): Promise<HeroSettingsFileData> => {
  try {
    const raw = await storageService.readTextFile(HERO_SETTINGS_STORAGE_PATH);
    if (raw) {
      const data = JSON.parse(raw) as {
        headline?: unknown;
        subheadline?: unknown;
        ctaLabel?: unknown;
        mediaPath?: unknown;
        marketplaceBanners?: unknown;
        rentalBanners?: unknown;
      };

      return {
        headline: normalizeOptionalText(data.headline),
        subheadline: normalizeOptionalText(data.subheadline),
        ctaLabel: normalizeOptionalText(data.ctaLabel),
        mediaPath: normalizeOptionalText(data.mediaPath),
        marketplaceBanners: normalizeBannerList(data.marketplaceBanners, DEFAULT_MARKETPLACE_BANNERS),
        rentalBanners: normalizeBannerList(data.rentalBanners, DEFAULT_RENTAL_BANNERS),
      };
    }
  } catch {
    // fallback to local file
  }

  try {
    if (!fs.existsSync(HERO_SETTINGS_FILE)) {
      return {
        headline: null,
        subheadline: null,
        ctaLabel: null,
        mediaPath: null,
        marketplaceBanners: DEFAULT_MARKETPLACE_BANNERS,
        rentalBanners: DEFAULT_RENTAL_BANNERS,
      };
    }

    const raw = fs.readFileSync(HERO_SETTINGS_FILE, "utf8");
    const data = JSON.parse(raw) as {
      headline?: unknown;
      subheadline?: unknown;
      ctaLabel?: unknown;
      mediaPath?: unknown;
      marketplaceBanners?: unknown;
      rentalBanners?: unknown;
    };

    return {
      headline: normalizeOptionalText(data.headline),
      subheadline: normalizeOptionalText(data.subheadline),
      ctaLabel: normalizeOptionalText(data.ctaLabel),
      mediaPath: normalizeOptionalText(data.mediaPath),
      marketplaceBanners: normalizeBannerList(data.marketplaceBanners, DEFAULT_MARKETPLACE_BANNERS),
      rentalBanners: normalizeBannerList(data.rentalBanners, DEFAULT_RENTAL_BANNERS),
    };
  } catch {
    return {
      headline: null,
      subheadline: null,
      ctaLabel: null,
      mediaPath: null,
      marketplaceBanners: DEFAULT_MARKETPLACE_BANNERS,
      rentalBanners: DEFAULT_RENTAL_BANNERS,
    };
  }
};

const writeHeroSettingsFile = async (data: HeroSettingsFileData) => {
  const normalized = {
    headline: normalizeOptionalText(data.headline),
    subheadline: normalizeOptionalText(data.subheadline),
    ctaLabel: normalizeOptionalText(data.ctaLabel),
    mediaPath: normalizeOptionalText(data.mediaPath),
    marketplaceBanners: normalizeBannerList(data.marketplaceBanners, DEFAULT_MARKETPLACE_BANNERS),
    rentalBanners: normalizeBannerList(data.rentalBanners, DEFAULT_RENTAL_BANNERS),
  };

  const payload = JSON.stringify(normalized, null, 2);

  let wroteToStorage = false;
  try {
    await storageService.writeTextFile(HERO_SETTINGS_STORAGE_PATH, payload, "application/json");
    wroteToStorage = true;
  } catch {
    // local fallback below
  }

  try {
    fs.mkdirSync(path.dirname(HERO_SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(HERO_SETTINGS_FILE, payload, "utf8");
  } catch {
    if (!wroteToStorage) {
      throw new Error("Failed to persist hero banner settings");
    }
  }
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

const importBannerImageToGcp = async (image: string, folder: string): Promise<string> => {
  if (!isHttpUrl(image)) {
    return image;
  }

  const response = await fetch(image);
  if (!response.ok) {
    throw new Error(`Failed to fetch remote banner image: ${response.status}`);
  }

  const mimeType = response.headers.get("content-type") || "image/jpeg";
  const urlPath = (() => {
    try {
      const parsed = new URL(image);
      const fileName = parsed.pathname.split("/").filter(Boolean).pop();
      return fileName || "banner-image";
    } catch {
      return "banner-image";
    }
  })();

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return storageService.uploadFile(buffer, urlPath, folder, mimeType);
};

const ensureBannerListStoredInGcp = async (items: BannerItem[], folder: string) => {
  let changed = false;

  const next = await Promise.all(
    items.map(async (item) => {
      const image = await importBannerImageToGcp(item.image, folder);
      if (image !== item.image) changed = true;
      return {
        ...item,
        image,
      };
    })
  );

  return { items: next, changed };
};

const ensureHeroBannersStoredInGcp = async (data: { marketplaceBanners: BannerItem[]; rentalBanners: BannerItem[] }) => {
  const [marketplace, rental] = await Promise.all([
    ensureBannerListStoredInGcp(data.marketplaceBanners, "hero/marketplace"),
    ensureBannerListStoredInGcp(data.rentalBanners, "hero/rental"),
  ]);

  return {
    marketplaceBanners: marketplace.items,
    rentalBanners: rental.items,
    changed: marketplace.changed || rental.changed,
  };
};

const updateHeroSettingsSchema = z
  .object({
    headline: z.string().trim().max(200).optional(),
    subheadline: z.string().trim().max(400).optional(),
    ctaLabel: z.string().trim().max(80).optional(),
    mediaUrl: z.string().trim().max(4000).optional().nullable(),
    marketplaceBanners: z.array(bannerItemSchema).length(3).optional(),
    rentalBanners: z.array(bannerItemSchema).length(3).optional(),
  })
  .refine((payload) => Object.values(payload).some((value) => value !== undefined), {
    message: "At least one field must be provided",
  });

type HeroSettingsRow = {
  id: string;
  videoPath: string | null;
  headline: string | null;
  subheadline: string | null;
  ctaLabel: string | null;
  updatedAt: Date;
};

let heroSettingsFallback: HeroSettingsRow = {
  id: "local-fallback",
  videoPath: null,
  headline: null,
  subheadline: null,
  ctaLabel: null,
  updatedAt: new Date(),
};

const getHeroSettingsDelegate = () => {
  const client = prisma as unknown as Record<string, unknown>;
  const plural = client.heroSettings as
    | {
        findFirst: (args?: unknown) => Promise<HeroSettingsRow | null>;
        create: (args: unknown) => Promise<HeroSettingsRow>;
        update: (args: unknown) => Promise<HeroSettingsRow>;
      }
    | undefined;

  if (plural) return plural;

  const singular = client.heroSetting as
    | {
        findFirst: (args?: unknown) => Promise<HeroSettingsRow | null>;
        create: (args: unknown) => Promise<HeroSettingsRow>;
        update: (args: unknown) => Promise<HeroSettingsRow>;
      }
    | undefined;

  return singular ?? null;
};

const getOrCreateHeroSettings = async () => {
  const delegate = getHeroSettingsDelegate();
  if (!delegate) {
    const fileSettings = await readHeroSettingsFile();
    return {
      ...heroSettingsFallback,
      headline: fileSettings.headline ?? heroSettingsFallback.headline,
      subheadline: fileSettings.subheadline ?? heroSettingsFallback.subheadline,
      ctaLabel: fileSettings.ctaLabel ?? heroSettingsFallback.ctaLabel,
      videoPath: fileSettings.mediaPath ?? heroSettingsFallback.videoPath,
    };
  }

  const existing = await delegate.findFirst({ orderBy: { updatedAt: "desc" } });

  if (existing) return existing;

  return delegate.create({ data: {} });
};

const serializeHeroSettings = async (settings: {
  id: string;
  videoPath: string | null;
  headline: string | null;
  subheadline: string | null;
  ctaLabel: string | null;
  updatedAt: Date;
}) => {
  const fileSettings = await readHeroSettingsFile();
  const ensuredFileSettings = await ensureHeroBannersStoredInGcp(fileSettings);
  if (ensuredFileSettings.changed) {
    await writeHeroSettingsFile({
      headline: fileSettings.headline,
      subheadline: fileSettings.subheadline,
      ctaLabel: fileSettings.ctaLabel,
      mediaPath: fileSettings.mediaPath,
      marketplaceBanners: ensuredFileSettings.marketplaceBanners,
      rentalBanners: ensuredFileSettings.rentalBanners,
    });
  }

  const effectiveVideoPath = settings.videoPath ?? fileSettings.mediaPath;
  const effectiveHeadline = settings.headline ?? fileSettings.headline;
  const effectiveSubheadline = settings.subheadline ?? fileSettings.subheadline;
  const effectiveCtaLabel = settings.ctaLabel ?? fileSettings.ctaLabel;

  const signedVideoUrl = effectiveVideoPath
    ? await storageService.getSignedUrl(effectiveVideoPath, DEFAULT_SIGNED_URL_EXPIRY_MS)
    : null;
  const signedMarketplaceBanners = await Promise.all(
    ensuredFileSettings.marketplaceBanners.map(async (banner) => ({
      ...banner,
      imageUrl: banner.image ? await storageService.getSignedUrl(banner.image, DEFAULT_SIGNED_URL_EXPIRY_MS) : "",
    }))
  );
  const signedRentalBanners = await Promise.all(
    ensuredFileSettings.rentalBanners.map(async (banner) => ({
      ...banner,
      imageUrl: banner.image ? await storageService.getSignedUrl(banner.image, DEFAULT_SIGNED_URL_EXPIRY_MS) : "",
    }))
  );

  return {
    id: settings.id,
    mediaUrl: signedVideoUrl,
    mediaStoragePath: effectiveVideoPath,
    headline: effectiveHeadline,
    subheadline: effectiveSubheadline,
    ctaLabel: effectiveCtaLabel,
    marketplaceBanners: signedMarketplaceBanners,
    rentalBanners: signedRentalBanners,
    updatedAt: settings.updatedAt,
  };
};

export const getPublicHeroSettings = async (_req: Request, res: Response) => {
  const settings = await getOrCreateHeroSettings();
  res.status(200).json(await serializeHeroSettings(settings));
};

export const getAdminHeroSettings = async (_req: Request, res: Response) => {
  const settings = await getOrCreateHeroSettings();
  res.status(200).json(await serializeHeroSettings(settings));
};

export const updateAdminHeroSettings = async (req: Request, res: Response) => {
  const payload = updateHeroSettingsSchema.parse(req.body);
  const settings = await getOrCreateHeroSettings();
  const delegate = getHeroSettingsDelegate();

  const fileSettings = await readHeroSettingsFile();
  const nextFileSettings = await ensureHeroBannersStoredInGcp({
    marketplaceBanners: payload.marketplaceBanners ?? fileSettings.marketplaceBanners,
    rentalBanners: payload.rentalBanners ?? fileSettings.rentalBanners,
  });
  await writeHeroSettingsFile({
    headline: settings.headline ?? fileSettings.headline,
    subheadline: settings.subheadline ?? fileSettings.subheadline,
    ctaLabel: settings.ctaLabel ?? fileSettings.ctaLabel,
    mediaPath: settings.videoPath ?? fileSettings.mediaPath,
    marketplaceBanners: nextFileSettings.marketplaceBanners,
    rentalBanners: nextFileSettings.rentalBanners,
  });

  let nextVideoPath = settings.videoPath;
  if (payload.mediaUrl !== undefined) {
    if (payload.mediaUrl === null || payload.mediaUrl === "") {
      nextVideoPath = null;
    } else {
      const mediaInput = payload.mediaUrl.trim();
      const looksLikeTemporarySignedUrl = /[?&]X-Goog-Algorithm=/.test(mediaInput);
      nextVideoPath = looksLikeTemporarySignedUrl && settings.videoPath ? settings.videoPath : mediaInput;
    }
  }

  if (!delegate) {
    heroSettingsFallback = {
      ...heroSettingsFallback,
      headline: payload.headline ?? heroSettingsFallback.headline,
      subheadline: payload.subheadline ?? heroSettingsFallback.subheadline,
      ctaLabel: payload.ctaLabel ?? heroSettingsFallback.ctaLabel,
      videoPath: nextVideoPath,
      updatedAt: new Date(),
    };

    await writeHeroSettingsFile({
      headline: heroSettingsFallback.headline,
      subheadline: heroSettingsFallback.subheadline,
      ctaLabel: heroSettingsFallback.ctaLabel,
      mediaPath: heroSettingsFallback.videoPath,
      marketplaceBanners: nextFileSettings.marketplaceBanners,
      rentalBanners: nextFileSettings.rentalBanners,
    });

    res.status(200).json(await serializeHeroSettings(heroSettingsFallback));
    return;
  }

  const updated = await delegate.update({
    where: { id: settings.id },
    data: {
      ...(payload.headline !== undefined ? { headline: payload.headline } : {}),
      ...(payload.subheadline !== undefined ? { subheadline: payload.subheadline } : {}),
      ...(payload.ctaLabel !== undefined ? { ctaLabel: payload.ctaLabel } : {}),
      ...(payload.mediaUrl !== undefined ? { videoPath: nextVideoPath } : {}),
    },
  });

  await writeHeroSettingsFile({
    headline: updated.headline,
    subheadline: updated.subheadline,
    ctaLabel: updated.ctaLabel,
    mediaPath: updated.videoPath,
    marketplaceBanners: nextFileSettings.marketplaceBanners,
    rentalBanners: nextFileSettings.rentalBanners,
  });

  res.status(200).json(await serializeHeroSettings(updated));
};

export const uploadAdminHeroVideo = async (req: Request & { file?: Express.Multer.File }, res: Response) => {
  if (!req.file) {
    res.status(400).json({ message: "No file uploaded" });
    return;
  }

  const settings = await getOrCreateHeroSettings();
  const delegate = getHeroSettingsDelegate();
  const filePath = await storageService.uploadFile(req.file.buffer, req.file.originalname, "hero", req.file.mimetype);

  try {
    let updated: HeroSettingsRow;

    if (!delegate) {
      heroSettingsFallback = {
        ...heroSettingsFallback,
        videoPath: filePath,
        updatedAt: new Date(),
      };
      updated = heroSettingsFallback;
    } else {
      updated = await delegate.update({
        where: { id: settings.id },
        data: { videoPath: filePath },
      });
    }

    if (settings.videoPath && settings.videoPath !== filePath && !isHttpUrl(settings.videoPath)) {
      await storageService.deleteFile(settings.videoPath);
    }

    const fileSettings = await readHeroSettingsFile();
    await writeHeroSettingsFile({
      headline: updated.headline,
      subheadline: updated.subheadline,
      ctaLabel: updated.ctaLabel,
      mediaPath: updated.videoPath,
      marketplaceBanners: fileSettings.marketplaceBanners,
      rentalBanners: fileSettings.rentalBanners,
    });

    res.status(200).json(await serializeHeroSettings(updated));
  } catch (error) {
    await storageService.deleteFile(filePath);
    throw error;
  }
};
