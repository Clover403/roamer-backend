import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  googleAuthCallback,
  googleAuthStart,
  login,
  logout,
  me,
  register,
  resendEmailVerification,
  verifyEmail,
} from "../controllers/auth.controller";

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncHandler(register)
);

authRouter.post(
  "/login",
  asyncHandler(login)
);

authRouter.post(
  "/email-verification/resend",
  asyncHandler(resendEmailVerification)
);

authRouter.get(
  "/email-verification/verify",
  asyncHandler(verifyEmail)
);

authRouter.get(
  "/google/start",
  asyncHandler(googleAuthStart)
);

authRouter.get(
  "/google/callback",
  asyncHandler(googleAuthCallback)
);

authRouter.get(
  "/me",
  asyncHandler(me)
);

authRouter.post("/logout", asyncHandler(logout));
