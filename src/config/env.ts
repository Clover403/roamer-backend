import dotenv from "dotenv";

dotenv.config();

const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toPositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: toNumber(process.env.PORT, 4000),
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  JWT_SECRET: process.env.JWT_SECRET ?? "",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "7d",
  JWT_COOKIE_NAME: process.env.JWT_COOKIE_NAME ?? "roamer_access_token",
  JWT_COOKIE_MAX_AGE_MS: toPositiveNumber(process.env.JWT_COOKIE_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000),
};

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Please set it in backend/.env");
}

if (!env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required. Please set it in backend/.env");
}
