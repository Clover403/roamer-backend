import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { asyncHandler } from "./utils";
import { requireAuth } from "../middlewares/auth";
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

const uploadsDir = path.resolve(process.cwd(), "uploads/avatars");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "avatar";
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

usersRouter.get(
  "/",
  asyncHandler(listUsers)
);

usersRouter.get("/:id/dashboard/seller", asyncHandler(getSellerDashboardOverview));
usersRouter.get("/:id/dashboard/seller/charts", asyncHandler(getSellerDashboardCharts));
usersRouter.get("/:id/dashboard/seller/commission-invoices", requireAuth, asyncHandler(getSellerCommissionInvoices));
usersRouter.patch("/:id/dashboard/seller/fee-invoices/:paymentId/confirm-transfer", requireAuth, asyncHandler(submitSellerFeeInvoiceTransfer));
usersRouter.post("/:id/avatar/upload", requireAuth, upload.single("file"), asyncHandler(uploadUserAvatar));
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
