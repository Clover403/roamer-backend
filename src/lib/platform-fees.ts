import { prisma } from "./prisma";

export type PlatformFeeSettingsDto = {
  saleCommissionPct: number;
  rentalFeePct: number;
  listingFeePct: number;
  hybridCommissionPct: number;
  hybridListingFeeAed: number;
  updatedById: string | null;
  updatedAt: string;
};

const DEFAULT_PLATFORM_FEES = {
  saleCommissionPct: 2.5,
  rentalFeePct: 12,
  listingFeePct: 1,
  hybridCommissionPct: 1.5,
  hybridListingFeeAed: 1,
};

const isLegacyListingFeeFieldError = (error: unknown) =>
  error instanceof Error && /Unknown argument\s+`listingFeePct`/i.test(error.message);

const toCreateData = (useLegacyField: boolean) => ({
  id: "default",
  saleCommissionPct: DEFAULT_PLATFORM_FEES.saleCommissionPct,
  rentalFeePct: DEFAULT_PLATFORM_FEES.rentalFeePct,
  ...(useLegacyField
    ? { listingFeeAed: DEFAULT_PLATFORM_FEES.listingFeePct }
    : { listingFeePct: DEFAULT_PLATFORM_FEES.listingFeePct }),
  hybridCommissionPct: DEFAULT_PLATFORM_FEES.hybridCommissionPct,
  hybridListingFeeAed: DEFAULT_PLATFORM_FEES.hybridListingFeeAed,
});

const normalizeSettingsRow = (row: any): PlatformFeeSettingsDto => ({
  // NOTE: `hybridListingFeeAed` is kept for backward compatibility in schema naming,
  // but it is treated as HYBRID UPFRONT FEE PERCENTAGE.
  // Legacy large AED-like values are normalized to listing fee percentage fallback.
  // This avoids static upfront values for hybrid model.
  saleCommissionPct: Number(row.saleCommissionPct),
  rentalFeePct: Number(row.rentalFeePct),
  listingFeePct: Number(row.listingFeePct ?? row.listingFeeAed ?? DEFAULT_PLATFORM_FEES.listingFeePct),
  hybridCommissionPct: Number(row.hybridCommissionPct),
  hybridListingFeeAed:
    Number(row.hybridListingFeeAed) > 0 && Number(row.hybridListingFeeAed) <= 100
      ? Number(row.hybridListingFeeAed)
      : Number(row.listingFeePct ?? row.listingFeeAed ?? DEFAULT_PLATFORM_FEES.listingFeePct),
  updatedById: row.updatedById ?? null,
  updatedAt: new Date(row.updatedAt ?? new Date()).toISOString(),
});

export const ensurePlatformFeeSettings = async () => {
  try {
    return await (prisma.platformFeeSetting as any).upsert({
      where: { id: "default" },
      update: {},
      create: toCreateData(false),
    });
  } catch (error) {
    if (!isLegacyListingFeeFieldError(error)) throw error;

    return (prisma.platformFeeSetting as any).upsert({
      where: { id: "default" },
      update: {},
      create: toCreateData(true),
    });
  }
};

export const updatePlatformFeeSettings = async (
  payload: {
    saleCommissionPct?: number;
    rentalFeePct?: number;
    listingFeePct?: number;
    hybridCommissionPct?: number;
    hybridListingFeeAed?: number;
  },
  updatedById?: string
) => {
  const commonData = {
    saleCommissionPct: payload.saleCommissionPct,
    rentalFeePct: payload.rentalFeePct,
    hybridCommissionPct: payload.hybridCommissionPct,
    hybridListingFeeAed: payload.hybridListingFeeAed,
    updatedById,
  };

  try {
    return await (prisma.platformFeeSetting as any).update({
      where: { id: "default" },
      data: {
        ...commonData,
        listingFeePct: payload.listingFeePct,
      },
    });
  } catch (error) {
    if (!isLegacyListingFeeFieldError(error)) throw error;

    return (prisma.platformFeeSetting as any).update({
      where: { id: "default" },
      data: {
        ...commonData,
        listingFeeAed: payload.listingFeePct,
      },
    });
  }
};

export const mapPlatformFeeSettings = (
  row: Awaited<ReturnType<typeof ensurePlatformFeeSettings>>
): PlatformFeeSettingsDto => normalizeSettingsRow(row);
