import type { Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { clearAuthCookie, setAuthCookie, signAuthToken, verifyAuthToken } from "../lib/auth";
import { env } from "../config/env";

const toAuthUser = <T extends {
  id: string;
  email: string;
  fullName: string;
  role: "USER" | "ADMIN";
  verificationStatus: "UNVERIFIED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
}>(user: T, rejectionReason?: string | null) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  role: user.role,
  verificationStatus: user.verificationStatus,
  verificationRejectionReason: rejectionReason ?? null,
});

const registerSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  phone: z.string().optional(),
  password: z.string().min(6),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const register = async (req: Request, res: Response) => {
  const rawPayload = registerSchema.parse(req.body);
  const payload = {
    ...rawPayload,
    email: rawPayload.email.trim().toLowerCase(),
    fullName: rawPayload.fullName.trim(),
    phone: rawPayload.phone?.trim(),
  };

  const existing = await prisma.user.findUnique({ where: { email: payload.email } });

  if (existing) {
    res.status(409).json({ message: "Email is already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(payload.password, 12);

  const user = await prisma.user.create({
    data: {
      email: payload.email,
      fullName: payload.fullName,
      phone: payload.phone,
      passwordHash,
    },
  });

  const token = signAuthToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  setAuthCookie(res, token);

  res.status(201).json({
    message: "Registration successful",
    user: toAuthUser(user),
  });
};

export const login = async (req: Request, res: Response) => {
  const rawPayload = loginSchema.parse(req.body);
  const payload = {
    ...rawPayload,
    email: rawPayload.email.trim().toLowerCase(),
  };

  const user = await prisma.user.findUnique({ where: { email: payload.email } });

  if (!user || !user.passwordHash) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const isValid = await bcrypt.compare(payload.password, user.passwordHash);

  if (!isValid) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const token = signAuthToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  setAuthCookie(res, token);

  res.status(200).json({
    message: "Login successful",
    user: toAuthUser(user),
  });
};

export const me = async (req: Request, res: Response) => {
  const token = req.cookies?.[env.JWT_COOKIE_NAME] as string | undefined;

  if (!token) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  let payload: { sub: string };
  try {
    payload = verifyAuthToken(token);
  } catch {
    clearAuthCookie(res);
    res.status(401).json({ message: "Invalid or expired session" });
    return;
  }

  const userId = payload.sub;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      identityProfile: true,
      verificationSubmissions: {
        orderBy: {
          submittedAt: "desc",
        },
        take: 1,
        select: {
          status: true,
          reviewerNotes: true,
        },
      },
    },
  });

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const rejectionReason =
    user.verificationStatus === "REJECTED"
      ? user.verificationSubmissions[0]?.reviewerNotes ?? null
      : null;

  res.status(200).json({ user: toAuthUser(user, rejectionReason) });
};

export const logout = async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.status(200).json({ message: "Logged out" });
};
