import { Router } from "express";
import { asyncHandler } from "./utils";
import { requireAdmin } from "../middlewares/auth";
import {
  confirmAdminFeeInvoice,
  getAdminCommissionTracking,
  getAdminDashboardCharts,
  getAdminDashboardOverview,
  getAdminFeeSettings,
  getAdminModerationQueue,
  getAdminRevenueOverview,
  updateAdminFeeSettings,
} from "../controllers/admin.controller";

export const adminRouter = Router();

adminRouter.use(asyncHandler(requireAdmin));

adminRouter.get(
  "/dashboard-overview",
  asyncHandler(getAdminDashboardOverview)
);

adminRouter.get("/dashboard-charts", asyncHandler(getAdminDashboardCharts));
adminRouter.get("/moderation-queue", asyncHandler(getAdminModerationQueue));
adminRouter.get("/revenue-overview", asyncHandler(getAdminRevenueOverview));
adminRouter.get("/fee-settings", asyncHandler(getAdminFeeSettings));
adminRouter.patch("/fee-settings", asyncHandler(updateAdminFeeSettings));
adminRouter.get("/commission-tracking", asyncHandler(getAdminCommissionTracking));
adminRouter.patch("/fee-invoices/:id/confirm", asyncHandler(confirmAdminFeeInvoice));
