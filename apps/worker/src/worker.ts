import { createDecipheriv, createHash, createHmac } from "node:crypto";
import {
  prisma,
  type PaymentIntent,
  type WebhookEndpoint,
} from "@arc-checkout/database";
import { fetchCctpMessage } from "@arc-checkout/cctp";
import { chainsByKey } from "@arc-checkout/chain-config";
import { formatUsdc } from "@arc-checkout/shared";
import pino from "pino";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { z } from "zod";
import { indexArcEvents } from "./arc-indexer.js";

const env = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    ARC_RPC_URL: z.string().url().default(chainsByKey.arcTestnet.defaultRpcUrl),
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

async function queueWebhook(intent: PaymentIntent, eventType: string) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      merchantId: intent.merchantId,
      active: true,
      events: { has: eventType },
    },
  });
  for (const endpoint of endpoints) {
    const eventId = crypto.randomUUID();
    await prisma.webhookDelivery.upsert({
      where: { eventId },
      update: {},
      create: {
        eventId,
        eventType,
        webhookEndpointId: endpoint.id,
        payload: {
          id: eventId,
          type: eventType,
          timestamp: new Date().toISOString(),
          merchantId: intent.merchantId,
          invoiceId: intent.id,
          orderId: intent.orderId,
          amount: formatUsdc(intent.expectedAmount),
          finalStatus: intent.status,
          arcMintTransactionHash: intent.arcMintTransactionHash,
          settlementTransactionHash: intent.settlementTransactionHash,
        },
      },
    });
  }
}

async function reconcileCctpAttempts() {
  const attempts = await prisma.paymentAttempt.findMany({
    where: {
      sourceTransactionHash: { not: null },
      status: { in: ["BURN_SUBMITTED", "SOURCE_CONFIRMED", "ATTESTING"] },
    },
    include: { paymentIntent: true },
    take: 50,
  });
  for (const attempt of attempts) {
    try {
      const message = await fetchCctpMessage(
        attempt.sourceChainId,
        attempt.sourceTransactionHash!,
        env.CIRCLE_API_BASE_URL,
        AbortSignal.timeout(8000),
      );
      if (!message) continue;
      if (message.forwardTxHash) {
        await prisma.$transaction([
          prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: "ARC_MINTED",
              cctpMessageId: message.messageHash ?? message.eventNonce ?? null,
            },
          }),
          prisma.paymentIntent.update({
            where: { id: attempt.paymentIntentId },
            data: { arcMintTransactionHash: message.forwardTxHash },
          }),
        ]);
        await queueWebhook(attempt.paymentIntent, "payment.arc_minted");
      } else if (message.status === "complete") {
        await prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "ATTESTING",
            cctpMessageId: message.messageHash ?? message.eventNonce ?? null,
          },
        });
      }
    } catch (error) {
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
    let settlementLockId: string | null = null;
    try {
      const address = intent.vaultAddress as Address;
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
        settlementLockId = crypto.randomUUID();
        const staleBefore = new Date(Date.now() - 2 * 60_000);
        const claimed = await prisma.paymentIntent.updateMany({
          where: {
            id: intent.id,
            OR: [
              { status: "FUNDED", settlementLockId: null },
              { status: "SETTLING", settlementLockedAt: { lt: staleBefore } },
            ],
          },
          data: {
            status: "SETTLING",
            settlementLockId,
            settlementLockedAt: new Date(),
          },
        });
        if (claimed.count !== 1) {
          settlementLockId = null;
          continue;
        }
        const hash = await walletClient.writeContract({
          address,
          abi: vaultAbi,
          functionName: "settle",
          account,
          chain: arcTestnet,
        });
        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          confirmations: 1,
        });
        if (receipt.status === "success") {
          await prisma.paymentIntent.update({
            where: { id: intent.id },
            data: {
              status: "SETTLING",
              settlementTransactionHash: hash,
            },
          });
        } else {
          await prisma.paymentIntent.updateMany({
            where: { id: intent.id, settlementLockId },
            data: {
              status: "FUNDED",
              settlementLockId: null,
              settlementLockedAt: null,
            },
          });
          settlementLockId = null;
        }
      }
    } catch (error) {
      if (settlementLockId) {
        await prisma.paymentIntent.updateMany({
          where: { id: intent.id, settlementLockId },
          data: {
            status: "FUNDED",
            settlementLockId: null,
            settlementLockedAt: null,
          },
        });
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

async function processWebhookQueue() {
  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      status: { in: ["PENDING", "RETRYING"] },
      nextAttemptAt: { lte: new Date() },
    },
    include: { webhookEndpoint: true },
    take: 25,
  });
  for (const delivery of deliveries) {
    try {
      const response = await deliverWebhook(
        delivery.webhookEndpoint,
        delivery.payload as object,
        delivery.eventId,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "DELIVERED",
          deliveredAt: new Date(),
          attempts: { increment: 1 },
          lastStatusCode: response.status,
        },
      });
    } catch (error) {
      const attempts = delivery.attempts + 1;
      const permanent = attempts >= 8;
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: permanent ? "FAILED" : "RETRYING",
          attempts,
          lastError:
            error instanceof Error ? error.message.slice(0, 500) : "unknown",
          nextAttemptAt: new Date(
            Date.now() + Math.min(300_000, 2 ** attempts * 1000),
          ),
        },
      });
    }
  }
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
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: next,
        cctpMessageId:
          next === "ARC_MINTED"
            ? `local-mock-${attempt.id}`
            : attempt.cctpMessageId,
      },
    });
    if (next === "ARC_MINTED")
      await prisma.paymentIntent.update({
        where: { id: attempt.paymentIntentId },
        data: {
          status: "FUNDED",
          fundedAmount: attempt.paymentIntent.expectedAmount,
        },
      });
    if (next === "SETTLING")
      await prisma.paymentIntent.update({
        where: { id: attempt.paymentIntentId },
        data: { status: "SETTLING" },
      });
    if (next === "SETTLED") {
      const updated = await prisma.paymentIntent.update({
        where: { id: attempt.paymentIntentId },
        data: { status: "SETTLED", settledAt: new Date() },
      });
      await queueWebhook(updated, "payment.settled");
    }
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
      const indexed = await indexArcEvents({
        client: publicClient,
        chainId: arcTestnet.id,
        merchantRegistryAddress: env.ARC_MERCHANT_REGISTRY_ADDRESS as Address,
        checkoutFactoryAddress: env.ARC_CHECKOUT_FACTORY_ADDRESS as Address,
        deploymentBlock: env.ARC_DEPLOYMENT_BLOCK,
        pageSize: env.ARC_INDEXER_PAGE_SIZE,
      });
      if (indexed.logCount > 0)
        logger.info(indexed, "indexed finalized Arc events");
    }
    await reconcileCctpAttempts();
    await reconcileVaults();
  }
  await processWebhookQueue();
}

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
void tick();
const timer = setInterval(() => void tick(), env.WORKER_POLL_INTERVAL_MS);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
