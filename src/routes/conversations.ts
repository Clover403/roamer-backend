import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  createConversation,
  createConversationMessage,
  listConversationMessages,
  listConversations,
} from "../controllers/conversations.controller";

export const conversationsRouter = Router();

conversationsRouter.get(
  "/",
  asyncHandler(listConversations)
);

conversationsRouter.post(
  "/",
  asyncHandler(createConversation)
);

conversationsRouter.get(
  "/:id/messages",
  asyncHandler(listConversationMessages)
);

conversationsRouter.post(
  "/:id/messages",
  asyncHandler(createConversationMessage)
);
