import { Router } from "express";
import {
	createMyGarageAsset,
	deactivateMyGarageAsset,
	listMyGarageAssets,
	reactivateMyGarageAsset,
	updateGarageLatestValue,
	updateMyGarageAsset,
} from "../controllers/garage.controller";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "./utils";

export const garageRouter = Router();

garageRouter.get("/my-assets", requireAuth, asyncHandler(listMyGarageAssets));
garageRouter.post("/my-assets", requireAuth, asyncHandler(createMyGarageAsset));
garageRouter.patch("/my-assets/:listingId", requireAuth, asyncHandler(updateMyGarageAsset));
garageRouter.patch("/my-assets/:listingId/deactivate", requireAuth, asyncHandler(deactivateMyGarageAsset));
garageRouter.patch("/my-assets/:listingId/reactivate", requireAuth, asyncHandler(reactivateMyGarageAsset));
garageRouter.patch("/latest-value", requireAuth, asyncHandler(updateGarageLatestValue));
