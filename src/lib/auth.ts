import jwt, { type SignOptions } from "jsonwebtoken";
import type { Request, Response } from "express";
import { env } from "../config/env";

export type AuthJwtPayload = {
  sub: string;
  email: string;
  role: "USER" | "ADMIN";
};

const jwtOptions: SignOptions = {
  expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
};

export const signAuthToken = (payload: AuthJwtPayload) => {
  return jwt.sign(payload, env.JWT_SECRET, jwtOptions);
};

export const verifyAuthToken = (token: string) => {
  return jwt.verify(token, env.JWT_SECRET) as AuthJwtPayload;
};

const safeDecodeCookieValue = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const getRawCookieCandidates = (req: Request, cookieName: string) => {
  const rawHeader = req.headers.cookie;
  if (!rawHeader) return [] as string[];

  return rawHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${cookieName}=`))
    .map((part) => safeDecodeCookieValue(part.slice(cookieName.length + 1)))
    .filter(Boolean);
};

export const getAuthTokenFromRequest = (req: Request) => {
  const candidates = new Set<string>();

  const cookieParserToken = req.cookies?.[env.JWT_COOKIE_NAME] as string | undefined;
  if (cookieParserToken) {
    candidates.add(cookieParserToken);
  }

  for (const token of getRawCookieCandidates(req, env.JWT_COOKIE_NAME)) {
    candidates.add(token);
  }

  if (candidates.size === 0) return undefined;

  let newestValidToken: string | undefined;
  let newestIat = -1;

  for (const token of candidates) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
      const iat = typeof payload.iat === "number" ? payload.iat : 0;
      if (iat >= newestIat) {
        newestIat = iat;
        newestValidToken = token;
      }
    } catch {
      // ignore invalid candidates and continue checking others
    }
  }

  if (newestValidToken) return newestValidToken;

  return Array.from(candidates)[0];
};

export const setAuthCookie = (res: Response, token: string) => {
  const baseOptions = {
    httpOnly: true,
    sameSite: env.JWT_COOKIE_SAME_SITE,
    secure: env.NODE_ENV === "production",
    maxAge: env.JWT_COOKIE_MAX_AGE_MS,
    path: "/",
  } as const;

  if (env.JWT_COOKIE_DOMAIN) {
    res.cookie(env.JWT_COOKIE_NAME, token, {
      ...baseOptions,
      domain: env.JWT_COOKIE_DOMAIN,
    });
  }

  // Also set host-only cookie to avoid stale domain/host cookie collisions.
  res.cookie(env.JWT_COOKIE_NAME, token, baseOptions);
};

export const clearAuthCookie = (res: Response) => {
  const sameSiteVariants: Array<"lax" | "strict" | "none"> = ["lax", "strict", "none"];
  const clearVariants: Array<{
    secure: boolean;
    sameSite: "lax" | "strict" | "none";
    domain?: string;
  }> = [
    ...sameSiteVariants.map((sameSite) => ({ secure: true, sameSite })),
    ...sameSiteVariants.map((sameSite) => ({ secure: false, sameSite })),
  ];

  if (env.JWT_COOKIE_DOMAIN) {
    for (const sameSite of sameSiteVariants) {
      clearVariants.push(
        { secure: true, sameSite, domain: env.JWT_COOKIE_DOMAIN },
        { secure: false, sameSite, domain: env.JWT_COOKIE_DOMAIN },
      );
    }
  }

  for (const variant of clearVariants) {
    res.clearCookie(env.JWT_COOKIE_NAME, {
      httpOnly: true,
      sameSite: variant.sameSite,
      secure: variant.secure,
      path: "/",
      domain: variant.domain,
    });
  }
};
