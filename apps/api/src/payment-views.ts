import {
  prisma,
  type PaymentStatus,
  type Prisma,
} from "@arc-checkout/database";
import {
  chainsById,
  explorerAddress,
  explorerTx,
} from "@arc-checkout/chain-config";
import { formatUsdc } from "@arc-checkout/shared";

const transactionHashPattern = /^0x[a-fA-F0-9]{64}$/;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function transactionView(chainId: number, hash?: string | null) {
  if (!hash || !transactionHashPattern.test(hash)) return null;
  return { hash, url: explorerTx(chainId, hash) };
}

function addressView(chainId: number, address?: string | null) {
  if (!address || !addressPattern.test(address)) return null;
  return { address, url: explorerAddress(chainId, address) };
}

function chainView(chainId: number) {
  const chain = chainsById.get(chainId);
  return chain
    ? {
        chainId,
        name: chain.name,
        explorerUrl: chain.explorerUrl,
      }
    : { chainId, name: `Chain ${chainId}`, explorerUrl: null };
}

export type DashboardFilters = {
  page: number;
  pageSize: number;
  status?: PaymentStatus;
  sourceChainId?: number;
  search?: string;
};

export async function getMerchantDashboard(
  merchantId: string,
  filters: DashboardFilters,
) {
  const where: Prisma.PaymentIntentWhereInput = {
    merchantId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.sourceChainId
      ? { attempts: { some: { sourceChainId: filters.sourceChainId } } }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { orderId: { contains: filters.search, mode: "insensitive" } },
            { slug: { contains: filters.search, mode: "insensitive" } },
            {
              attempts: {
                some: {
                  customerAddress: {
                    contains: filters.search.toLowerCase(),
                    mode: "insensitive",
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
  const [
    merchant,
    statusCounts,
    settledVolume,
    sourceCounts,
    total,
    invoices,
    recentAttempts,
  ] = await prisma.$transaction((transaction) =>
    Promise.all([
      transaction.merchant.findUniqueOrThrow({ where: { id: merchantId } }),
      transaction.paymentIntent.groupBy({
        by: ["status"],
        where: { merchantId },
        orderBy: { status: "asc" },
        _count: { _all: true },
      }),
      transaction.paymentIntent.aggregate({
        where: { merchantId, status: "SETTLED" },
        _sum: { fundedAmount: true },
      }),
      transaction.paymentAttempt.groupBy({
        by: ["sourceChainId"],
        where: {
          paymentIntent: { merchantId },
          sourceTransactionHash: { not: null },
        },
        orderBy: { sourceChainId: "asc" },
        _count: { _all: true },
      }),
      transaction.paymentIntent.count({ where }),
      transaction.paymentIntent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        include: {
          attempts: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { quote: true },
          },
          webhookEvents: {
            where: { deliveries: { some: {} } },
            orderBy: { sequence: "desc" },
            take: 1,
            include: {
              deliveries: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  status: true,
                  attempts: true,
                  replayCount: true,
                  lastStatusCode: true,
                  lastError: true,
                  deliveredAt: true,
                },
              },
            },
          },
        },
      }),
      transaction.paymentAttempt.findMany({
        where: { paymentIntent: { merchantId } },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          paymentIntent: {
            select: { slug: true, orderId: true, status: true },
          },
        },
      }),
    ] as const),
  );

  const counts = Object.fromEntries(
    [
      "OPEN",
      "PARTIALLY_FUNDED",
      "FUNDED",
      "SETTLING",
      "SETTLED",
      "REFUNDED",
      "CANCELLED",
      "EXPIRED",
    ].map((status) => [status, 0]),
  ) as Record<PaymentStatus, number>;
  for (const group of statusCounts) counts[group.status] = group._count._all;

  return {
    merchant: {
      id: merchant.id,
      name: merchant.displayName,
      walletAddress: merchant.walletAddress,
      payoutAddress: merchant.payoutAddress,
      payoutExplorer: addressView(5_042_002, merchant.payoutAddress),
    },
    metrics: {
      totalInvoices: Object.values(counts).reduce(
        (sum, count) => sum + count,
        0,
      ),
      statusCounts: counts,
      settledVolume: formatUsdc(settledVolume._sum.fundedAmount ?? 0n),
      settledVolumeAtomic: settledVolume._sum.fundedAmount ?? 0n,
    },
    sourceChainDistribution: sourceCounts.map((item) => ({
      ...chainView(item.sourceChainId),
      attempts: item._count._all,
    })),
    invoices: invoices.map((invoice) => {
      const attempt = invoice.attempts[0] ?? null;
      const delivery = invoice.webhookEvents[0]?.deliveries[0] ?? null;
      return {
        id: invoice.id,
        slug: invoice.slug,
        orderId: invoice.orderId,
        description: invoice.description,
        amount: formatUsdc(invoice.expectedAmount),
        fundedAmount: formatUsdc(invoice.fundedAmount),
        status: invoice.status,
        vault: addressView(invoice.createChainId, invoice.vaultAddress),
        customerAddress: attempt?.customerAddress ?? null,
        refundAddress: attempt?.refundAddress ?? invoice.refundAddress,
        sourceChain: attempt ? chainView(attempt.sourceChainId) : null,
        sourceTransaction: attempt
          ? transactionView(
              attempt.sourceChainId,
              attempt.sourceTransactionHash,
            )
          : null,
        cctpStatus: attempt?.status ?? null,
        cctpMessageHash: attempt?.messageHash ?? null,
        arcMintTransaction: transactionView(
          invoice.createChainId,
          invoice.arcMintTransactionHash,
        ),
        settlementTransaction: transactionView(
          invoice.createChainId,
          invoice.settlementTransactionHash,
        ),
        webhookDelivery: delivery,
        createdAt: invoice.createdAt,
        updatedAt: invoice.updatedAt,
        settledAt: invoice.settledAt,
      };
    }),
    recentAttempts: recentAttempts.map((attempt) => ({
      id: attempt.id,
      invoiceSlug: attempt.paymentIntent.slug,
      orderId: attempt.paymentIntent.orderId,
      invoiceStatus: attempt.paymentIntent.status,
      status: attempt.status,
      customerAddress: attempt.customerAddress,
      refundAddress: attempt.refundAddress,
      sourceChain: chainView(attempt.sourceChainId),
      sourceTransaction: transactionView(
        attempt.sourceChainId,
        attempt.sourceTransactionHash,
      ),
      arcMintTransaction: transactionView(
        attempt.destinationChainId,
        attempt.forwardTxHash,
      ),
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
    })),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    },
  };
}

export async function getVerifiedReceipt(invoiceSlug: string) {
  const invoice = await prisma.paymentIntent.findUnique({
    where: { slug: invoiceSlug },
    include: {
      merchant: true,
      attempts: {
        orderBy: { createdAt: "desc" },
        include: { quote: true },
      },
      transactions: { orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] },
    },
  });
  if (!invoice) return null;
  const attempt =
    invoice.attempts.find((candidate) => candidate.status === "SETTLED") ??
    invoice.attempts.find((candidate) => candidate.status === "ARC_MINTED") ??
    invoice.attempts[0] ??
    null;
  const quote = attempt?.quote ?? null;
  return {
    receiptVersion: 1,
    verifiedFrom: [
      ...(invoice.transactions.length > 0 ? ["Arc finalized events"] : []),
      ...(attempt?.sourceTransactionHash &&
      [
        "SOURCE_CONFIRMED",
        "ATTESTING",
        "ARC_MINTED",
        "SETTLING",
        "SETTLED",
      ].includes(attempt.status)
        ? ["source receipt"]
        : []),
      ...(attempt?.messageHash ? ["Circle CCTP V2"] : []),
    ],
    merchant: {
      name: invoice.merchant.displayName,
      walletAddress: invoice.merchant.walletAddress,
      payoutAddress: invoice.payoutAddress,
      payoutExplorer: addressView(invoice.createChainId, invoice.payoutAddress),
    },
    invoice: {
      id: invoice.id,
      slug: invoice.slug,
      orderId: invoice.orderId,
      vault: addressView(invoice.createChainId, invoice.vaultAddress),
      amount: formatUsdc(invoice.expectedAmount),
      amountAtomic: invoice.expectedAmount,
      fundedAmount: formatUsdc(invoice.fundedAmount),
      status: invoice.status,
      description: invoice.description,
    },
    customer: attempt
      ? {
          walletAddress: attempt.customerAddress,
          arcRefundAddress: attempt.refundAddress ?? invoice.refundAddress,
        }
      : null,
    source: attempt
      ? {
          network: chainView(attempt.sourceChainId),
          totalAmount: formatUsdc(
            attempt.maximumSourceAmount ?? attempt.quotedSourceAmount,
          ),
          totalAmountAtomic:
            attempt.maximumSourceAmount ?? attempt.quotedSourceAmount,
          circleProtocolFee: quote ? formatUsdc(quote.protocolFee) : null,
          forwardingFee: quote ? formatUsdc(quote.forwardFee) : null,
          gasNote:
            "Source-chain gas is paid by the customer wallet and is not included in USDC receipt totals.",
          burnTransaction: transactionView(
            attempt.sourceChainId,
            attempt.sourceTransactionHash,
          ),
        }
      : null,
    cctp: attempt
      ? {
          status: attempt.status,
          messageHash: attempt.messageHash,
          eventNonce: attempt.eventNonce,
          sourceDomain: attempt.sourceDomain,
          destinationDomain: attempt.destinationDomain,
          finalityThreshold: attempt.finalityThreshold,
          attestationReceived: Boolean(attempt.cctpAttestation),
        }
      : null,
    arc: {
      network: chainView(invoice.createChainId),
      mintTransaction: transactionView(
        invoice.createChainId,
        invoice.arcMintTransactionHash ?? attempt?.forwardTxHash,
      ),
      settlementTransaction: transactionView(
        invoice.createChainId,
        invoice.settlementTransactionHash,
      ),
      merchantPayout:
        invoice.settlementMerchantAmount !== null
          ? formatUsdc(invoice.settlementMerchantAmount)
          : null,
      treasuryFee:
        invoice.protocolFeeAmount !== null
          ? formatUsdc(invoice.protocolFeeAmount)
          : null,
      excessAmount:
        invoice.excessAmount !== null ? formatUsdc(invoice.excessAmount) : null,
      refundedAmount:
        invoice.refundedAmount !== null
          ? formatUsdc(invoice.refundedAmount)
          : null,
    },
    timestamps: {
      invoiceCreatedAt: invoice.createdAt,
      attemptCreatedAt: attempt?.createdAt ?? null,
      attemptUpdatedAt: attempt?.updatedAt ?? null,
      settledAt: invoice.settledAt,
      lastUpdatedAt: invoice.updatedAt,
    },
    evidence: invoice.transactions.map((transaction) => ({
      type: transaction.type,
      chainId: transaction.chainId,
      transaction: transactionView(
        transaction.chainId,
        transaction.transactionHash,
      ),
      logIndex: transaction.logIndex,
      blockNumber: transaction.blockNumber,
      blockHash: transaction.blockHash,
    })),
  };
}
