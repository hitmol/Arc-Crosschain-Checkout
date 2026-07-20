import { prisma } from "@arc-checkout/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMerchantDashboard, getVerifiedReceipt } from "./payment-views.js";

const databaseAvailable =
  process.env.CI === "true" ||
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const describeWithDatabase = databaseAvailable ? describe : describe.skip;
const merchantAddress = "0x0000000000000000000000000000000000000d0d";
const vaultAddress = "0x0000000000000000000000000000000000000e0e";
const sourceHash = `0x${"a".repeat(64)}`;
const mintHash = `0x${"b".repeat(64)}`;
const settlementHash = `0x${"c".repeat(64)}`;
const blockHash = `0x${"d".repeat(64)}`;
let merchantId = "";

function bytes32(value: number): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

describeWithDatabase("merchant dashboard and verified receipts", () => {
  beforeAll(async () => {
    await prisma.chainTransaction.deleteMany({
      where: { transactionHash: settlementHash },
    });
    await prisma.merchant.deleteMany({
      where: { walletAddress: merchantAddress },
    });
    const merchant = await prisma.merchant.create({
      data: {
        walletAddress: merchantAddress,
        payoutAddress: merchantAddress,
        displayName: "Verified Merchant",
      },
    });
    merchantId = merchant.id;
    const settled = await prisma.paymentIntent.create({
      data: {
        slug: "views-settled",
        orderId: "VIEW-SETTLED",
        orderIdBytes32: bytes32(1),
        expectedAmount: 2_000_000n,
        fundedAmount: 2_000_000n,
        payoutAddress: merchantAddress,
        vaultAddress,
        status: "SETTLED",
        arcMintTransactionHash: mintHash,
        settlementTransactionHash: settlementHash,
        settlementMerchantAmount: 1_980_000n,
        protocolFeeAmount: 20_000n,
        excessAmount: 10_000n,
        settledAt: new Date("2026-07-20T10:00:00.000Z"),
        expiresAt: new Date("2026-07-21T10:00:00.000Z"),
        merchantId,
      },
    });
    const quote = await prisma.paymentQuote.create({
      data: {
        sourceChainId: 84_532,
        requestedDestinationAmount: 2_000_000n,
        protocolFee: 1_000n,
        forwardFee: 2_000n,
        feeBuffer: 500n,
        maxFee: 3_500n,
        maximumSourceAmount: 2_003_500n,
        finalityThreshold: 1_000,
        transferSpeed: "FAST",
        expiresAt: new Date("2026-07-20T09:30:00.000Z"),
        paymentIntentId: settled.id,
      },
    });
    await prisma.paymentAttempt.create({
      data: {
        attemptIdentifier: bytes32(99),
        sourceChainId: 84_532,
        customerAddress: "0x0000000000000000000000000000000000000f0f",
        refundAddress: "0x0000000000000000000000000000000000000f0f",
        quotedSourceAmount: 2_003_500n,
        maximumSourceAmount: 2_003_500n,
        sourceTransactionHash: sourceHash,
        messageHash: bytes32(100),
        eventNonce: "6:100",
        forwardTxHash: mintHash,
        status: "SETTLED",
        paymentIntentId: settled.id,
        quoteId: quote.id,
      },
    });
    await prisma.chainTransaction.create({
      data: {
        chainId: 5_042_002,
        transactionHash: settlementHash,
        logIndex: 1,
        blockNumber: 1_000n,
        blockHash,
        contractAddress: vaultAddress,
        type: "PaymentSettled",
        payload: { invoiceAmount: "2000000" },
        merchantId,
        paymentIntentId: settled.id,
      },
    });
    await prisma.paymentIntent.createMany({
      data: [
        {
          slug: "views-open",
          orderId: "VIEW-OPEN",
          orderIdBytes32: bytes32(2),
          expectedAmount: 1_000_000n,
          payoutAddress: merchantAddress,
          expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          merchantId,
        },
        {
          slug: "views-refunded",
          orderId: "VIEW-REFUNDED",
          orderIdBytes32: bytes32(3),
          expectedAmount: 500_000n,
          payoutAddress: merchantAddress,
          status: "REFUNDED",
          refundedAmount: 500_000n,
          expiresAt: new Date("2026-07-19T00:00:00.000Z"),
          merchantId,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.chainTransaction.deleteMany({
      where: { transactionHash: settlementHash },
    });
    await prisma.merchant.deleteMany({
      where: { walletAddress: merchantAddress },
    });
  });

  it("returns merchant-scoped metrics, distribution, filters and pagination", async () => {
    const dashboard = await getMerchantDashboard(merchantId, {
      page: 1,
      pageSize: 10,
    });
    expect(dashboard.merchant.name).toBe("Verified Merchant");
    expect(dashboard.metrics).toMatchObject({
      totalInvoices: 3,
      settledVolume: "2.00",
      statusCounts: { OPEN: 1, SETTLED: 1, REFUNDED: 1 },
    });
    expect(dashboard.sourceChainDistribution).toEqual([
      expect.objectContaining({ chainId: 84_532, attempts: 1 }),
    ]);
    expect(dashboard.pagination).toMatchObject({ total: 3, totalPages: 1 });

    const filtered = await getMerchantDashboard(merchantId, {
      page: 1,
      pageSize: 1,
      status: "SETTLED",
      search: "VIEW-SETTLED",
      sourceChainId: 84_532,
    });
    expect(filtered.invoices).toHaveLength(1);
    expect(filtered.invoices[0]).toMatchObject({
      orderId: "VIEW-SETTLED",
      customerAddress: "0x0000000000000000000000000000000000000f0f",
      cctpStatus: "SETTLED",
    });
  });

  it("builds a receipt only from persisted verified payment evidence", async () => {
    const receipt = await getVerifiedReceipt("views-settled");
    expect(receipt).toMatchObject({
      merchant: { name: "Verified Merchant", payoutAddress: merchantAddress },
      invoice: {
        orderId: "VIEW-SETTLED",
        amount: "2.00",
        status: "SETTLED",
      },
      customer: {
        walletAddress: "0x0000000000000000000000000000000000000f0f",
        arcRefundAddress: "0x0000000000000000000000000000000000000f0f",
      },
      source: {
        totalAmount: "2.0035",
        circleProtocolFee: "0.001",
        forwardingFee: "0.002",
      },
      cctp: { eventNonce: "6:100", attestationReceived: false },
      arc: {
        merchantPayout: "1.98",
        treasuryFee: "0.02",
        excessAmount: "0.01",
      },
    });
    expect(receipt?.evidence).toHaveLength(1);
    expect(await getVerifiedReceipt("does-not-exist")).toBeNull();
  });
});
