import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

type AuthedRequest = Request & {
  authUser?: {
    id: string;
  };
};

const isTestEnv = () => process.env.NODE_ENV === "test";

const buildLimiter = ({
  windowMs,
  max,
  message,
  keyGenerator,
  skip,
}: {
  windowMs: number;
  max: number;
  message: string;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => isTestEnv() || (skip ? skip(req) : false),
    keyGenerator,
    message: {
      message,
    },
  });

export const apiRateLimiter = buildLimiter({
  windowMs: 60 * 1000,
  max: 240,
  message: "Too many requests. Please try again shortly.",
  skip: (req) => req.path.startsWith("/auth"),
});

export const authRateLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: "Too many authentication attempts. Please wait before trying again.",
});

export const googleAuthRateLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 120,
  message: "Too many Google authentication attempts. Please wait before trying again.",
});

export const verificationUploadRateLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: "Too many document uploads. Please try again later.",
  keyGenerator: (req) => {
    const authedReq = req as AuthedRequest;
    if (authedReq.authUser?.id) {
      return `user:${authedReq.authUser.id}`;
    }

    return `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
});

export const verificationSubmissionRateLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 6,
  message: "Too many verification submission attempts. Please try again later.",
  keyGenerator: (req) => {
    const authedReq = req as AuthedRequest;
    if (authedReq.authUser?.id) {
      return `user:${authedReq.authUser.id}`;
    }

    return `ip:${ipKeyGenerator(req.ip ?? "")}`;
  },
});
