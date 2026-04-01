import jwt, { type SignOptions } from "jsonwebtoken";
import type { Response } from "express";
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
  const clearVariants: Array<{
    secure: boolean;
    domain?: string;
  }> = [
    { secure: true },
    { secure: false },
  ];

  if (env.JWT_COOKIE_DOMAIN) {
    clearVariants.push(
      { secure: true, domain: env.JWT_COOKIE_DOMAIN },
      { secure: false, domain: env.JWT_COOKIE_DOMAIN },
    );
  }

  for (const variant of clearVariants) {
    res.clearCookie(env.JWT_COOKIE_NAME, {
      httpOnly: true,
      sameSite: env.JWT_COOKIE_SAME_SITE,
      secure: variant.secure,
      path: "/",
      domain: variant.domain,
    });
  }
};
