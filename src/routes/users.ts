import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "./utils";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import {
  getAdminUserDetail,
  getSellerCommissionInvoices,
  getSellerDashboardCharts,
  getSellerDashboardOverview,
  submitSellerFeeInvoiceTransfer,
  uploadUserAvatar,
  getUserById,
  listUsers,
  updateUserById,
  upsertUserIdentity,
} from "../controllers/users.controller";

export const usersRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

usersRouter.get("/", requireAdmin, asyncHandler(listUsers));

usersRouter.get("/:id/dashboard/seller", asyncHandler(getSellerDashboardOverview));
usersRouter.get("/:id/dashboard/seller/charts", asyncHandler(getSellerDashboardCharts));
usersRouter.get("/:id/dashboard/seller/commission-invoices", requireAuth, asyncHandler(getSellerCommissionInvoices));
usersRouter.patch("/:id/dashboard/seller/fee-invoices/:paymentId/confirm-transfer", requireAuth, asyncHandler(submitSellerFeeInvoiceTransfer));
usersRouter.post("/:id/avatar/upload", requireAuth, upload.single("file"), asyncHandler(uploadUserAvatar));
usersRouter.get("/:id/admin-detail", requireAdmin, asyncHandler(getAdminUserDetail));

usersRouter.get("/:id", asyncHandler(getUserById));

usersRouter.patch("/:id", asyncHandler(updateUserById));

usersRouter.put("/:id/identity", asyncHandler(upsertUserIdentity));
