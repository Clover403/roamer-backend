import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "./utils";
import {
  createConversation,
  createConversationMessage,
  listConversationMessages,
  listConversations,
  markConversationRead,
  uploadConversationMessageMedia,
} from "../controllers/conversations.controller";

export const conversationsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

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

conversationsRouter.post(
  "/:id/messages/upload",
  upload.single("file"),
  asyncHandler(uploadConversationMessageMedia)
);

conversationsRouter.patch(
  "/:id/read",
  asyncHandler(markConversationRead)
);
