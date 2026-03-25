import { Router } from "express";
import fs from "fs";
import path from "path";
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

export const verificationRouter = Router();

const uploadsDir = path.resolve(process.cwd(), "uploads/verifications");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "doc";
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
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
  upload.single("file"),
  asyncHandler(uploadVerificationDocument)
);

verificationRouter.post(
  "/submissions",
  requireAuth,
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
