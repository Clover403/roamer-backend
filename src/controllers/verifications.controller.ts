import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

type AuthedRequest = Request & {
  authUser?: {
    id: string;
    role: "USER" | "ADMIN";
  };
};

const createSubmissionSchema = z.object({
  documents: z.array(
    z.object({
      documentType: z.enum([
        "EMIRATES_ID_FRONT",
        "EMIRATES_ID_BACK",
        "DRIVING_LICENSE",
        "PASSPORT",
        "SELFIE",
      ]),
      fileUrl: z.string().min(1),
      mimeType: z.string().optional(),
      fileSizeBytes: z.number().int().positive().optional(),
    })
  ).min(1),
});

const reviewSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    reviewerNotes: z.string().trim().min(3).max(800).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.status === "REJECTED" && !payload.reviewerNotes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reviewerNotes"],
        message: "Rejection reason is required",
      });
    }
  });

export const uploadVerificationDocument = async (req: Request & { file?: Express.Multer.File }, res: Response) => {
  if (!req.file) {
    res.status(400).json({ message: "File is required" });
    return;
  }

  const url = `/uploads/verifications/${req.file.filename}`;

  res.status(201).json({
    url,
    mimeType: req.file.mimetype,
    fileSizeBytes: req.file.size,
    originalName: req.file.originalname,
  });
};

export const getMyVerificationStatus = async (req: Request, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;

  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: authUserId },
    select: {
      id: true,
      role: true,
      verificationStatus: true,
      verificationSubmissions: {
        orderBy: {
          submittedAt: "desc",
        },
        take: 1,
        include: {
          documents: true,
        },
      },
    },
  });

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  const latestSubmission = user.verificationSubmissions[0] ?? null;

  res.status(200).json({
    userId: user.id,
    verificationStatus: user.role === "ADMIN" ? "APPROVED" : user.verificationStatus,
    latestSubmission,
  });
};

export const createVerificationSubmission = async (req: Request, res: Response) => {
  const authedReq = req as AuthedRequest;
  const authUserId = authedReq.authUser?.id;

  if (!authUserId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const actor = await prisma.user.findUnique({
    where: { id: authUserId },
    select: { role: true },
  });

  if (actor?.role === "ADMIN") {
    res.status(400).json({ message: "Admin accounts are auto-verified and do not require identity submission" });
    return;
  }

  const payload = createSubmissionSchema.parse(req.body);

  const requiredDocTypes = new Set([
    "EMIRATES_ID_FRONT",
    "EMIRATES_ID_BACK",
    "DRIVING_LICENSE",
    "PASSPORT",
  ]);

  const providedDocTypes = new Set(payload.documents.map((doc) => doc.documentType));
  const missingRequired = [...requiredDocTypes].filter((docType) => !providedDocTypes.has(docType as any));

  if (missingRequired.length > 0) {
    res.status(400).json({
      message: `Missing required documents: ${missingRequired.join(", ")}`,
    });
    return;
  }

  const existingPending = await prisma.verificationSubmission.findFirst({
    where: {
      userId: authUserId,
      status: "PENDING",
    },
    select: { id: true },
  });

  if (existingPending) {
    res.status(409).json({
      message: "You already have a pending verification submission",
    });
    return;
  }

  const submission = await prisma.verificationSubmission.create({
    data: {
      userId: authUserId,
      documents: {
        create: payload.documents,
      },
    },
    include: { documents: true },
  });

  await prisma.user.update({
    where: { id: authUserId },
    data: { verificationStatus: "PENDING" },
  });

  await prisma.userIdentityProfile.upsert({
    where: { userId: authUserId },
    update: {
      verificationStatus: "PENDING",
      verifiedAt: null,
    },
    create: {
      userId: authUserId,
      verificationStatus: "PENDING",
      verifiedAt: null,
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
        type: "VERIFICATION",
        priority: "HIGH",
        title: "New identity verification submission",
        body: "A user submitted verification documents and is waiting for admin review.",
        link: "/admin?tab=users",
      })),
    });
  }

  await prisma.notification.create({
    data: {
      userId: authUserId,
      type: "VERIFICATION",
      title: "Verification submitted",
      body: "Your documents were submitted and are waiting for admin review.",
      link: "/verification",
    },
  });

  res.status(201).json(submission);
};

export const listVerificationSubmissions = async (_req: Request, res: Response) => {
  const items = await prisma.verificationSubmission.findMany({
    select: {
      id: true,
      userId: true,
      status: true,
      reviewerNotes: true,
      submittedAt: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
        },
      },
      documents: {
        select: {
          id: true,
          documentType: true,
          fileUrl: true,
          mimeType: true,
          fileSizeBytes: true,
          createdAt: true,
        },
      },
    },
    orderBy: { submittedAt: "desc" },
  });

  res.status(200).json(items);
};

export const reviewVerificationSubmission = async (req: Request<{ id: string }>, res: Response) => {
  const authedReq = req as AuthedRequest;
  const reviewerId = authedReq.authUser?.id;

  if (!reviewerId) {
    res.status(401).json({ message: "Unauthenticated" });
    return;
  }

  const submissionId = String(req.params.id);
  const payload = reviewSchema.parse(req.body);

  const submission = await prisma.verificationSubmission.update({
    where: { id: submissionId },
    data: {
      status: payload.status,
      reviewerNotes: payload.reviewerNotes,
      reviewedAt: new Date(),
    },
    include: { user: true },
  });

  await prisma.user.update({
    where: { id: submission.userId },
    data: {
      verificationStatus: payload.status === "APPROVED" ? "APPROVED" : "REJECTED",
    },
  });

  await prisma.userIdentityProfile.upsert({
    where: { userId: submission.userId },
    update: {
      verificationStatus: payload.status === "APPROVED" ? "APPROVED" : "REJECTED",
      verifiedAt: payload.status === "APPROVED" ? new Date() : null,
    },
    create: {
      userId: submission.userId,
      verificationStatus: payload.status === "APPROVED" ? "APPROVED" : "REJECTED",
      verifiedAt: payload.status === "APPROVED" ? new Date() : null,
    },
  });

  await prisma.notification.create({
    data: {
      userId: submission.userId,
      type: "VERIFICATION",
      priority: payload.status === "APPROVED" ? "NORMAL" : "HIGH",
      title: payload.status === "APPROVED" ? "Verification approved" : "Verification rejected",
      body:
        payload.status === "APPROVED"
          ? "Your identity verification was approved. You can now create listings, groups, and rentals."
          : `Your identity verification was rejected.${payload.reviewerNotes ? ` Reason: ${payload.reviewerNotes}` : ""}`,
      link: "/verification",
    },
  });

  res.status(200).json(submission);
};
