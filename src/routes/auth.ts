import { Router } from "express";
import { asyncHandler } from "./utils";
import { login, logout, me, register } from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncHandler(register)
);

authRouter.post(
  "/login",
  asyncHandler(login)
);

authRouter.get(
  "/me",
  asyncHandler(me)
);

authRouter.post("/logout", asyncHandler(logout));
