import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const merchantAddress = "0x1111111111111111111111111111111111111111";
const payoutAddress = "0x2222222222222222222222222222222222222222";

function demoVault(orderId: string): string {
  return `0x${createHash("sha256").update(`arc-demo:${orderId}`).digest("hex").slice(0, 40)}`;
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { walletAddress: merchantAddress },
    update: { payoutAddress, displayName: "Northstar Supply" },
    create: {
      walletAddress: merchantAddress,
      payoutAddress,
      displayName: "Northstar Supply",
      metadataHash: `0x${"11".repeat(32)}`,
    },
  });

  await prisma.paymentIntent.upsert({
    where: { orderId: "DEMO-1042" },
    update: {},
    create: {
      slug: "demo-1042",
      orderId: "DEMO-1042",
      orderIdBytes32: `0x${Buffer.from("DEMO-1042").toString("hex").padEnd(64, "0")}`,
      expectedAmount: 125_000_000n,
      fundedAmount: 0n,
      refundAddress: merchantAddress,
      payoutAddress,
      vaultAddress: demoVault("DEMO-1042"),
      description: "Industrial sensor order #1042",
      status: "OPEN",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      merchantId: merchant.id,
    },
  });
}

main().then(
  () => prisma.$disconnect(),
  async (error: unknown) => {
    await prisma.$disconnect();
    throw error;
  },
);
