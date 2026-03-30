import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "./utils";
import {
  createVerificationSubmission,
  getMyVerificationStatus,
  listVerificationSubmissions,
  reviewVerificationSubmission,
  uploadVerificationDocument,
} from "../controllers/verifications.controller";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { verificationSubmissionRateLimiter, verificationUploadRateLimiter } from "../middlewares/rate-limit";

export const verificationRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

verificationRouter.get(
  "/me",
  requireAuth,
  asyncHandler(getMyVerificationStatus)
);

verificationRouter.post(
  "/documents/upload",
  requireAuth,
  verificationUploadRateLimiter,
  upload.single("file"),
  asyncHandler(uploadVerificationDocument)
);

verificationRouter.post(
  "/submissions",
  requireAuth,
  verificationSubmissionRateLimiter,
  asyncHandler(createVerificationSubmission)
);

verificationRouter.get(
  "/submissions",
  requireAdmin,
  asyncHandler(listVerificationSubmissions)
);

verificationRouter.patch(
  "/submissions/:id/review",
  requireAdmin,
  asyncHandler(reviewVerificationSubmission)
);
