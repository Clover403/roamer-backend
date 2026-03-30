import { Router } from "express";
import { asyncHandler } from "./utils";
import { getPublicHeroSettings } from "../controllers/hero-settings.controller";

export const heroSettingsRouter = Router();

heroSettingsRouter.get("/", asyncHandler(getPublicHeroSettings));
