import { prisma } from "@arc-checkout/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimSettlement } from "./settlement-lock.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const suffix = crypto.randomUUID();
let merchantId = "";
let paymentIntentId = "";

describe.skipIf(!databaseAvailable)(
  "settlement locking with PostgreSQL",
  () => {
    beforeAll(async () => {
      const merchant = await prisma.merchant.create({
        data: {
          walletAddress: `0x${suffix.replaceAll("-", "").padEnd(40, "0").slice(0, 40)}`,
          payoutAddress: "0x2222222222222222222222222222222222222222",
        },
      });
      merchantId = merchant.id;
      const intent = await prisma.paymentIntent.create({
        data: {
          slug: `settlement-lock-${suffix}`,
          orderId: `LOCK-${suffix}`,
          orderIdBytes32: `0x${"12".repeat(32)}`,
          expectedAmount: 1_000_000n,
          fundedAmount: 1_000_000n,
          payoutAddress: merchant.payoutAddress,
          vaultAddress: `0x${suffix.replaceAll("-", "").padEnd(40, "1").slice(0, 40)}`,
          status: "FUNDED",
          expiresAt: new Date(Date.now() + 60_000),
          merchantId: merchant.id,
        },
      });
      paymentIntentId = intent.id;
    });

    afterAll(async () => {
      if (merchantId)
        await prisma.merchant.delete({ where: { id: merchantId } });
    });

    it("atomically allows only one worker to claim settlement", async () => {
      const staleBefore = new Date(Date.now() - 120_000);
      const claims = await Promise.all([
        claimSettlement({
          paymentIntentId,
          lockToken: `worker-a-${suffix}`,
          staleBefore,
        }),
        claimSettlement({
          paymentIntentId,
          lockToken: `worker-b-${suffix}`,
          staleBefore,
        }),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(
        await prisma.settlementSubmission.count({
          where: { paymentIntentId, status: "CLAIMED" },
        }),
      ).toBe(1);
    });

    it("recovers a stale pre-broadcast claim without duplicating a pending tx", async () => {
      const current = await prisma.settlementSubmission.findFirstOrThrow({
        where: { paymentIntentId, status: "CLAIMED" },
      });
      const staleAt = new Date(Date.now() - 10 * 60_000);
      await prisma.$transaction([
        prisma.settlementSubmission.update({
          where: { id: current.id },
          data: { updatedAt: staleAt },
        }),
        prisma.paymentIntent.update({
          where: { id: paymentIntentId },
          data: { settlementLockedAt: staleAt },
        }),
      ]);
      const replacement = await claimSettlement({
        paymentIntentId,
        lockToken: `worker-recovery-${suffix}`,
        staleBefore: new Date(Date.now() - 120_000),
      });
      expect(replacement).not.toBeNull();
      expect(
        await prisma.settlementSubmission.findUniqueOrThrow({
          where: { id: current.id },
          select: { status: true },
        }),
      ).toEqual({ status: "FAILED" });

      await prisma.settlementSubmission.update({
        where: { id: replacement!.submissionId },
        data: {
          status: "SUBMITTED",
          transactionHash: `0x${"ab".repeat(32)}`,
        },
      });
      await prisma.paymentIntent.update({
        where: { id: paymentIntentId },
        data: { settlementLockedAt: staleAt },
      });
      expect(
        await claimSettlement({
          paymentIntentId,
          lockToken: `worker-must-not-duplicate-${suffix}`,
          staleBefore: new Date(),
        }),
      ).toBeNull();
    });
  },
);
