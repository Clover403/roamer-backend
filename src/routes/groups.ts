import { Router } from "express";
import { asyncHandler } from "./utils";
import {
  addGroupMember,
  createGroup,
  createGroupInvitation,
  getGroupById,
  listGroups,
  updateInvitationStatus,
} from "../controllers/groups.controller";

export const groupsRouter = Router();

groupsRouter.get(
  "/",
  asyncHandler(listGroups)
);

groupsRouter.post(
  "/",
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

groupsRouter.post(
  "/:id/invitations",
  asyncHandler(createGroupInvitation)
);

groupsRouter.patch(
  "/invitations/:invitationId",
  asyncHandler(updateInvitationStatus)
);
