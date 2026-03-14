import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  getAdminDashboardCharts,
  getAdminDashboardOverview,
  getAdminModerationQueue,
} from "../controllers/admin.controller";

export const adminRouter = Router();

adminRouter.get(
  "/dashboard-overview",
  asyncHandler(getAdminDashboardOverview)
);

adminRouter.get("/dashboard-charts", asyncHandler(getAdminDashboardCharts));
adminRouter.get("/moderation-queue", asyncHandler(getAdminModerationQueue));
