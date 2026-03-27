import { prisma } from "./prisma";

export type VerificationGateResult = {
  allowed: boolean;
  status: "UNVERIFIED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  rejectionReason: string | null;
};

export const getUserVerificationGate = async (userId: string): Promise<VerificationGateResult> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      verificationStatus: true,
      verificationSubmissions: {
        where: {
          status: "REJECTED",
          reviewerNotes: {
            not: null,
          },
        },
        orderBy: {
          reviewedAt: "desc",
        },
        take: 1,
        select: {
          reviewerNotes: true,
        },
      },
    },
  });

  if (!user) {
    return {
      allowed: false,
      status: "UNVERIFIED",
      rejectionReason: null,
    };
  }

  if (user.role === "ADMIN") {
    return {
      allowed: true,
      status: "APPROVED",
      rejectionReason: null,
    };
  }

  return {
    allowed: user.verificationStatus === "APPROVED",
    status: user.verificationStatus,
    rejectionReason: user.verificationSubmissions[0]?.reviewerNotes ?? null,
  };
};
