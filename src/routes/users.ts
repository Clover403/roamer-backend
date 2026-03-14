import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  getSellerDashboardCharts,
  getSellerDashboardOverview,
  getUserById,
  listUsers,
  updateUserById,
  upsertUserIdentity,
} from "../controllers/users.controller";

export const usersRouter = Router();

usersRouter.get(
  "/",
  asyncHandler(listUsers)
);

usersRouter.get("/:id/dashboard/seller", asyncHandler(getSellerDashboardOverview));
usersRouter.get("/:id/dashboard/seller/charts", asyncHandler(getSellerDashboardCharts));

usersRouter.get(
  "/:id",
  asyncHandler(getUserById)
);

usersRouter.patch(
  "/:id",
  asyncHandler(updateUserById)
);

usersRouter.put(
  "/:id/identity",
  asyncHandler(upsertUserIdentity)
);
