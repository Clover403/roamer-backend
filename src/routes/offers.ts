import { Router } from "express";
import { asyncHandler } from "./utils";
import { requireAuth } from "../middlewares/auth";
import {
  createOffer,
  listOffers,
  updateOffer,
  updateOfferParticipantDecision,
} from "../controllers/offers.controller";

export const offersRouter = Router();

offersRouter.get(
  "/",
  requireAuth,
  asyncHandler(listOffers)
);

offersRouter.post(
  "/",
  requireAuth,
  asyncHandler(createOffer)
);

offersRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(updateOffer)
);

offersRouter.patch(
  "/:id/participants/:userId",
  requireAuth,
  asyncHandler(updateOfferParticipantDecision)
);
