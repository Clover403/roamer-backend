import { Router } from "express";
import multer from "multer";
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
import {
  getAdminHeroSettings,
  updateAdminHeroSettings,
  uploadAdminHeroVideo,
} from "../controllers/hero-settings.controller";
import { getAdminVerificationUrlsByUser } from "../controllers/verifications.controller";

export const adminRouter = Router();

const heroUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
});

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
adminRouter.get("/hero-settings", asyncHandler(getAdminHeroSettings));
adminRouter.put("/hero-settings", asyncHandler(updateAdminHeroSettings));
adminRouter.post("/hero-settings/video", heroUpload.single("file"), asyncHandler(uploadAdminHeroVideo));
adminRouter.get("/users/:userId/verification-urls", asyncHandler(getAdminVerificationUrlsByUser));
