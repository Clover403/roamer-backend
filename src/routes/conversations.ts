import { Router } from "express";
import fs from "fs";
import path from "path";
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

const uploadsDir = path.resolve(process.cwd(), "uploads/conversations");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "file";
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
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
