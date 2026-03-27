import { Router } from "express";
import { asyncHandler } from "./utils";
import { requireAuth } from "../middlewares/auth";
import {
  getAdminUserDetail,
  getSellerCommissionInvoices,
  getSellerDashboardCharts,
  getSellerDashboardOverview,
  submitSellerFeeInvoiceTransfer,
  getUserById,
  listUsers,
  updateUserById,
  upsertUserIdentity,
} from "../controllers/users.controller";

export const usersRouter = Router();

usersRouter.get(
  "/",
  asyncHandler(listUsers)
);

usersRouter.get("/:id/dashboard/seller", asyncHandler(getSellerDashboardOverview));
usersRouter.get("/:id/dashboard/seller/charts", asyncHandler(getSellerDashboardCharts));
usersRouter.get("/:id/dashboard/seller/commission-invoices", requireAuth, asyncHandler(getSellerCommissionInvoices));
usersRouter.patch(":id/dashboard/seller/fee-invoices/:paymentId/confirm-transfer", requireAuth, asyncHandler(submitSellerFeeInvoiceTransfer));
usersRouter.get("/:id/admin-detail", asyncHandler(getAdminUserDetail));

usersRouter.get(
  "/:id",
  asyncHandler(getUserById)
);

usersRouter.patch(
  "/:id",
  asyncHandler(updateUserById)
);

usersRouter.put(
  "/:id/identity",
  asyncHandler(upsertUserIdentity)
);
