import { prisma, type Prisma } from "@arc-checkout/database";
import {
  decodeEventLog,
  hexToString,
  isAddressEqual,
  parseAbi,
  type Address,
  type Log,
  type PublicClient,
} from "viem";

const merchantRegistryEvents = parseAbi([
  "event MerchantRegistered(address indexed owner,address indexed payoutAddress,bytes32 metadataHash)",
  "event MerchantPayoutUpdated(address indexed owner,address indexed oldPayoutAddress,address indexed newPayoutAddress)",
  "event MerchantMetadataUpdated(address indexed owner,bytes32 oldMetadataHash,bytes32 newMetadataHash)",
  "event MerchantStatusUpdated(address indexed owner,bool active)",
]);

const checkoutFactoryEvents = parseAbi([
  "event PaymentIntentCreated(bytes32 indexed orderId,address indexed merchant,address indexed vault,address payoutAddress,uint256 expectedAmount,uint16 protocolFeeBps,uint64 expiresAt,bytes32 metadataHash)",
]);

const paymentVaultEvents = parseAbi([
  "event PaymentAttemptRegistered(bytes32 indexed attemptId,bytes32 indexed orderId,address indexed payer,address refundAddress,uint256 sourceChainId,uint256 destinationAmount,uint256 maximumSourceAmount,uint256 nonce,uint64 quoteExpiresAt,uint64 attemptExpiresAt)",
  "event PaymentAttemptCleared(bytes32 indexed attemptId,address indexed payer)",
  "event PaymentSettled(bytes32 indexed orderId,address indexed caller,uint256 invoiceAmount,uint256 merchantAmount,uint256 protocolFee,uint256 refundedExcess)",
  "event PaymentCancelled(bytes32 indexed orderId,address indexed merchant)",
  "event PaymentRefunded(bytes32 indexed orderId,address indexed caller,address indexed refundAddress,uint256 amount)",
  "event ExcessSwept(bytes32 indexed orderId,address indexed refundAddress,uint256 amount)",
]);

export type ArcIndexerOptions = {
  client: PublicClient;
  chainId: number;
  merchantRegistryAddress: Address;
  checkoutFactoryAddress: Address;
  deploymentBlock: bigint;
  pageSize: bigint;
};

export function nextBlockRange(input: {
  cursorBlock: bigint | null;
  deploymentBlock: bigint;
  headBlock: bigint;
  pageSize: bigint;
}): { fromBlock: bigint; toBlock: bigint } | null {
  const fromBlock =
    input.cursorBlock === null ? input.deploymentBlock : input.cursorBlock + 1n;
  if (fromBlock > input.headBlock) return null;
  return {
    fromBlock,
    toBlock:
      fromBlock + input.pageSize - 1n < input.headBlock
        ? fromBlock + input.pageSize - 1n
        : input.headBlock,
  };
}

export function chainLogKey(log: {
  chainId: number;
  transactionHash: string;
  logIndex: number;
}): string {
  return `${log.chainId}:${log.transactionHash.toLowerCase()}:${log.logIndex}`;
}

function addressArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value))
    throw new Error(`Invalid ${key} address in indexed event`);
  return value.toLowerCase();
}

function hexArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value))
    throw new Error(`Invalid ${key} bytes32 in indexed event`);
  return value.toLowerCase();
}

function bigintArg(args: Record<string, unknown>, key: string): bigint {
  const value = args[key];
  if (typeof value !== "bigint")
    throw new Error(`Invalid ${key} integer in indexed event`);
  return value;
}

export function decodeOrderId(value: string): string {
  try {
    const decoded = hexToString(value as `0x${string}`, { size: 32 }).replace(
      /\0+$/g,
      "",
    );
    return decoded || value.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function slugFor(orderId: string, transactionHash: string): string {
  const base =
    orderId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "invoice";
  return `${base}-${transactionHash.slice(2, 10).toLowerCase()}`;
}

function jsonPayload(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : value,
    ]),
  );
}

export async function processArcLog(
  options: ArcIndexerOptions,
  log: Log<bigint, number, false>,
): Promise<void> {
  if (!log.transactionHash || log.logIndex === null || !log.blockHash)
    throw new Error("Arc RPC returned an incomplete finalized log");
  const contractAddress = log.address.toLowerCase();
  const registryLog = isAddressEqual(
    log.address,
    options.merchantRegistryAddress,
  );
  const factoryLog = isAddressEqual(
    log.address,
    options.checkoutFactoryAddress,
  );
  const abi = registryLog
    ? merchantRegistryEvents
    : factoryLog
      ? checkoutFactoryEvents
      : paymentVaultEvents;
  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
  } catch {
    return;
  }
  const eventName = decoded.eventName;
  const args = decoded.args as unknown as Record<string, unknown>;

  try {
    await prisma.$transaction(async (transaction) => {
      const unique = {
        chainId: options.chainId,
        transactionHash: log.transactionHash.toLowerCase(),
        logIndex: log.logIndex,
      };
      const alreadyProcessed = await transaction.chainTransaction.findUnique({
        where: { chainId_transactionHash_logIndex: unique },
        select: { id: true },
      });
      if (alreadyProcessed) return;

      let merchantId: string | null = null;
      let paymentIntentId: string | null = null;
      if (eventName === "MerchantRegistered") {
        const walletAddress = addressArg(args, "owner");
        const merchant = await transaction.merchant.upsert({
          where: { walletAddress },
          update: {
            payoutAddress: addressArg(args, "payoutAddress"),
            metadataHash: hexArg(args, "metadataHash"),
            active: true,
          },
          create: {
            walletAddress,
            payoutAddress: addressArg(args, "payoutAddress"),
            metadataHash: hexArg(args, "metadataHash"),
            active: true,
          },
        });
        merchantId = merchant.id;
      } else if (eventName === "MerchantPayoutUpdated") {
        const walletAddress = addressArg(args, "owner");
        const merchant = await transaction.merchant.update({
          where: { walletAddress },
          data: { payoutAddress: addressArg(args, "newPayoutAddress") },
        });
        merchantId = merchant.id;
      } else if (eventName === "MerchantMetadataUpdated") {
        const walletAddress = addressArg(args, "owner");
        const merchant = await transaction.merchant.update({
          where: { walletAddress },
          data: { metadataHash: hexArg(args, "newMetadataHash") },
        });
        merchantId = merchant.id;
      } else if (eventName === "MerchantStatusUpdated") {
        const walletAddress = addressArg(args, "owner");
        const active = args.active;
        if (typeof active !== "boolean")
          throw new Error("Invalid merchant status event");
        const merchant = await transaction.merchant.update({
          where: { walletAddress },
          data: { active },
        });
        merchantId = merchant.id;
      } else if (eventName === "PaymentIntentCreated") {
        const walletAddress = addressArg(args, "merchant");
        const merchant = await transaction.merchant.findUnique({
          where: { walletAddress },
        });
        if (!merchant)
          throw new Error("Payment intent references an unindexed merchant");
        const orderIdBytes32 = hexArg(args, "orderId");
        const orderId = decodeOrderId(orderIdBytes32);
        const intent = await transaction.paymentIntent.upsert({
          where: {
            merchantId_orderIdBytes32: {
              merchantId: merchant.id,
              orderIdBytes32,
            },
          },
          update: {
            expectedAmount: bigintArg(args, "expectedAmount"),
            refundAddress: null,
            payoutAddress: addressArg(args, "payoutAddress"),
            vaultAddress: addressArg(args, "vault"),
            metadataHash: hexArg(args, "metadataHash"),
            expiresAt: new Date(Number(bigintArg(args, "expiresAt")) * 1000),
            createChainId: options.chainId,
            createTransactionHash: log.transactionHash.toLowerCase(),
          },
          create: {
            slug: slugFor(orderId, log.transactionHash),
            orderId,
            orderIdBytes32,
            expectedAmount: bigintArg(args, "expectedAmount"),
            refundAddress: null,
            payoutAddress: addressArg(args, "payoutAddress"),
            vaultAddress: addressArg(args, "vault"),
            metadataHash: hexArg(args, "metadataHash"),
            expiresAt: new Date(Number(bigintArg(args, "expiresAt")) * 1000),
            createChainId: options.chainId,
            createTransactionHash: log.transactionHash.toLowerCase(),
            merchantId: merchant.id,
          },
        });
        merchantId = merchant.id;
        paymentIntentId = intent.id;
      } else {
        const intent = await transaction.paymentIntent.findUnique({
          where: { vaultAddress: contractAddress },
        });
        if (!intent) return;
        merchantId = intent.merchantId;
        paymentIntentId = intent.id;
        if (eventName === "PaymentAttemptRegistered") {
          const attemptIdentifier = hexArg(args, "attemptId");
          const payer = addressArg(args, "payer");
          const refundAddress = addressArg(args, "refundAddress");
          const sourceChainId = Number(bigintArg(args, "sourceChainId"));
          const destinationAmount = bigintArg(args, "destinationAmount");
          const maximumSourceAmount = bigintArg(args, "maximumSourceAmount");
          const quoteExpiresAt = new Date(
            Number(bigintArg(args, "quoteExpiresAt")) * 1000,
          );
          const nonce = bigintArg(args, "nonce");
          const attemptExpiresAt = new Date(
            Number(bigintArg(args, "attemptExpiresAt")) * 1000,
          );
          await transaction.paymentAttempt.upsert({
            where: { attemptIdentifier },
            update: {
              active: true,
              vaultAddress: contractAddress,
              orderIdBytes32: hexArg(args, "orderId"),
              sourceChainId,
              destinationChainId: options.chainId,
              customerAddress: payer,
              refundAddress,
              destinationAmount,
              quotedSourceAmount: maximumSourceAmount,
              maximumSourceAmount,
              quoteExpiresAt,
              nonce,
              attemptExpiresAt,
              status: "REGISTERED",
              registeredTransactionHash: log.transactionHash.toLowerCase(),
            },
            create: {
              attemptIdentifier,
              active: true,
              vaultAddress: contractAddress,
              orderIdBytes32: hexArg(args, "orderId"),
              sourceChainId,
              destinationChainId: options.chainId,
              customerAddress: payer,
              refundAddress,
              destinationAmount,
              quotedSourceAmount: maximumSourceAmount,
              maximumSourceAmount,
              quoteExpiresAt,
              nonce,
              attemptExpiresAt,
              registeredTransactionHash: log.transactionHash.toLowerCase(),
              status: "REGISTERED",
              paymentIntentId: intent.id,
            },
          });
          await transaction.paymentIntent.update({
            where: { id: intent.id },
            data: { refundAddress },
          });
        } else if (eventName === "PaymentAttemptCleared") {
          await transaction.paymentAttempt.updateMany({
            where: {
              attemptIdentifier: hexArg(args, "attemptId"),
              paymentIntentId: intent.id,
            },
            data: { active: false, status: "EXPIRED" },
          });
        } else if (eventName === "PaymentSettled") {
          const transactionHash = log.transactionHash.toLowerCase();
          await transaction.paymentIntent.update({
            where: { id: intent.id },
            data: {
              status: "SETTLED",
              fundedAmount: bigintArg(args, "invoiceAmount"),
              settlementMerchantAmount: bigintArg(args, "merchantAmount"),
              protocolFeeAmount: bigintArg(args, "protocolFee"),
              excessAmount: bigintArg(args, "refundedExcess"),
              settlementTransactionHash: transactionHash,
              settlementLockId: null,
              settlementLockedAt: null,
              settledAt: new Date(),
            },
          });
          await transaction.settlementSubmission.updateMany({
            where: { transactionHash },
            data: {
              status: "CONFIRMED",
              confirmedAt: new Date(),
              errorMessage: null,
            },
          });
        } else if (eventName === "PaymentCancelled") {
          await transaction.paymentIntent.update({
            where: { id: intent.id },
            data: { status: "CANCELLED" },
          });
        } else if (eventName === "PaymentRefunded") {
          await transaction.paymentIntent.update({
            where: { id: intent.id },
            data: {
              status: "REFUNDED",
              refundedAmount: bigintArg(args, "amount"),
            },
          });
        } else if (eventName === "ExcessSwept") {
          await transaction.paymentIntent.update({
            where: { id: intent.id },
            data: { excessAmount: bigintArg(args, "amount") },
          });
        }
      }

      await transaction.chainTransaction.create({
        data: {
          ...unique,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash.toLowerCase(),
          contractAddress,
          type: eventName,
          payload: jsonPayload(args) as Prisma.InputJsonObject,
          merchantId,
          paymentIntentId,
        },
      });
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    )
      return;
    throw error;
  }
}

export async function indexArcEvents(options: ArcIndexerOptions): Promise<{
  processedThrough: bigint | null;
  logCount: number;
  headBlock: bigint;
  finalizedBlock: bigint;
  lag: bigint;
}> {
  let headBlock: bigint | null = null;
  try {
    const [currentHead, finalized, cursor] = await Promise.all([
      options.client.getBlockNumber(),
      options.client.getBlock({ blockTag: "finalized" }),
      prisma.indexerCursor.findUnique({
        where: {
          chainId_stream: { chainId: options.chainId, stream: "arc-events" },
        },
      }),
    ]);
    headBlock = currentHead;
    if (finalized.number === null)
      throw new Error("Arc RPC returned a finalized block without a number");
    const finalizedBlock = finalized.number;
    const range = nextBlockRange({
      cursorBlock: cursor?.blockNumber ?? null,
      deploymentBlock: options.deploymentBlock,
      headBlock: finalizedBlock,
      pageSize: options.pageSize,
    });
    if (!range) {
      const processedThrough =
        cursor?.blockNumber ?? options.deploymentBlock - 1n;
      await prisma.indexerCursor.upsert({
        where: {
          chainId_stream: { chainId: options.chainId, stream: "arc-events" },
        },
        update: {
          headBlock,
          finalizedBlock,
          lastSuccessAt: new Date(),
          lastError: null,
          lastErrorAt: null,
        },
        create: {
          chainId: options.chainId,
          stream: "arc-events",
          blockNumber: processedThrough,
          headBlock,
          finalizedBlock,
          lastSuccessAt: new Date(),
        },
      });
      return {
        processedThrough,
        logCount: 0,
        headBlock,
        finalizedBlock,
        lag:
          finalizedBlock > processedThrough
            ? finalizedBlock - processedThrough
            : 0n,
      };
    }

    const [registryLogs, factoryLogs, vaultLogs] = await Promise.all([
      options.client.getLogs({
        address: options.merchantRegistryAddress,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
      }),
      options.client.getLogs({
        address: options.checkoutFactoryAddress,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
      }),
      options.client.getLogs({
        events: paymentVaultEvents,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
      }),
    ]);
    const logs = [...registryLogs, ...factoryLogs, ...vaultLogs].sort(
      (left, right) =>
        left.blockNumber === right.blockNumber
          ? (left.logIndex ?? 0) - (right.logIndex ?? 0)
          : left.blockNumber < right.blockNumber
            ? -1
            : 1,
    );
    for (const log of logs) await processArcLog(options, log);

    await prisma.indexerCursor.upsert({
      where: {
        chainId_stream: { chainId: options.chainId, stream: "arc-events" },
      },
      update: {
        blockNumber: range.toBlock,
        headBlock,
        finalizedBlock,
        lastSuccessAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      },
      create: {
        chainId: options.chainId,
        stream: "arc-events",
        blockNumber: range.toBlock,
        headBlock,
        finalizedBlock,
        lastSuccessAt: new Date(),
      },
    });
    return {
      processedThrough: range.toBlock,
      logCount: logs.length,
      headBlock,
      finalizedBlock,
      lag: finalizedBlock - range.toBlock,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    await prisma.indexerCursor.upsert({
      where: {
        chainId_stream: { chainId: options.chainId, stream: "arc-events" },
      },
      update: {
        ...(headBlock === null ? {} : { headBlock }),
        lastError: message.slice(0, 500),
        lastErrorAt: new Date(),
      },
      create: {
        chainId: options.chainId,
        stream: "arc-events",
        blockNumber: options.deploymentBlock - 1n,
        ...(headBlock === null ? {} : { headBlock }),
        lastError: message.slice(0, 500),
        lastErrorAt: new Date(),
      },
    });
    throw error;
  }
}
