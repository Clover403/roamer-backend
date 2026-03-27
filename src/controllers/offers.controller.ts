import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { markListingSoldAndCancelCompetingGroups, purgeCancelledGroups } from "../lib/group-lifecycle";

const OFFER_VALIDITY_DAYS = 14;

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const listOffers = async (req: Request, res: Response) => {
  await purgeCancelledGroups(prisma);

  const { groupId, status } = req.query;

  const where: Record<string, unknown> = {};
  if (groupId) where.groupId = String(groupId);
  if (status) where.status = String(status);

  await prisma.jointOffer.updateMany({
    where: {
      status: {
        in: ["DRAFT", "PENDING_MEMBER_APPROVAL", "PENDING_SELLER_REVIEW"],
      },
      expiryDate: {
        lt: new Date(),
      },
    },
    data: {
      status: "EXPIRED",
    },
  });

  const items = await prisma.jointOffer.findMany({
    where,
    include: { participants: true, group: true, listing: true },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json(items);
};

export const createOffer = async (req: Request, res: Response) => {
  const payload = z
    .object({
      groupId: z.string().min(1),
      listingId: z.string().min(1),
      createdById: z.string().min(1),
      offerPriceAed: z.number().positive(),
      downPaymentAed: z.number().optional(),
      expiryDate: z.string().datetime().optional(),
      termsMessage: z.string().optional(),
      participants: z.array(
        z.object({
          userId: z.string().min(1),
          ownershipShare: z.number().min(0).max(100),
          contributionAed: z.number().nonnegative(),
        })
      ),
    })
    .parse(req.body);

  const group = await prisma.group.findUnique({
    where: { id: payload.groupId },
    select: {
      id: true,
      listingId: true,
      status: true,
      listing: {
        select: {
          sellerId: true,
          listingType: true,
          status: true,
        },
      },
    },
  });

  if (!group) {
    res.status(404).json({ message: "Group not found" });
    return;
  }

  if (group.status === "CANCELLED" || group.status === "COMPLETED") {
    res.status(400).json({ message: "This group is no longer active" });
    return;
  }

  if (group.listing.status === "SOLD") {
    res.status(400).json({ message: "Listing is already sold" });
    return;
  }

  if (group.listing.listingType !== "SELL") {
    res.status(400).json({ message: "Joint offers are only available for sell listings" });
    return;
  }

  if (group.listing.sellerId === payload.createdById) {
    res.status(403).json({ message: "You cannot create a purchase offer for your own listing" });
    return;
  }

  if (payload.participants.some((participant) => participant.userId === group.listing.sellerId)) {
    res.status(403).json({ message: "Listing owner cannot be a participant in purchase offer" });
    return;
  }

  const now = new Date();
  const computedExpiryDate = addDays(now, OFFER_VALIDITY_DAYS);

  const offer = await prisma.jointOffer.create({
    data: {
      groupId: payload.groupId,
      listingId: payload.listingId,
      createdById: payload.createdById,
      offerPriceAed: payload.offerPriceAed,
      downPaymentAed: payload.downPaymentAed,
      expiryDate: computedExpiryDate,
      termsMessage: payload.termsMessage,
      participants: {
        create: payload.participants,
      },
    },
    include: { participants: true },
  });

  res.status(201).json(offer);
};

export const updateOffer = async (req: Request<{ id: string }>, res: Response) => {
  const offerId = String(req.params.id);
  const payload = z
    .object({
      status: z
        .enum(["DRAFT", "PENDING_MEMBER_APPROVAL", "PENDING_SELLER_REVIEW", "ACCEPTED", "REJECTED", "EXPIRED"])
        .optional(),
      submittedToSellerAt: z.string().datetime().optional(),
      offerPriceAed: z.number().positive().optional(),
      downPaymentAed: z.number().nonnegative().optional(),
      termsMessage: z.string().optional(),
      actorUserId: z.string().min(1).optional(),
      participants: z
        .array(
          z.object({
            userId: z.string().min(1),
            ownershipShare: z.number().min(0).max(100),
            contributionAed: z.number().nonnegative(),
          })
        )
        .optional(),
    })
    .parse(req.body);

  const existingOffer = await prisma.jointOffer.findUnique({
    where: { id: offerId },
    select: {
      expiryDate: true,
      status: true,
      listingId: true,
      groupId: true,
      listing: {
        select: {
          sellerId: true,
        },
      },
    },
  });

  if (!existingOffer) {
    res.status(404).json({ message: "Offer not found" });
    return;
  }

  if (
    existingOffer.expiryDate &&
    existingOffer.expiryDate.getTime() < Date.now() &&
    existingOffer.status !== "EXPIRED"
  ) {
    await prisma.jointOffer.update({
      where: { id: offerId },
      data: { status: "EXPIRED" },
    });
    res.status(400).json({ message: "Offer has expired" });
    return;
  }

  const isEditingOfferLetter =
    payload.offerPriceAed !== undefined ||
    payload.downPaymentAed !== undefined ||
    payload.termsMessage !== undefined ||
    payload.participants !== undefined;

  if (isEditingOfferLetter && !["DRAFT", "PENDING_MEMBER_APPROVAL"].includes(existingOffer.status)) {
    res.status(400).json({ message: "Offer can only be edited before it is sent to seller" });
    return;
  }

  if (payload.participants) {
    const hasInvalidShare = payload.participants.some((participant) => participant.ownershipShare <= 0);
    const totalShare = payload.participants.reduce((sum, participant) => sum + participant.ownershipShare, 0);
    if (hasInvalidShare || totalShare !== 100) {
      res.status(400).json({ message: "Participants ownership share must total 100 and each value must be greater than 0" });
      return;
    }
  }

  const isSellerDecision = payload.status === "ACCEPTED" || payload.status === "REJECTED";
  if (isSellerDecision) {
    if (!payload.actorUserId) {
      res.status(400).json({ message: "actorUserId is required for seller decision" });
      return;
    }

    if (payload.actorUserId !== existingOffer.listing.sellerId) {
      res.status(403).json({ message: "Only listing seller can approve or reject offers" });
      return;
    }

    if (existingOffer.status !== "PENDING_SELLER_REVIEW") {
      res.status(400).json({ message: "Offer is not awaiting seller review" });
      return;
    }
  }

  const offer = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (payload.participants) {
      await tx.offerParticipant.deleteMany({ where: { offerId } });
      await tx.offerParticipant.createMany({
        data: payload.participants.map((participant) => ({
          offerId,
          userId: participant.userId,
          ownershipShare: participant.ownershipShare,
          contributionAed: participant.contributionAed,
          decision: "PENDING",
          decidedAt: null,
        })),
      });
    }

    const shouldResetApproval = Boolean(payload.participants || payload.offerPriceAed !== undefined || payload.downPaymentAed !== undefined || payload.termsMessage !== undefined);

    return tx.jointOffer.update({
      where: { id: offerId },
      data: {
        status: shouldResetApproval ? "PENDING_MEMBER_APPROVAL" : payload.status,
        submittedToSellerAt: shouldResetApproval
          ? undefined
          : payload.submittedToSellerAt
            ? new Date(payload.submittedToSellerAt)
            : undefined,
        offerPriceAed: payload.offerPriceAed,
        downPaymentAed: payload.downPaymentAed,
        termsMessage: payload.termsMessage,
      },
    });
  });

  if (payload.status === "ACCEPTED" && existingOffer.status !== "ACCEPTED") {
    await markListingSoldAndCancelCompetingGroups(prisma, {
      listingId: existingOffer.listingId,
      winningGroupId: existingOffer.groupId,
      acceptedOfferId: offer.id,
    });

    const acceptedParticipants = await prisma.offerParticipant.findMany({
      where: { offerId: offer.id },
      select: { userId: true },
    });

    if (acceptedParticipants.length > 0) {
      await prisma.garageAsset.createMany({
        data: acceptedParticipants.map((participant: { userId: string }) => ({
          userId: participant.userId,
          listingId: existingOffer.listingId,
          assetType: "OWNED" as const,
          currentValue: null,
          notes: "Auto-added from accepted joint offer",
        })),
        skipDuplicates: true,
      });
    }

    const existingContract = await prisma.contract.findFirst({
      where: { offerId: offer.id },
      select: { id: true },
    });

    if (!existingContract) {
      const contract = await prisma.contract.create({
        data: {
          contractType: "PURCHASE",
          status: "ACTIVE",
          listingId: existingOffer.listingId,
          groupId: existingOffer.groupId,
          offerId: offer.id,
          title: "Joint Purchase Contract",
          startsAt: new Date(),
        },
      });

      const signatureUserIds = [
        existingOffer.listing.sellerId,
        ...acceptedParticipants.map((participant: { userId: string }) => participant.userId),
      ];

      const uniqueSignatureUserIds = [...new Set(signatureUserIds)];
      if (uniqueSignatureUserIds.length > 0) {
        await prisma.contractSignature.createMany({
          data: uniqueSignatureUserIds.map((userId: string) => ({
            contractId: contract.id,
            userId,
            status: "PENDING" as const,
          })),
          skipDuplicates: true,
        });
      }

      await prisma.notification.create({
        data: {
          userId: existingOffer.listing.sellerId,
          type: "SYSTEM",
          priority: "HIGH",
          title: "Sales contract generated",
          body: "Offer approved. Contract has been generated and is ready for seller review.",
          link: "/seller-activity",
        },
      });
    }

    const acceptedOfferWithListing = await prisma.jointOffer.findUnique({
      where: { id: offer.id },
      select: {
        id: true,
        offerPriceAed: true,
        listing: {
          select: {
            id: true,
            make: true,
            model: true,
            year: true,
            sellerId: true,
            paymentModel: true,
            commissionRatePct: true,
          },
        },
      },
    });

    if (acceptedOfferWithListing?.listing.paymentModel === "commission" || acceptedOfferWithListing?.listing.paymentModel === "hybrid") {
      const saleAmountAed = Number(acceptedOfferWithListing.offerPriceAed ?? 0);
      const commissionRatePct = Number(acceptedOfferWithListing.listing.commissionRatePct ?? 0);
      const estimatedCommissionAed = Number(((saleAmountAed * commissionRatePct) / 100).toFixed(2));
      const listingTitle = [
        acceptedOfferWithListing.listing.make,
        acceptedOfferWithListing.listing.model,
        acceptedOfferWithListing.listing.year ? String(acceptedOfferWithListing.listing.year) : null,
      ]
        .filter(Boolean)
        .join(" ") || "your listing";

      const existingCommissionPayment = await prisma.payment.findFirst({
        where: {
          offerId: acceptedOfferWithListing.id,
          purpose: "COMMISSION",
        },
        orderBy: { createdAt: "desc" },
      });

      if (!existingCommissionPayment) {
        await prisma.payment.create({
          data: {
            payerId: acceptedOfferWithListing.listing.sellerId,
            purpose: "COMMISSION",
            status: "PENDING",
            amountAed: estimatedCommissionAed,
            currency: "AED",
            provider: "MANUAL_ADMIN_REVIEW",
            providerPaymentRef: `OFFER:${acceptedOfferWithListing.id}:COMMISSION`,
            offerId: acceptedOfferWithListing.id,
          },
        });
      }

      await prisma.notification.create({
        data: {
          userId: acceptedOfferWithListing.listing.sellerId,
          type: "SYSTEM",
          priority: "HIGH",
          title: "Commission invoice generated",
          body: `An invoice was generated for ${listingTitle}. Estimated commission due: AED ${estimatedCommissionAed.toFixed(2)}.`,
          link: "/seller-dashboard",
        },
      });

      const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true },
      });

      if (admins.length > 0) {
        await prisma.notification.createMany({
          data: admins.map((admin: { id: string }) => ({
            userId: admin.id,
            type: "SYSTEM",
            priority: "HIGH",
            title: "New commission invoice requires tracking",
            body: `Accepted offer created a commission invoice for ${listingTitle} (AED ${estimatedCommissionAed.toFixed(2)}).`,
            link: "/admin?tab=fee-settings",
          })),
        });
      }
    }

    await prisma.analyticsEvent.create({
      data: {
        eventType: "OFFER_ACCEPTED",
        actorUserId: payload.actorUserId,
        listingId: existingOffer.listingId,
        metadata: {
          activityType: "BUYING_COMPLETED",
          offerId: offer.id,
          groupId: existingOffer.groupId,
        },
      },
    });
  }

  if (payload.status === "REJECTED" && existingOffer.status !== "REJECTED") {
    const groupMembers = await prisma.groupMember.findMany({
      where: { groupId: existingOffer.groupId },
      select: { userId: true },
    });

    if (groupMembers.length > 0) {
      await prisma.notification.createMany({
        data: groupMembers.map((member: { userId: string }) => ({
          userId: member.userId,
          type: "OFFER" as const,
          priority: "HIGH" as const,
          title: "Offer rejected by seller",
          body: "Your group offer was rejected. Please discuss with your group and submit a revised offer.",
          link: `/group/${existingOffer.listingId}/workspace?role=member&groupId=${existingOffer.groupId}`,
        })),
      });
    }
  }

  res.status(200).json(offer);
};

export const updateOfferParticipantDecision = async (
  req: Request<{ id: string; userId: string }>,
  res: Response
) => {
  const offerId = String(req.params.id);
  const userId = String(req.params.userId);
  const payload = z
    .object({
      decision: z.enum(["PENDING", "APPROVED", "REJECTED"]),
    })
    .parse(req.body);

  const existingOffer = await prisma.jointOffer.findUnique({
    where: { id: offerId },
    select: { expiryDate: true, status: true },
  });

  if (!existingOffer) {
    res.status(404).json({ message: "Offer not found" });
    return;
  }

  if (
    existingOffer.expiryDate &&
    existingOffer.expiryDate.getTime() < Date.now() &&
    existingOffer.status !== "EXPIRED"
  ) {
    await prisma.jointOffer.update({
      where: { id: offerId },
      data: { status: "EXPIRED" },
    });
    res.status(400).json({ message: "Offer has expired" });
    return;
  }

  const participant = await prisma.offerParticipant.update({
    where: {
      offerId_userId: {
        offerId,
        userId,
      },
    },
    data: {
      decision: payload.decision,
      decidedAt: payload.decision === "PENDING" ? null : new Date(),
    },
  });

  res.status(200).json(participant);
};
