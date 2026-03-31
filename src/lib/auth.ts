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
  res.cookie(env.JWT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: env.JWT_COOKIE_SAME_SITE,
    secure: env.NODE_ENV === "production",
    maxAge: env.JWT_COOKIE_MAX_AGE_MS,
    path: "/",
    domain: env.JWT_COOKIE_DOMAIN,
  });
};

export const clearAuthCookie = (res: Response) => {
  res.clearCookie(env.JWT_COOKIE_NAME, {
    httpOnly: true,
    sameSite: env.JWT_COOKIE_SAME_SITE,
    secure: env.NODE_ENV === "production",
    path: "/",
    domain: env.JWT_COOKIE_DOMAIN,
  });
};
