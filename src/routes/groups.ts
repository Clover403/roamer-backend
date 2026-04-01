import { Router } from "express";
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
});

groupsRouter.get(
  "/",
  requireAuth,
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
  requireAuth,
  asyncHandler(getGroupById)
);

groupsRouter.post(
  "/:id/members",
  requireAuth,
  asyncHandler(addGroupMember)
);

groupsRouter.patch(
  "/:id/members/:userId/confirm",
  requireAuth,
  asyncHandler(confirmGroupMemberTerms)
);

groupsRouter.delete(
  "/:id/members/:userId",
  requireAuth,
  asyncHandler(removeGroupMember)
);

groupsRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(deleteGroup)
);

groupsRouter.post(
  "/:id/invitations",
  requireAuth,
  asyncHandler(createGroupInvitation)
);

groupsRouter.patch(
  "/invitations/:invitationId",
  requireAuth,
  asyncHandler(updateInvitationStatus)
);

groupsRouter.patch(
  "/:id/profile-image",
  requireAuth,
  asyncHandler(updateGroupProfileImage)
);
