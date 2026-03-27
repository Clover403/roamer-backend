import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { asyncHandler } from "./utils";
import { requireAuth } from "../middlewares/auth";
import {
  addGroupMember,
  confirmGroupMemberTerms,
  createGroup,
  createGroupInvitation,
  deleteGroup,
  getGroupById,
  listGroups,
  removeGroupMember,
  updateGroupProfileImage,
  updateInvitationStatus,
  uploadGroupProfileImage,
} from "../controllers/groups.controller";

export const groupsRouter = Router();

const uploadsDir = path.resolve(process.cwd(), "uploads/groups");
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base =
        path
          .basename(file.originalname, ext)
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .slice(0, 32) || "group";
      cb(null, `${Date.now()}-${base}${ext}`);
    },
  }),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

groupsRouter.get(
  "/",
  asyncHandler(listGroups)
);

groupsRouter.post(
  "/",
  requireAuth,
  asyncHandler(createGroup)
);

groupsRouter.post(
  "/upload-profile-image",
  requireAuth,
  upload.single("file"),
  asyncHandler(uploadGroupProfileImage)
);

groupsRouter.get(
  "/:id",
  asyncHandler(getGroupById)
);

groupsRouter.post(
  "/:id/members",
  asyncHandler(addGroupMember)
);

groupsRouter.patch(
  "/:id/members/:userId/confirm",
  asyncHandler(confirmGroupMemberTerms)
);

groupsRouter.delete(
  "/:id/members/:userId",
  asyncHandler(removeGroupMember)
);

groupsRouter.delete(
  "/:id",
  asyncHandler(deleteGroup)
);

groupsRouter.post(
  "/:id/invitations",
  asyncHandler(createGroupInvitation)
);

groupsRouter.patch(
  "/invitations/:invitationId",
  asyncHandler(updateInvitationStatus)
);

groupsRouter.patch(
  "/:id/profile-image",
  requireAuth,
  asyncHandler(updateGroupProfileImage)
);
