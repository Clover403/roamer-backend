import http from "http";

// Ensure environment variables are loaded before anything else
import "./config/env";

import { app } from "./app";
import { env } from "./config/env";
import { createSocketServer } from "./socket";
import { prisma } from "./lib/prisma";
import { runRentalLifecycle } from "./controllers/rentals.controller";
import { runBannerAdsLifecycle } from "./controllers/ads.controller";
import { storageRuntime } from "./services/storageService";

const parseDatabaseTarget = (url: string) => {
  try {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, "") || "(unknown)";
    const schema = parsed.searchParams.get("schema") || "public";
    return `${parsed.hostname}:${parsed.port || "5432"}/${database}?schema=${schema}`;
  } catch {
    return "(invalid DATABASE_URL)";
  }
};

const server = http.createServer(app);
createSocketServer(server);

const start = async () => {
  // eslint-disable-next-line no-console
  console.log(`[storage] mode=${storageRuntime.mode}${storageRuntime.bucketName ? ` bucket=${storageRuntime.bucketName}` : ""}`);
  // eslint-disable-next-line no-console
  console.log(`[db] target=${parseDatabaseTarget(env.DATABASE_URL)}`);

  server.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Roamer backend listening on http://localhost:${env.PORT}`);
  });

  const CRON_INTERVAL_MS = 10 * 60 * 1000;
  setInterval(() => {
    void runRentalLifecycle().catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[rental-cron] failed", error);
    });
  }, CRON_INTERVAL_MS);

  const ADS_CRON_INTERVAL_MS = env.NODE_ENV === "development" ? 30 * 1000 : 60 * 60 * 1000;
  setInterval(() => {
    void runBannerAdsLifecycle().catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[ads-cron] failed", error);
    });
  }, ADS_CRON_INTERVAL_MS);
};

void start();

const shutdown = async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
