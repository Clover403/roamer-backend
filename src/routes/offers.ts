import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  createOffer,
  listOffers,
  updateOffer,
  updateOfferParticipantDecision,
} from "../controllers/offers.controller";

export const offersRouter = Router();

offersRouter.get(
  "/",
  asyncHandler(listOffers)
);

offersRouter.post(
  "/",
  asyncHandler(createOffer)
);

offersRouter.patch(
  "/:id",
  asyncHandler(updateOffer)
);

offersRouter.patch(
  "/:id/participants/:userId",
  asyncHandler(updateOfferParticipantDecision)
);
