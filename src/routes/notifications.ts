import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  createNotification,
  listNotificationsByUser,
  markAllNotificationsAsRead,
  markNotificationAsRead,
} from "../controllers/notifications.controller";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/:userId",
  asyncHandler(listNotificationsByUser)
);

notificationsRouter.post(
  "/",
  asyncHandler(createNotification)
);

notificationsRouter.patch(
  "/:id/read",
  asyncHandler(markNotificationAsRead)
);

notificationsRouter.patch(
  "/user/:userId/read-all",
  asyncHandler(markAllNotificationsAsRead)
);
