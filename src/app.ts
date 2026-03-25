import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { ZodError } from "zod";
import { env } from "./config/env";
import { apiRouter } from "./routes";

export const app = express();

const normalizeOrigin = (origin: string): string => origin.replace(/\/+$/, "");

const isOriginAllowed = (requestOrigin: string, allowedOrigins: string[]): boolean => {
  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);

  return allowedOrigins.some((allowed) => {
    const normalizedAllowed = normalizeOrigin(allowed);

    if (normalizedAllowed === normalizedRequestOrigin) {
      return true;
    }

    if (!normalizedAllowed.includes("*")) {
      return false;
    }

    if (!normalizedAllowed.startsWith("http://*.") && !normalizedAllowed.startsWith("https://*.")) {
      return false;
    }

    try {
      const requestUrl = new URL(normalizedRequestOrigin);
      const allowedProtocol = normalizedAllowed.startsWith("https://") ? "https:" : "http:";
      const wildcardDomain = normalizedAllowed.replace(/^https?:\/\/\*\./, "");

      if (requestUrl.protocol !== allowedProtocol) {
        return false;
      }

      return requestUrl.hostname === wildcardDomain || requestUrl.hostname.endsWith(`.${wildcardDomain}`);
    } catch {
      return false;
    }
  });
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isOriginAllowed(origin, env.CORS_ORIGINS)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "roamer-backend",
    version: "1.0.0",
    status: "running",
  });
});

app.use("/api", apiRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      message: "Validation failed",
      issues: error.issues,
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Internal server error";

  res.status(500).json({
    message,
  });
});
