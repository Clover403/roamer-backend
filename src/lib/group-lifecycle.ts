import type { PrismaClient } from "@prisma/client";

const GROUP_DELETE_DELAY_MS = 24 * 60 * 60 * 1000;

export const purgeCancelledGroups = async (prisma: PrismaClient) => {
  const threshold = new Date(Date.now() - GROUP_DELETE_DELAY_MS);

  const expiredGroups = await prisma.group.findMany({
    where: {
      status: "CANCELLED",
      updatedAt: { lte: threshold },
    },
    include: {
      members: {
        select: { userId: true },
      },
      listing: {
        select: { id: true, title: true, make: true, model: true },
      },
    },
  });

  if (expiredGroups.length === 0) {
    return { purged: 0 };
  }

  const notifications = expiredGroups.flatMap((group) =>
    group.members.map((member) => ({
      userId: member.userId,
      type: "GROUP" as const,
      priority: "NORMAL" as const,
      title: "Group closed",
      body: `Group \"${group.name}\" was closed because the listing was sold to another buyer group.`,
      link: `/car/${group.listingId}`,
    }))
  );

  await prisma.$transaction([
    ...(notifications.length > 0 ? [prisma.notification.createMany({ data: notifications })] : []),
    prisma.group.deleteMany({
      where: {
        id: { in: expiredGroups.map((group) => group.id) },
      },
    }),
  ]);

  return { purged: expiredGroups.length };
};

export const markListingSoldAndCancelCompetingGroups = async (
  prisma: PrismaClient,
  params: { listingId: string; winningGroupId: string; acceptedOfferId?: string }
) => {
  const { listingId, winningGroupId } = params;

  const groups = await prisma.group.findMany({
    where: { listingId },
    include: {
      members: {
        select: { userId: true },
      },
    },
  });

  const winningGroup = groups.find((group) => group.id === winningGroupId);
  if (!winningGroup) {
    return;
  }

  const losingGroups = groups.filter((group) => group.id !== winningGroupId);
  const losingGroupIds = losingGroups.map((group) => group.id);

  const notifications = [
    ...winningGroup.members.map((member) => ({
      userId: member.userId,
      type: "OFFER" as const,
      priority: "HIGH" as const,
      title: "Offer accepted by seller",
      body: "Congratulations. Your group offer was accepted and the listing is now sold.",
      link: `/group/${listingId}/workspace?role=member&groupId=${winningGroupId}`,
    })),
    ...losingGroups.flatMap((group) =>
      group.members.map((member) => ({
        userId: member.userId,
        type: "GROUP" as const,
        priority: "HIGH" as const,
        title: "Listing sold out",
        body: `Another group offer was accepted by the seller. Group \"${group.name}\" will be removed in 24 hours.`,
        link: `/car/${listingId}`,
      }))
    ),
  ];

  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listingId },
      data: {
        status: "SOLD",
        availabilityStatus: "UNAVAILABLE",
        soldAt: new Date(),
        groupsActive: 0,
      },
    }),
    prisma.group.update({
      where: { id: winningGroupId },
      data: { status: "COMPLETED" },
    }),
    ...(losingGroupIds.length > 0
      ? [
          prisma.group.updateMany({
            where: {
              id: { in: losingGroupIds },
              status: { in: ["FORMING", "ACTIVE"] },
            },
            data: { status: "CANCELLED" },
          }),
          prisma.jointOffer.updateMany({
            where: {
              groupId: { in: losingGroupIds },
              status: { in: ["DRAFT", "PENDING_MEMBER_APPROVAL", "PENDING_SELLER_REVIEW"] },
            },
            data: { status: "REJECTED" },
          }),
        ]
      : []),
    ...(notifications.length > 0 ? [prisma.notification.createMany({ data: notifications })] : []),
  ]);
};
