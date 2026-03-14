import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  addListingMedia,
  addMaintenanceLog,
  createListing,
  deleteListingById,
  getListingById,
  listListings,
  updateListingById,
} from "../controllers/listings.controller";

export const listingsRouter = Router();

listingsRouter.get(
  "/",
  asyncHandler(listListings)
);

listingsRouter.post(
  "/",
  asyncHandler(createListing)
);

listingsRouter.get(
  "/:id",
  asyncHandler(getListingById)
);

listingsRouter.patch(
  "/:id",
  asyncHandler(updateListingById)
);

listingsRouter.delete(
  "/:id",
  asyncHandler(deleteListingById)
);

listingsRouter.post(
  "/:id/media",
  asyncHandler(addListingMedia)
);

listingsRouter.post(
  "/:id/maintenance-logs",
  asyncHandler(addMaintenanceLog)
);
