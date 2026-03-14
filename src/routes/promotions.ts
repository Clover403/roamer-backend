import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  createPromotion,
  listPromotions,
  updatePromotionStatus,
} from "../controllers/promotions.controller";

export const promotionsRouter = Router();

promotionsRouter.get(
  "/",
  asyncHandler(listPromotions)
);

promotionsRouter.post(
  "/",
  asyncHandler(createPromotion)
);

promotionsRouter.patch(
  "/:id/status",
  asyncHandler(updatePromotionStatus)
);
