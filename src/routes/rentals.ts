import { Router } from "express";
import { asyncHandler } from "./utils";
import { createRental, listRentals, updateRentalStatus } from "../controllers/rentals.controller";

export const rentalsRouter = Router();

rentalsRouter.get(
  "/",
  asyncHandler(listRentals)
);

rentalsRouter.post(
  "/",
  asyncHandler(createRental)
);

rentalsRouter.patch(
  "/:id/status",
  asyncHandler(updateRentalStatus)
);
