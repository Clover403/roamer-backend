import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  createPayment,
  listPayments,
  updatePaymentStatus,
} from "../controllers/payments.controller";

export const paymentsRouter = Router();

paymentsRouter.get(
  "/",
  asyncHandler(listPayments)
);

paymentsRouter.post(
  "/",
  asyncHandler(createPayment)
);

paymentsRouter.patch(
  "/:id/status",
  asyncHandler(updatePaymentStatus)
);
