import { Router } from "express";
import { asyncHandler } from "./utils";
import { requireAuth } from "../middlewares/auth";
import {
  cancelRentalByRenter,
  confirmRentalHandoverBySeller,
  confirmRentalPayment,
  confirmRentalReceived,
  createRental,
  dispatchRental,
  listRentals,
  runRentalCronNow,
  sellerDecisionRental,
  submitRentalPayment,
} from "../controllers/rentals.controller";

export const rentalsRouter = Router();

rentalsRouter.get(
  "/",
  asyncHandler(listRentals)
);

rentalsRouter.post(
  "/",
  requireAuth,
  asyncHandler(createRental)
);

rentalsRouter.patch(
  "/:id/seller-decision",
  asyncHandler(sellerDecisionRental)
);

rentalsRouter.patch(
  "/:id/handover-confirmation",
  asyncHandler(confirmRentalHandoverBySeller)
);

rentalsRouter.patch(
  "/:id/cancel",
  asyncHandler(cancelRentalByRenter)
);

rentalsRouter.patch(
  "/:id/payment-submission",
  asyncHandler(submitRentalPayment)
);

rentalsRouter.patch(
  "/:id/payment-confirmation",
  asyncHandler(confirmRentalPayment)
);

rentalsRouter.patch(
  "/:id/dispatch",
  asyncHandler(dispatchRental)
);

rentalsRouter.patch(
  "/:id/confirm-received",
  asyncHandler(confirmRentalReceived)
);

rentalsRouter.post(
  "/cron/run",
  asyncHandler(runRentalCronNow)
);
