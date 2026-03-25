import { Router } from "express";
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
  updateInvitationStatus,
} from "../controllers/groups.controller";

export const groupsRouter = Router();

groupsRouter.get(
  "/",
  asyncHandler(listGroups)
);

groupsRouter.post(
  "/",
  requireAuth,
  asyncHandler(createGroup)
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
