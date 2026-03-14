import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  createVerificationSubmission,
  listVerificationSubmissions,
  reviewVerificationSubmission,
} from "../controllers/verifications.controller";

export const verificationRouter = Router();

verificationRouter.post(
  "/submissions",
  asyncHandler(createVerificationSubmission)
);

verificationRouter.get(
  "/submissions",
  asyncHandler(listVerificationSubmissions)
);

verificationRouter.patch(
  "/submissions/:id/review",
  asyncHandler(reviewVerificationSubmission)
);
