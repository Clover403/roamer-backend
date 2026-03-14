import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";

const createSubmissionSchema = z.object({
  userId: z.string().min(1),
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
  ),
});

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reviewerNotes: z.string().optional(),
});

export const createVerificationSubmission = async (req: Request, res: Response) => {
  const payload = createSubmissionSchema.parse(req.body);

  const submission = await prisma.verificationSubmission.create({
    data: {
      userId: payload.userId,
      documents: {
        create: payload.documents,
      },
    },
    include: { documents: true },
  });

  await prisma.user.update({
    where: { id: payload.userId },
    data: { verificationStatus: "PENDING" },
  });

  res.status(201).json(submission);
};

export const listVerificationSubmissions = async (_req: Request, res: Response) => {
  const items = await prisma.verificationSubmission.findMany({
    include: {
      user: true,
      documents: true,
    },
    orderBy: { submittedAt: "desc" },
  });

  res.status(200).json(items);
};

export const reviewVerificationSubmission = async (req: Request<{ id: string }>, res: Response) => {
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

  res.status(200).json(submission);
};
