import { prisma } from "@arc-checkout/database";
import type { Hex } from "viem";

export async function claimSettlement(input: {
  paymentIntentId: string;
  lockToken: string;
  staleBefore: Date;
}): Promise<{ submissionId: string; lockToken: string } | null> {
  return prisma.$transaction(async (transaction) => {
    const pending = await transaction.settlementSubmission.findFirst({
      where: {
        paymentIntentId: input.paymentIntentId,
        status: { in: ["PREPARED", "SUBMITTED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (pending) return null;

    const staleClaim = await transaction.settlementSubmission.findFirst({
      where: {
        paymentIntentId: input.paymentIntentId,
        status: "CLAIMED",
        updatedAt: { lt: input.staleBefore },
      },
      orderBy: { createdAt: "desc" },
    });
    if (staleClaim) {
      await transaction.settlementSubmission.update({
        where: { id: staleClaim.id },
        data: {
          status: "FAILED",
          errorMessage: "Stale settlement claim recovered before submission",
        },
      });
    }

    const claimed = await transaction.paymentIntent.updateMany({
      where: {
        id: input.paymentIntentId,
        OR: [
          { status: "FUNDED", settlementLockId: null },
          {
            status: "SETTLING",
            settlementLockedAt: { lt: input.staleBefore },
          },
        ],
      },
      data: {
        status: "SETTLING",
        settlementLockId: input.lockToken,
        settlementLockedAt: new Date(),
      },
    });
    if (claimed.count !== 1) return null;
    const submission = await transaction.settlementSubmission.create({
      data: {
        paymentIntentId: input.paymentIntentId,
        lockToken: input.lockToken,
        status: "CLAIMED",
      },
    });
    return { submissionId: submission.id, lockToken: input.lockToken };
  });
}

export async function storePreparedSettlement(input: {
  paymentIntentId: string;
  submissionId: string;
  lockToken: string;
  transactionHash: Hex;
  rawTransaction: Hex;
}): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const locked = await transaction.paymentIntent.count({
      where: {
        id: input.paymentIntentId,
        status: "SETTLING",
        settlementLockId: input.lockToken,
      },
    });
    if (locked !== 1)
      throw new Error("Settlement lock was lost before signing");
    await transaction.settlementSubmission.update({
      where: { id: input.submissionId },
      data: {
        status: "PREPARED",
        transactionHash: input.transactionHash.toLowerCase(),
        rawTransaction: input.rawTransaction,
      },
    });
    await transaction.paymentIntent.update({
      where: { id: input.paymentIntentId },
      data: { settlementTransactionHash: input.transactionHash.toLowerCase() },
    });
  });
}

export async function markSettlementSubmitted(
  submissionId: string,
): Promise<void> {
  await prisma.settlementSubmission.update({
    where: { id: submissionId },
    data: { status: "SUBMITTED", submittedAt: new Date(), errorMessage: null },
  });
}

export async function markSettlementConfirmed(input: {
  paymentIntentId: string;
  submissionId: string;
  transactionHash: Hex;
}): Promise<void> {
  await prisma.$transaction([
    prisma.settlementSubmission.update({
      where: { id: input.submissionId },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        errorMessage: null,
      },
    }),
    prisma.paymentIntent.update({
      where: { id: input.paymentIntentId },
      data: {
        status: "SETTLING",
        settlementTransactionHash: input.transactionHash.toLowerCase(),
        settlementLockId: null,
        settlementLockedAt: null,
      },
    }),
  ]);
}

export async function markSettlementReverted(input: {
  paymentIntentId: string;
  submissionId: string;
  errorMessage: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.settlementSubmission.update({
      where: { id: input.submissionId },
      data: {
        status: "REVERTED",
        errorMessage: input.errorMessage.slice(0, 500),
      },
    }),
    prisma.paymentIntent.update({
      where: { id: input.paymentIntentId },
      data: {
        status: "FUNDED",
        settlementTransactionHash: null,
        settlementLockId: null,
        settlementLockedAt: null,
      },
    }),
  ]);
}

export async function failSettlementClaim(input: {
  paymentIntentId: string;
  submissionId: string;
  lockToken: string;
  errorMessage: string;
}): Promise<void> {
  await prisma.$transaction([
    prisma.settlementSubmission.update({
      where: { id: input.submissionId },
      data: {
        status: "FAILED",
        errorMessage: input.errorMessage.slice(0, 500),
      },
    }),
    prisma.paymentIntent.updateMany({
      where: {
        id: input.paymentIntentId,
        settlementLockId: input.lockToken,
      },
      data: {
        status: "FUNDED",
        settlementLockId: null,
        settlementLockedAt: null,
      },
    }),
  ]);
}
