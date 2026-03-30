import fs from "fs/promises";
import path from "path";

export type BannerAdPricingSettings = {
  package3DaysAed: number;
  package7DaysAed: number;
  package30DaysAed: number;
  updatedAt: string;
  updatedById: string | null;
};

const DEFAULT_BANNER_AD_PRICING: BannerAdPricingSettings = {
  package3DaysAed: 299,
  package7DaysAed: 599,
  package30DaysAed: 1999,
  updatedAt: new Date(0).toISOString(),
  updatedById: null,
};

const SETTINGS_DIR = path.resolve(process.cwd(), "data");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "banner-ad-pricing.json");

const clampMoney = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed * 100) / 100;
};

const normalize = (value: Partial<BannerAdPricingSettings> | null | undefined): BannerAdPricingSettings => ({
  package3DaysAed: clampMoney(value?.package3DaysAed, DEFAULT_BANNER_AD_PRICING.package3DaysAed),
  package7DaysAed: clampMoney(value?.package7DaysAed, DEFAULT_BANNER_AD_PRICING.package7DaysAed),
  package30DaysAed: clampMoney(value?.package30DaysAed, DEFAULT_BANNER_AD_PRICING.package30DaysAed),
  updatedAt: value?.updatedAt ? new Date(value.updatedAt).toISOString() : new Date().toISOString(),
  updatedById: value?.updatedById ?? null,
});

const writeSettings = async (settings: BannerAdPricingSettings) => {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
};

export const getBannerAdPricingSettings = async (): Promise<BannerAdPricingSettings> => {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<BannerAdPricingSettings>;
    const normalized = normalize(parsed);

    if (
      normalized.package3DaysAed !== Number(parsed.package3DaysAed) ||
      normalized.package7DaysAed !== Number(parsed.package7DaysAed) ||
      normalized.package30DaysAed !== Number(parsed.package30DaysAed)
    ) {
      await writeSettings(normalized);
    }

    return normalized;
  } catch {
    const normalized = normalize(DEFAULT_BANNER_AD_PRICING);
    await writeSettings(normalized);
    return normalized;
  }
};

export const updateBannerAdPricingSettings = async (
  patch: Partial<Pick<BannerAdPricingSettings, "package3DaysAed" | "package7DaysAed" | "package30DaysAed">>,
  updatedById?: string
): Promise<BannerAdPricingSettings> => {
  const current = await getBannerAdPricingSettings();
  const merged = normalize({
    ...current,
    ...patch,
    updatedById: updatedById ?? current.updatedById ?? null,
    updatedAt: new Date().toISOString(),
  });

  await writeSettings(merged);
  return merged;
};
