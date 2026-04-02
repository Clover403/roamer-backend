import type { NextFunction, Request, Response } from "express";
import { getAuthTokenFromRequest, verifyAuthToken } from "../lib/auth";
import { prisma } from "../lib/prisma";

type AuthedRequest = Request & {
  authUser?: {
    id: string;
    role: "USER" | "ADMIN";
  };
};

export const requireAuth = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  const token = getAuthTokenFromRequest(req);

  if (!token) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  try {
    const payload = verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true },
    });

    if (!user) {
      res.status(401).json({ message: "Unauthenticated" });
      return;
    }

    req.authUser = { id: user.id, role: user.role };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired session" });
  }
};

export const requireAdmin = async (req: AuthedRequest, res: Response, next: NextFunction) => {
  await requireAuth(req, res, () => {
    if (req.authUser?.role !== "ADMIN") {
      res.status(403).json({ message: "Admin access required" });
      return;
    }

    next();
  });
};
