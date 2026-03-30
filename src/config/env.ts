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

const toOrigins = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) return fallback;

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : fallback;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: toNumber(process.env.PORT, 4000),
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  CORS_ORIGINS: toOrigins(
    process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN,
    ["http://localhost:5173", "http://127.0.0.1:5173", "https://*.vercel.app"]
  ),
  JWT_SECRET: process.env.JWT_SECRET ?? "",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "7d",
  JWT_COOKIE_NAME: process.env.JWT_COOKIE_NAME ?? "roamer_access_token",
  JWT_COOKIE_MAX_AGE_MS: toPositiveNumber(process.env.JWT_COOKIE_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000),
  APP_BASE_URL: process.env.APP_BASE_URL ?? "http://localhost:5173",
  BACKEND_PUBLIC_URL: process.env.BACKEND_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? "4000"}`,
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? "",
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL ?? "",
  DEV_SKIP_EMAIL_VERIFICATION: process.env.DEV_SKIP_EMAIL_VERIFICATION === "true",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI ?? "",
  STORAGE_PROVIDER: (process.env.STORAGE_PROVIDER ?? "gcp").toLowerCase(),
  GCP_PROJECT_ID: process.env.GCP_PROJECT_ID ?? "",
  GCP_BUCKET_NAME: process.env.GCP_BUCKET_NAME ?? "",
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "",
  GOOGLE_APPLICATION_CREDENTIALS_JSON: process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "",
};

if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Please set it in backend/.env");
}

if (!env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required. Please set it in backend/.env");
}

if (env.NODE_ENV === "production" && !env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY is required for email verification in production. Please set it in backend/.env");
}

if (env.NODE_ENV === "production" && !env.RESEND_FROM_EMAIL) {
  throw new Error("RESEND_FROM_EMAIL is required for email verification in production. Please set it in backend/.env");
}

if (env.STORAGE_PROVIDER !== "gcp") {
  throw new Error("STORAGE_PROVIDER must be 'gcp'. Local storage fallback has been disabled.");
}

if (!env.GCP_PROJECT_ID) {
  throw new Error("GCP_PROJECT_ID is required for cloud storage.");
}

if (!env.GCP_BUCKET_NAME) {
  throw new Error("GCP_BUCKET_NAME is required for cloud storage.");
}

if (!env.GOOGLE_APPLICATION_CREDENTIALS && !env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  throw new Error(
    "Either GOOGLE_APPLICATION_CREDENTIALS (file path) or GOOGLE_APPLICATION_CREDENTIALS_JSON must be set for cloud storage."
  );
}
