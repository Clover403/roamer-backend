import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "./utils";
import {
  addListingMedia,
  adminReviewListingById,
  adminReviewListingVerificationById,
  addMaintenanceLog,
  createListing,
  deleteListingMedia,
  deleteListingById,
  getListingFeeSettings,
  getListingById,
  listListings,
  trackListingView,
  uploadListingMedia,
  updateListingById,
} from "../controllers/listings.controller";
import { requireAdmin, requireAuth } from "../middlewares/auth";

export const listingsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

listingsRouter.get(
  "/",
  asyncHandler(listListings)
);

listingsRouter.get(
  "/fee-settings",
  asyncHandler(getListingFeeSettings)
);

listingsRouter.post(
  "/",
  requireAuth,
  asyncHandler(createListing)
);

listingsRouter.get(
  "/:id",
  asyncHandler(getListingById)
);

listingsRouter.post(
  "/:id/view",
  asyncHandler(trackListingView)
);

listingsRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(updateListingById)
);

listingsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(deleteListingById)
);

listingsRouter.post(
  "/:id/media",
  requireAuth,
  asyncHandler(addListingMedia)
);

listingsRouter.delete(
  "/:id/media",
  requireAuth,
  asyncHandler(deleteListingMedia)
);

listingsRouter.post(
  "/:id/media/upload",
  requireAuth,
  upload.single("file"),
  asyncHandler(uploadListingMedia)
);

listingsRouter.post(
  "/:id/maintenance-logs",
  requireAuth,
  asyncHandler(addMaintenanceLog)
);

listingsRouter.patch(
  "/:id/admin-review",
  requireAdmin,
  asyncHandler(adminReviewListingById)
);

listingsRouter.patch(
  "/:id/admin-verification-review",
  requireAdmin,
  asyncHandler(adminReviewListingVerificationById)
);
