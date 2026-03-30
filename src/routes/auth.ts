import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  forgotPassword,
  googleAuthCallback,
  googleAuthStart,
  login,
  logout,
  me,
  register,
  resetPassword,
  resendEmailVerification,
  verifyEmail,
} from "../controllers/auth.controller";
import { authRateLimiter, googleAuthRateLimiter } from "../middlewares/rate-limit";

export const authRouter = Router();

authRouter.post(
  "/register",
  authRateLimiter,
  asyncHandler(register)
);

authRouter.post(
  "/login",
  authRateLimiter,
  asyncHandler(login)
);

authRouter.post(
  "/forgot-password",
  authRateLimiter,
  asyncHandler(forgotPassword)
);

authRouter.post(
  "/reset-password",
  authRateLimiter,
  asyncHandler(resetPassword)
);

authRouter.post(
  "/email-verification/resend",
  authRateLimiter,
  asyncHandler(resendEmailVerification)
);

authRouter.get(
  "/email-verification/verify",
  asyncHandler(verifyEmail)
);

authRouter.get(
  "/google/start",
  googleAuthRateLimiter,
  asyncHandler(googleAuthStart)
);

authRouter.get(
  "/google/callback",
  googleAuthRateLimiter,
  asyncHandler(googleAuthCallback)
);

authRouter.get(
  "/me",
  asyncHandler(me)
);

authRouter.post("/logout", asyncHandler(logout));
