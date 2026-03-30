import { Router } from "express";
import fs from "fs";
import path from "path";
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

const uploadsDir = path.resolve(process.cwd(), "uploads/promotions");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "banner";
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
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
