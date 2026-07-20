import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import {
  enqueuePaymentWebhook,
  lifecycleWebhookEventId,
  prisma,
  type WebhookEndpoint,
} from "@arc-checkout/database";
import { fetchCctpMessages, selectCctpMessage } from "@arc-checkout/cctp";
import {
  chainsById,
  chainsByKey,
  viemChains,
} from "@arc-checkout/chain-config";
import pino from "pino";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { z } from "zod";
import { indexArcEvents } from "./arc-indexer.js";
import {
  CctpReconciliationError,
  validateSourceTransaction,
  validatedArcMintAmount,
} from "./cctp-reconciliation.js";
import {
  claimSettlement,
  failSettlementClaim,
  markSettlementConfirmed,
  markSettlementReverted,
  markSettlementSubmitted,
  storePreparedSettlement,
} from "./settlement-lock.js";
import { processWebhookQueue } from "./webhook-delivery.js";

const env = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    ARC_RPC_URL: z.string().url().default(chainsByKey.arcTestnet.defaultRpcUrl),
    BASE_SEPOLIA_RPC_URL: z
      .string()
      .url()
      .default(chainsByKey.baseSepolia.defaultRpcUrl),
    ETHEREUM_SEPOLIA_RPC_URL: z
      .string()
      .url()
      .default(chainsByKey.ethereumSepolia.defaultRpcUrl),
    CIRCLE_API_BASE_URL: z
      .string()
      .url()
      .default("https://iris-api-sandbox.circle.com"),
    SETTLER_PRIVATE_KEY: z
      .string()
      .regex(/^0x[a-fA-F0-9]{64}$/)
      .optional(),
    ARC_MERCHANT_REGISTRY_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    ARC_CHECKOUT_FACTORY_ADDRESS: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
    ARC_DEPLOYMENT_BLOCK: z.coerce.bigint().nonnegative().optional(),
    ARC_INDEXER_PAGE_SIZE: z.coerce.bigint().positive().default(1_000n),
    WEBHOOK_ENCRYPTION_KEY: z.string().optional(),
    DEMO_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(4001),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
    LOG_LEVEL: z.string().default("info"),
  })
  .parse(process.env);

if (env.NODE_ENV === "production" && env.DEMO_MODE) {
  throw new Error("DEMO_MODE cannot be enabled when NODE_ENV=production");
}
if (!env.DEMO_MODE && !env.WEBHOOK_ENCRYPTION_KEY) {
  throw new Error("WEBHOOK_ENCRYPTION_KEY is required outside demo mode");
}

const logger = pino({
  level: env.LOG_LEVEL,
  redact: ["privateKey", "encryptedSecret", "secret"],
});
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(env.ARC_RPC_URL),
});
const baseSepoliaClient = createPublicClient({
  chain: viemChains.baseSepolia,
  transport: http(env.BASE_SEPOLIA_RPC_URL),
});
const ethereumSepoliaClient = createPublicClient({
  chain: viemChains.ethereumSepolia,
  transport: http(env.ETHEREUM_SEPOLIA_RPC_URL),
});
const vaultAbi = parseAbi([
  "function currentBalance() view returns (uint256)",
  "function paymentState() view returns (uint8)",
  "function settle()",
  "event PaymentSettled(bytes32 indexed orderId,address indexed caller,uint256 invoiceAmount,uint256 merchantAmount,uint256 protocolFee,uint256 refundedExcess)",
]);

const account = env.SETTLER_PRIVATE_KEY
  ? privateKeyToAccount(env.SETTLER_PRIVATE_KEY as Hex)
  : null;
const walletClient = account
  ? createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(env.ARC_RPC_URL),
    })
  : null;

function decryptSecret(value: string): string {
  const key = env.WEBHOOK_ENCRYPTION_KEY
    ? Buffer.from(env.WEBHOOK_ENCRYPTION_KEY, "base64")
    : createHash("sha256").update("arc-checkout-local-demo-only").digest();
  if (key.length !== 32) throw new Error("Invalid webhook encryption key");
  const [iv, tag, encrypted] = value
    .split(".")
    .map((part) => Buffer.from(part ?? "", "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([
    decipher.update(encrypted!),
    decipher.final(),
  ]).toString("utf8");
}

async function reconcileCctpAttempts() {
  const attempts = await prisma.paymentAttempt.findMany({
    where: {
      sourceTransactionHash: { not: null },
      status: {
        in: ["BURN_SUBMITTED", "SOURCE_CONFIRMED", "ATTESTING", "RECOVERABLE"],
      },
    },
    include: { paymentIntent: true },
    take: 50,
  });
  for (const attempt of attempts) {
    try {
      const source = chainsById.get(attempt.sourceChainId);
      if (
        !source ||
        !attempt.sourceTransactionHash ||
        !attempt.vaultAddress ||
        !attempt.maximumSourceAmount ||
        !attempt.destinationAmount ||
        attempt.maxFee === null ||
        attempt.finalityThreshold === null
      ) {
        throw new CctpReconciliationError(
          "Payment attempt is missing immutable CCTP expectations",
        );
      }
      const sourceClient =
        attempt.sourceChainId === viemChains.baseSepolia.id
          ? baseSepoliaClient
          : attempt.sourceChainId === viemChains.ethereumSepolia.id
            ? ethereumSepoliaClient
            : null;
      if (!sourceClient)
        throw new CctpReconciliationError("Unsupported source chain");
      const sourceHash = attempt.sourceTransactionHash as Hex;
      const [sourceReceipt, sourceTransaction, sourceHead] = await Promise.all([
        sourceClient.getTransactionReceipt({ hash: sourceHash }),
        sourceClient.getTransaction({ hash: sourceHash }),
        sourceClient.getBlockNumber(),
      ]);
      const sourceConfirmed = validateSourceTransaction({
        receipt: sourceReceipt,
        transaction: sourceTransaction,
        expectedHash: sourceHash,
        expectedPayer: attempt.customerAddress as Address,
        headBlock: sourceHead,
        requiredConfirmations: source.confirmations,
      });
      if (!sourceConfirmed) continue;
      if (
        attempt.status === "BURN_SUBMITTED" ||
        attempt.status === "RECOVERABLE"
      ) {
        await prisma.$transaction(async (transaction) => {
          await transaction.paymentAttempt.update({
            where: { id: attempt.id },
            data: { status: "SOURCE_CONFIRMED" },
          });
          await enqueuePaymentWebhook(transaction, {
            eventId: lifecycleWebhookEventId({
              eventType: "payment.source_confirmed",
              identity: `${attempt.sourceChainId}:${sourceHash}`,
            }),
            eventType: "payment.source_confirmed",
            intent: attempt.paymentIntent,
            data: {
              attemptId: attempt.id,
              sourceChainId: attempt.sourceChainId,
              sourceTransactionHash: sourceHash,
            },
          });
        });
      }

      const response = await fetchCctpMessages(
        attempt.sourceChainId,
        sourceHash,
        env.CIRCLE_API_BASE_URL,
        AbortSignal.timeout(8000),
      );
      if (!response || response.messages.length === 0) continue;
      const message = selectCctpMessage(response.messages, {
        sourceChainId: attempt.sourceChainId,
        sourceTransactionHash: sourceHash,
        destinationChainId: 5_042_002,
        mintRecipient: attempt.vaultAddress as Address,
        sourceSender: attempt.customerAddress as Address,
        burnAmount: attempt.maximumSourceAmount,
        minimumDestinationAmount: attempt.destinationAmount,
        maxFee: attempt.maxFee,
        finalityThreshold: attempt.finalityThreshold,
      });
      const messageData = {
        cctpMessageId: message.messageHash,
        sourceDomain: message.sourceDomain,
        destinationDomain: message.destinationDomain,
        messageHash: message.messageHash,
        eventNonce: message.eventNonce ?? message.nonce,
        burnToken: message.burnToken.toLowerCase(),
        mintRecipient: message.mintRecipient.toLowerCase(),
        burnAmount: message.burnAmount,
        finalityThreshold: message.minFinalityThreshold,
        sourceSender: message.sourceSender.toLowerCase(),
        forwardState: message.forwardState,
        forwardTxHash: message.forwardTxHash,
        cctpMessage: message.rawMessage,
        cctpAttestation: message.attestation,
      };
      if (
        ["confirmed", "complete"].includes(
          message.forwardState?.toLowerCase() ?? "",
        ) &&
        message.forwardTxHash
      ) {
        const forwardTxHash = message.forwardTxHash;
        const arcReceipt = await publicClient.getTransactionReceipt({
          hash: forwardTxHash,
        });
        const mintedAmount = validatedArcMintAmount({
          receipt: arcReceipt,
          usdc: chainsByKey.arcTestnet.usdc as Address,
          vault: attempt.vaultAddress as Address,
          expectedAmount: message.destinationAmount,
        });
        await prisma.$transaction(async (transaction) => {
          await transaction.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
              ...messageData,
              status: "ARC_MINTED",
              mintedAmount,
              bridgeRecoverable: false,
              errorCode: null,
              errorMessage: null,
            },
          });
          const updatedIntent = await transaction.paymentIntent.update({
            where: { id: attempt.paymentIntentId },
            data: { arcMintTransactionHash: forwardTxHash },
          });
          if (message.attestation) {
            await enqueuePaymentWebhook(transaction, {
              eventId: lifecycleWebhookEventId({
                eventType: "payment.attestation_received",
                identity: message.messageHash,
              }),
              eventType: "payment.attestation_received",
              intent: updatedIntent,
              data: {
                attemptId: attempt.id,
                messageHash: message.messageHash,
                eventNonce: message.eventNonce ?? message.nonce,
              },
            });
          }
          await enqueuePaymentWebhook(transaction, {
            eventId: lifecycleWebhookEventId({
              eventType: "payment.arc_minted",
              identity: forwardTxHash,
            }),
            eventType: "payment.arc_minted",
            intent: updatedIntent,
            data: {
              attemptId: attempt.id,
              messageHash: message.messageHash,
              arcMintTransactionHash: forwardTxHash,
              mintedAmount: mintedAmount.toString(),
            },
          });
        });
      } else {
        await prisma.$transaction(async (transaction) => {
          await transaction.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
              ...messageData,
              status: "ATTESTING",
            },
          });
          if (message.attestation) {
            await enqueuePaymentWebhook(transaction, {
              eventId: lifecycleWebhookEventId({
                eventType: "payment.attestation_received",
                identity: message.messageHash,
              }),
              eventType: "payment.attestation_received",
              intent: attempt.paymentIntent,
              data: {
                attemptId: attempt.id,
                messageHash: message.messageHash,
                eventNonce: message.eventNonce ?? message.nonce,
              },
            });
          }
        });
      }
    } catch (error) {
      if (error instanceof CctpReconciliationError) {
        await prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            active: false,
            status: "FAILED",
            errorCode: "CCTP_RECONCILIATION_FAILED",
            errorMessage: error.message.slice(0, 500),
          },
        });
      }
      logger.warn(
        {
          attemptId: attempt.id,
          error: error instanceof Error ? error.message : "unknown",
        },
        "CCTP lookup will retry",
      );
    }
  }
}

async function reconcileVaults() {
  const intents = await prisma.paymentIntent.findMany({
    where: {
      vaultAddress: { not: null },
      status: { in: ["OPEN", "PARTIALLY_FUNDED", "FUNDED", "SETTLING"] },
    },
    take: 100,
  });
  for (const intent of intents) {
    let claim: { submissionId: string; lockToken: string } | null = null;
    try {
      const address = intent.vaultAddress as Address;
      const pendingSubmission = await prisma.settlementSubmission.findFirst({
        where: {
          paymentIntentId: intent.id,
          status: { in: ["PREPARED", "SUBMITTED"] },
        },
        orderBy: { createdAt: "desc" },
      });
      if (pendingSubmission) {
        if (!pendingSubmission.transactionHash) {
          throw new Error("Pending settlement is missing its transaction hash");
        }
        const transactionHash = pendingSubmission.transactionHash as Hex;
        let receipt = await publicClient
          .getTransactionReceipt({ hash: transactionHash })
          .catch(() => null);
        if (
          !receipt &&
          pendingSubmission.status === "PREPARED" &&
          pendingSubmission.rawTransaction
        ) {
          if (!walletClient) continue;
          const broadcastHash = await walletClient.sendRawTransaction({
            serializedTransaction: pendingSubmission.rawTransaction as Hex,
          });
          if (broadcastHash.toLowerCase() !== transactionHash)
            throw new Error("Broadcast settlement hash changed after signing");
          await markSettlementSubmitted(pendingSubmission.id);
          receipt = await publicClient
            .waitForTransactionReceipt({
              hash: transactionHash,
              confirmations: 1,
            })
            .catch(() => null);
        }
        if (!receipt) continue;
        if (receipt.status === "success") {
          await markSettlementConfirmed({
            paymentIntentId: intent.id,
            submissionId: pendingSubmission.id,
            transactionHash,
          });
        } else {
          await markSettlementReverted({
            paymentIntentId: intent.id,
            submissionId: pendingSubmission.id,
            errorMessage: "Settlement transaction reverted",
          });
        }
        continue;
      }
      const [balance, state] = await Promise.all([
        publicClient.readContract({
          address,
          abi: vaultAbi,
          functionName: "currentBalance",
        }),
        publicClient.readContract({
          address,
          abi: vaultAbi,
          functionName: "paymentState",
        }),
      ]);
      const stateNumber = Number(state);
      if (stateNumber === 3) {
        // The finalized PaymentSettled event is authoritative. The current
        // vault balance is normally zero after settlement and must never be
        // used as the funded amount.
        continue;
      }
      const nextStatus =
        balance === 0n
          ? "OPEN"
          : balance < intent.expectedAmount
            ? "PARTIALLY_FUNDED"
            : "FUNDED";
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          fundedAmount: balance,
          status: intent.status === "SETTLING" ? "SETTLING" : nextStatus,
        },
      });
      if (nextStatus === "FUNDED" && walletClient && account) {
        const staleBefore = new Date(Date.now() - 2 * 60_000);
        claim = await claimSettlement({
          paymentIntentId: intent.id,
          lockToken: crypto.randomUUID(),
          staleBefore,
        });
        if (!claim) continue;
        const data = encodeFunctionData({
          abi: vaultAbi,
          functionName: "settle",
        });
        const request = await walletClient.prepareTransactionRequest({
          account,
          chain: arcTestnet,
          to: address,
          data,
        });
        const rawTransaction = await walletClient.signTransaction(request);
        const hash = keccak256(rawTransaction);
        await storePreparedSettlement({
          paymentIntentId: intent.id,
          submissionId: claim.submissionId,
          lockToken: claim.lockToken,
          transactionHash: hash,
          rawTransaction,
        });
        const broadcastHash = await walletClient.sendRawTransaction({
          serializedTransaction: rawTransaction,
        });
        if (broadcastHash.toLowerCase() !== hash.toLowerCase())
          throw new Error("Broadcast settlement hash changed after signing");
        await markSettlementSubmitted(claim.submissionId);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });
        if (receipt.status === "success") {
          await markSettlementConfirmed({
            paymentIntentId: intent.id,
            submissionId: claim.submissionId,
            transactionHash: hash,
          });
        } else {
          await markSettlementReverted({
            paymentIntentId: intent.id,
            submissionId: claim.submissionId,
            errorMessage: "Settlement transaction reverted",
          });
        }
      }
    } catch (error) {
      if (claim) {
        const submission = await prisma.settlementSubmission.findUnique({
          where: { id: claim.submissionId },
        });
        if (submission?.status === "CLAIMED") {
          await failSettlementClaim({
            paymentIntentId: intent.id,
            submissionId: claim.submissionId,
            lockToken: claim.lockToken,
            errorMessage: error instanceof Error ? error.message : "unknown",
          });
        }
      }
      logger.warn(
        {
          invoiceId: intent.id,
          error: error instanceof Error ? error.message : "unknown",
        },
        "vault reconciliation will retry",
      );
    }
  }
}

async function deliverWebhook(
  endpoint: WebhookEndpoint,
  payload: object,
  eventId: string,
) {
  const url = new URL(endpoint.url);
  if (
    url.protocol !== "https:" &&
    !(env.DEMO_MODE && url.hostname === "localhost")
  )
    throw new Error("Unsafe webhook destination");
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac(
    "sha256",
    decryptSecret(endpoint.encryptedSecret),
  )
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return fetch(url, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: {
      "content-type": "application/json",
      "user-agent": "Arc-Checkout-Webhook/1.0",
      "x-arc-event-id": eventId,
      "x-arc-timestamp": timestamp,
      "x-arc-signature": `v1=${signature}`,
    },
    body,
  });
}

async function reconcileLocalDemo() {
  const attempts = await prisma.paymentAttempt.findMany({
    where: {
      status: {
        in: [
          "QUOTED",
          "APPROVING",
          "BURN_SUBMITTED",
          "SOURCE_CONFIRMED",
          "ATTESTING",
          "ARC_MINTED",
          "SETTLING",
        ],
      },
    },
    include: { paymentIntent: true },
    take: 25,
  });
  for (const attempt of attempts) {
    if (Date.now() - attempt.updatedAt.getTime() < 2_000) continue;
    const transitions = {
      QUOTED: "APPROVING",
      APPROVING: "BURN_SUBMITTED",
      BURN_SUBMITTED: "SOURCE_CONFIRMED",
      SOURCE_CONFIRMED: "ATTESTING",
      ATTESTING: "ARC_MINTED",
      ARC_MINTED: "SETTLING",
      SETTLING: "SETTLED",
    } as const;
    const next = transitions[attempt.status as keyof typeof transitions];
    if (!next) continue;
    await prisma.$transaction(async (transaction) => {
      await transaction.paymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: next,
          cctpMessageId:
            next === "ARC_MINTED"
              ? `local-mock-${attempt.id}`
              : attempt.cctpMessageId,
        },
      });
      let updatedIntent = attempt.paymentIntent;
      if (next === "BURN_SUBMITTED") {
        await enqueuePaymentWebhook(transaction, {
          eventId: lifecycleWebhookEventId({
            eventType: "payment.source_submitted",
            identity: `demo:${attempt.id}`,
          }),
          eventType: "payment.source_submitted",
          intent: updatedIntent,
          data: { attemptId: attempt.id, demo: true },
        });
      }
      if (next === "SOURCE_CONFIRMED") {
        await enqueuePaymentWebhook(transaction, {
          eventId: lifecycleWebhookEventId({
            eventType: "payment.source_confirmed",
            identity: `demo:${attempt.id}`,
          }),
          eventType: "payment.source_confirmed",
          intent: updatedIntent,
          data: { attemptId: attempt.id, demo: true },
        });
      }
      if (next === "ATTESTING") {
        await enqueuePaymentWebhook(transaction, {
          eventId: lifecycleWebhookEventId({
            eventType: "payment.attestation_received",
            identity: `demo:${attempt.id}`,
          }),
          eventType: "payment.attestation_received",
          intent: updatedIntent,
          data: { attemptId: attempt.id, demo: true },
        });
      }
      if (next === "ARC_MINTED") {
        updatedIntent = await transaction.paymentIntent.update({
          where: { id: attempt.paymentIntentId },
          data: {
            status: "FUNDED",
            fundedAmount: attempt.paymentIntent.expectedAmount,
          },
        });
        await enqueuePaymentWebhook(transaction, {
          eventId: lifecycleWebhookEventId({
            eventType: "payment.arc_minted",
            identity: `demo:${attempt.id}`,
          }),
          eventType: "payment.arc_minted",
          intent: updatedIntent,
          data: { attemptId: attempt.id, demo: true },
        });
      }
      if (next === "SETTLING") {
        updatedIntent = await transaction.paymentIntent.update({
          where: { id: attempt.paymentIntentId },
          data: { status: "SETTLING" },
        });
      }
      if (next === "SETTLED") {
        updatedIntent = await transaction.paymentIntent.update({
          where: { id: attempt.paymentIntentId },
          data: { status: "SETTLED", settledAt: new Date() },
        });
        await enqueuePaymentWebhook(transaction, {
          eventId: lifecycleWebhookEventId({
            eventType: "payment.settled",
            identity: `demo:${attempt.id}`,
          }),
          eventType: "payment.settled",
          intent: updatedIntent,
          data: { attemptId: attempt.id, demo: true },
        });
      }
    });
  }
}

async function tick() {
  if (env.DEMO_MODE) await reconcileLocalDemo();
  else {
    if (
      env.ARC_MERCHANT_REGISTRY_ADDRESS &&
      env.ARC_CHECKOUT_FACTORY_ADDRESS &&
      env.ARC_DEPLOYMENT_BLOCK !== undefined
    ) {
      try {
        const indexed = await indexArcEvents({
          client: publicClient,
          chainId: arcTestnet.id,
          merchantRegistryAddress: env.ARC_MERCHANT_REGISTRY_ADDRESS as Address,
          checkoutFactoryAddress: env.ARC_CHECKOUT_FACTORY_ADDRESS as Address,
          deploymentBlock: env.ARC_DEPLOYMENT_BLOCK,
          pageSize: env.ARC_INDEXER_PAGE_SIZE,
        });
        workerState.indexerError = null;
        if (indexed.logCount > 0)
          logger.info(indexed, "indexed finalized Arc events");
      } catch (error) {
        workerState.indexerError =
          error instanceof Error ? error.message : "unknown";
        logger.error({ error: workerState.indexerError }, "Arc indexer failed");
      }
    }
    await reconcileCctpAttempts();
    await reconcileVaults();
  }
  await processWebhookQueue(deliverWebhook);
}

const workerState: {
  startedAt: string;
  lastTickStartedAt: string | null;
  lastTickCompletedAt: string | null;
  lastTickError: string | null;
  indexerError: string | null;
  tickRunning: boolean;
} = {
  startedAt: new Date().toISOString(),
  lastTickStartedAt: null,
  lastTickCompletedAt: null,
  lastTickError: null,
  indexerError: null,
  tickRunning: false,
};

async function safeTick(): Promise<void> {
  if (workerState.tickRunning) {
    logger.warn("Skipping overlapping worker tick");
    return;
  }
  workerState.tickRunning = true;
  workerState.lastTickStartedAt = new Date().toISOString();
  try {
    await tick();
    workerState.lastTickCompletedAt = new Date().toISOString();
    workerState.lastTickError = null;
  } catch (error) {
    workerState.lastTickError =
      error instanceof Error ? error.message : "unknown";
    logger.error({ error: workerState.lastTickError }, "worker tick failed");
  } finally {
    workerState.tickRunning = false;
  }
}

const healthServer = createServer((_request, response) => {
  void (async () => {
    const [database, rpc, circle, cursor] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      publicClient.getBlockNumber().then(
        () => true,
        () => false,
      ),
      fetch(`${env.CIRCLE_API_BASE_URL}/v2/burn/USDC/fees/6/26?forward=true`, {
        signal: AbortSignal.timeout(10_000),
      }).then(
        (result) => result.ok,
        () => false,
      ),
      prisma.indexerCursor.findUnique({
        where: {
          chainId_stream: {
            chainId: arcTestnet.id,
            stream: "arc-events",
          },
        },
      }),
    ]);
    const indexerLag =
      cursor?.finalizedBlock === null || cursor?.finalizedBlock === undefined
        ? null
        : cursor.finalizedBlock > cursor.blockNumber
          ? cursor.finalizedBlock - cursor.blockNumber
          : 0n;
    const healthy = database && rpc && circle && !workerState.lastTickError;
    response.writeHead(healthy ? 200 : 503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(
      JSON.stringify({
        status: healthy ? "ok" : "degraded",
        database,
        arcRpc: rpc,
        circleApi: circle,
        indexer: {
          configured: Boolean(
            env.ARC_MERCHANT_REGISTRY_ADDRESS &&
            env.ARC_CHECKOUT_FACTORY_ADDRESS &&
            env.ARC_DEPLOYMENT_BLOCK !== undefined,
          ),
          processedBlock: cursor?.blockNumber.toString() ?? null,
          finalizedBlock: cursor?.finalizedBlock?.toString() ?? null,
          headBlock: cursor?.headBlock?.toString() ?? null,
          lag: indexerLag?.toString() ?? null,
          lastSuccessAt: cursor?.lastSuccessAt?.toISOString() ?? null,
          lastError: cursor?.lastError ?? workerState.indexerError,
        },
        worker: workerState,
      }),
    );
  })().catch((error) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: "error",
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
  });
});
healthServer.listen(env.WORKER_PORT);

logger.info(
  {
    mode: env.DEMO_MODE ? "demo" : "testnet",
    automatedSettlement: Boolean(walletClient),
    arcIndexer: Boolean(
      env.ARC_MERCHANT_REGISTRY_ADDRESS &&
      env.ARC_CHECKOUT_FACTORY_ADDRESS &&
      env.ARC_DEPLOYMENT_BLOCK !== undefined,
    ),
  },
  "settlement worker started",
);
void safeTick();
const timer = setInterval(() => void safeTick(), env.WORKER_POLL_INTERVAL_MS);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    healthServer.close();
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
