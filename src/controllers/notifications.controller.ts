import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

export const listNotificationsByUser = async (req: Request<{ userId: string }>, res: Response) => {
  const userId = String(req.params.userId);
  const items = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(items);
};

export const createNotification = async (req: Request, res: Response) => {
  const payload = z
    .object({
      userId: z.string().min(1),
      type: z.enum(["LISTING", "GROUP", "OFFER", "SYSTEM", "MESSAGE", "RENTAL", "VERIFICATION", "PROMOTION"]),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
      title: z.string().min(1),
      body: z.string().min(1),
      link: z.string().optional(),
    })
    .parse(req.body);

  const item = await prisma.notification.create({ data: payload });
  res.status(201).json(item);
};

export const markNotificationAsRead = async (req: Request<{ id: string }>, res: Response) => {
  const notificationId = String(req.params.id);
  const item = await prisma.notification.update({
    where: { id: notificationId },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  res.status(200).json(item);
};

export const markAllNotificationsAsRead = async (req: Request<{ userId: string }>, res: Response) => {
  const userId = String(req.params.userId);
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
  });

  res.status(200).json(result);
};
