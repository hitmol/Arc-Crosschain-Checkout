import { createServer } from "node:http";

const merchant = "0x1111111111111111111111111111111111111111";
const payout = "0x2222222222222222222222222222222222222222";
const vault = "0x3333333333333333333333333333333333333333";
const sourceHash = `0x${"a".repeat(64)}`;
const messageHash = `0x${"b".repeat(64)}`;
const mintHash = `0x${"c".repeat(64)}`;
const settlementHash = `0x${"d".repeat(64)}`;
const statuses = [
  "QUOTED",
  "APPROVING",
  "BURN_SUBMITTED",
  "SOURCE_CONFIRMED",
  "ATTESTING",
  "ARC_MINTED",
  "SETTLING",
  "SETTLED",
];
let statusIndex = 0;
let invoiceStatus = "OPEN";

function json(response, status, payload, origin) {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": origin ?? "http://127.0.0.1:3000",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type,idempotency-key",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function transaction(chain, hash) {
  const explorer =
    chain === 84_532
      ? "https://sepolia.basescan.org"
      : "https://testnet.arcscan.app";
  return { hash, url: `${explorer}/tx/${hash}` };
}

function attempt() {
  const status = statuses[statusIndex];
  if (status === "SETTLED") invoiceStatus = "SETTLED";
  return {
    id: "attempt-e2e",
    status,
    sourceChainId: 84_532,
    customerAddress: merchant,
    refundAddress: merchant,
    quoteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    registeredTransactionHash: `0x${"9".repeat(64)}`,
    sourceTransactionHash:
      statusIndex >= statuses.indexOf("BURN_SUBMITTED") ? sourceHash : null,
    messageHash:
      statusIndex >= statuses.indexOf("ATTESTING") ? messageHash : null,
    forwardTxHash:
      statusIndex >= statuses.indexOf("ARC_MINTED") ? mintHash : null,
    bridgeResult: null,
    bridgeRecoverable: false,
    errorCode: null,
    errorMessage: null,
    paymentIntent: {
      status: invoiceStatus,
      arcMintTransactionHash:
        statusIndex >= statuses.indexOf("ARC_MINTED") ? mintHash : null,
      settlementTransactionHash: status === "SETTLED" ? settlementHash : null,
    },
  };
}

function dashboard() {
  return {
    merchant: {
      name: "E2E Merchant",
      walletAddress: merchant,
      payoutAddress: payout,
      payoutExplorer: {
        address: payout,
        url: `https://testnet.arcscan.app/address/${payout}`,
      },
    },
    metrics: {
      totalInvoices: 1,
      settledVolume: invoiceStatus === "SETTLED" ? "12.50" : "0.00",
      statusCounts: { [invoiceStatus]: 1 },
    },
    sourceChainDistribution:
      statusIndex >= statuses.indexOf("BURN_SUBMITTED")
        ? [{ chainId: 84_532, name: "Base Sepolia", attempts: 1 }]
        : [],
    invoices: [
      {
        id: "invoice-e2e",
        slug: "e2e-order",
        orderId: "E2E-ORDER-1",
        amount: "12.50",
        fundedAmount: invoiceStatus === "SETTLED" ? "12.50" : "0.00",
        status: invoiceStatus,
        customerAddress: merchant,
        refundAddress: merchant,
        sourceChain: { chainId: 84_532, name: "Base Sepolia" },
        sourceTransaction:
          statusIndex >= statuses.indexOf("BURN_SUBMITTED")
            ? transaction(84_532, sourceHash)
            : null,
        cctpStatus: statuses[statusIndex],
        arcMintTransaction:
          statusIndex >= statuses.indexOf("ARC_MINTED")
            ? transaction(5_042_002, mintHash)
            : null,
        settlementTransaction:
          invoiceStatus === "SETTLED"
            ? transaction(5_042_002, settlementHash)
            : null,
        webhookDelivery:
          invoiceStatus === "SETTLED"
            ? { status: "DELIVERED", attempts: 1, lastError: null }
            : null,
        updatedAt: new Date().toISOString(),
      },
    ],
    recentAttempts: [
      {
        id: "attempt-e2e",
        invoiceSlug: "e2e-order",
        orderId: "E2E-ORDER-1",
        status: statuses[statusIndex],
        customerAddress: merchant,
        refundAddress: merchant,
        sourceChain: { chainId: 84_532, name: "Base Sepolia" },
        sourceTransaction: transaction(84_532, sourceHash),
        arcMintTransaction:
          invoiceStatus === "SETTLED" ? transaction(5_042_002, mintHash) : null,
        updatedAt: new Date().toISOString(),
      },
    ],
    pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
  };
}

function receipt() {
  const now = new Date().toISOString();
  return {
    receiptVersion: 1,
    verifiedFrom: ["Arc finalized events", "source receipt", "Circle CCTP V2"],
    merchant: {
      name: "E2E Merchant",
      walletAddress: merchant,
      payoutAddress: payout,
      payoutExplorer: {
        address: payout,
        url: `https://testnet.arcscan.app/address/${payout}`,
      },
    },
    invoice: {
      id: "invoice-e2e",
      slug: "e2e-order",
      orderId: "E2E-ORDER-1",
      vault: {
        address: vault,
        url: `https://testnet.arcscan.app/address/${vault}`,
      },
      amount: "12.50",
      amountAtomic: "12500000",
      fundedAmount: "12.50",
      status: "SETTLED",
      description: "Playwright checkout",
    },
    customer: { walletAddress: merchant, arcRefundAddress: merchant },
    source: {
      network: {
        chainId: 84_532,
        name: "Base Sepolia",
        explorerUrl: "https://sepolia.basescan.org",
      },
      totalAmount: "12.51",
      totalAmountAtomic: "12510000",
      circleProtocolFee: "0.005",
      forwardingFee: "0.005",
      gasNote: "Source-chain gas is paid separately.",
      burnTransaction: transaction(84_532, sourceHash),
    },
    cctp: {
      status: "SETTLED",
      messageHash,
      eventNonce: "6:1",
      sourceDomain: 6,
      destinationDomain: 26,
      finalityThreshold: 1000,
      attestationReceived: true,
    },
    arc: {
      network: {
        chainId: 5_042_002,
        name: "Arc Testnet",
        explorerUrl: "https://testnet.arcscan.app",
      },
      mintTransaction: transaction(5_042_002, mintHash),
      settlementTransaction: transaction(5_042_002, settlementHash),
      merchantPayout: "12.47",
      treasuryFee: "0.03",
      excessAmount: "0.00",
      refundedAmount: "0.00",
    },
    timestamps: {
      invoiceCreatedAt: now,
      attemptCreatedAt: now,
      attemptUpdatedAt: now,
      settledAt: now,
      lastUpdatedAt: now,
    },
    evidence: [],
  };
}

const server = createServer((request, response) => {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") return json(response, 204, {}, origin);
  const url = new URL(request.url, "http://127.0.0.1:4100");
  if (url.pathname === "/api/auth/session")
    return json(
      response,
      200,
      {
        authenticated: true,
        walletAddress: merchant,
      },
      origin,
    );
  if (url.pathname === "/api/dashboard")
    return json(response, 200, dashboard(), origin);
  if (url.pathname === "/api/payment-intents" && request.method === "POST")
    return json(
      response,
      201,
      {
        id: "invoice-e2e",
        slug: "e2e-order",
        paymentUrl: "http://127.0.0.1:3000/pay/e2e-order",
        vaultAddress: vault,
        mode: "demo",
      },
      origin,
    );
  if (url.pathname === "/api/payment-intents/e2e-order")
    return json(
      response,
      200,
      {
        id: "invoice-e2e",
        slug: "e2e-order",
        orderId: "E2E-ORDER-1",
        amount: "12.50",
        funded: invoiceStatus === "SETTLED" ? "12.50" : "0.00",
        description: "Playwright checkout",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        vaultAddress: vault,
        status: invoiceStatus,
        mode: "demo",
        merchant: { displayName: "E2E Merchant", payoutAddress: payout },
      },
      origin,
    );
  if (url.pathname === "/api/payment-intents/invoice-e2e/quote")
    return json(
      response,
      200,
      {
        quoteId: "quote-e2e",
        requestedAmount: "12.50",
        totalSourceAmount: "12.51",
        maxFee: "0.01",
        finalityThreshold: 1000,
        transferSpeed: "FAST",
        sourceChainId: 84_532,
        destinationChainId: 5_042_002,
        protocolFeeSubunits: "5000",
        forwardFeeSubunits: "5000",
        feeBufferSubunits: "0",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        vaultAddress: vault,
        quoteSource: "local-mock",
      },
      origin,
    );
  if (url.pathname === "/api/payment-intents/invoice-e2e/demo-attempts") {
    statusIndex = 0;
    invoiceStatus = "OPEN";
    return json(response, 201, { id: "attempt-e2e" }, origin);
  }
  if (url.pathname === "/api/payment-attempts/attempt-e2e") {
    const current = attempt();
    if (statusIndex < statuses.length - 1) statusIndex += 1;
    return json(response, 200, current, origin);
  }
  if (url.pathname === "/api/receipts/e2e-order")
    return json(response, 200, receipt(), origin);
  if (url.pathname === "/health")
    return json(response, 200, { status: "ok" }, origin);
  return json(response, 404, { error: "Mock route not found" }, origin);
});

server.listen(4_100, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
