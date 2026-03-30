import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "./utils";
import {
  adminUpdateBannerAdPricing,
  adminActivateBannerAd,
  adminRejectBannerAd,
  createBannerAd,
  getBannerAdPricing,
  getBannerAdSlots,
  listActiveBannerAds,
  listBannerAdsForAdmin,
  listMyBannerAds,
  uploadBannerAdImage,
} from "../controllers/ads.controller";
import { requireAdmin, requireAuth } from "../middlewares/auth";

export const adsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

adsRouter.get("/slots", asyncHandler(getBannerAdSlots));
adsRouter.get("/pricing", asyncHandler(getBannerAdPricing));
adsRouter.get("/active", asyncHandler(listActiveBannerAds));
adsRouter.get("/my-ads", requireAuth, asyncHandler(listMyBannerAds));

adsRouter.post("/upload", requireAuth, upload.single("file"), asyncHandler(uploadBannerAdImage));
adsRouter.post("/", requireAuth, asyncHandler(createBannerAd));

adsRouter.get("/", requireAdmin, asyncHandler(listBannerAdsForAdmin));
adsRouter.patch("/pricing", requireAdmin, asyncHandler(adminUpdateBannerAdPricing));
adsRouter.patch("/:id/admin-activate", requireAdmin, asyncHandler(adminActivateBannerAd));
adsRouter.patch("/:id/admin-reject", requireAdmin, asyncHandler(adminRejectBannerAd));
