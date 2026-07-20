import { prisma } from "@arc-checkout/database";
import {
  encodeAbiParameters,
  encodeEventTopics,
  padHex,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { afterAll, describe, expect, it } from "vitest";
import { indexArcEvents, type ArcIndexerOptions } from "./arc-indexer.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);
const registry = "0x1000000000000000000000000000000000000001" as const;
const factory = "0x2000000000000000000000000000000000000002" as const;
const merchant = "0x3000000000000000000000000000000000000003" as const;
const payout = "0x4000000000000000000000000000000000000004" as const;
const vault = "0x5000000000000000000000000000000000000005" as const;
const cancelledVault = "0x5000000000000000000000000000000000000006" as const;
const refundedVault = "0x5000000000000000000000000000000000000007" as const;
const blockHash = `0x${"99".repeat(32)}` as const;
const chainId = 1_500_000_000 + Math.floor(Math.random() * 10_000_000);
const orderId = padHex(stringToHex("INDEXER-INTEGRATION"), { size: 32 });
const cancelledOrderId = padHex(stringToHex("INDEXER-CANCELLED"), { size: 32 });
const refundedOrderId = padHex(stringToHex("INDEXER-REFUNDED"), { size: 32 });
const metadata = `0x${"00".repeat(32)}` as const;

const registryAbi = parseAbi([
  "event MerchantRegistered(address indexed owner,address indexed payoutAddress,bytes32 metadataHash)",
]);
const factoryAbi = parseAbi([
  "event PaymentIntentCreated(bytes32 indexed orderId,address indexed merchant,address indexed vault,address payoutAddress,uint256 expectedAmount,uint16 protocolFeeBps,uint64 expiresAt,bytes32 metadataHash)",
]);
const vaultAbi = parseAbi([
  "event PaymentSettled(bytes32 indexed orderId,address indexed caller,uint256 invoiceAmount,uint256 merchantAmount,uint256 protocolFee,uint256 refundedExcess)",
  "event PaymentCancelled(bytes32 indexed orderId,address indexed merchant)",
  "event PaymentRefunded(bytes32 indexed orderId,address indexed caller,address indexed refundAddress,uint256 amount)",
  "event ExcessSwept(bytes32 indexed orderId,address indexed refundAddress,uint256 amount)",
]);

function log(input: {
  address: Address;
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  topics: readonly unknown[];
  data: Hex;
}): Log<bigint, number, false> {
  return {
    ...input,
    topics: input.topics as [Hex, ...Hex[]],
    blockHash,
    transactionIndex: 0,
    removed: false,
  };
}

const merchantLog = log({
  address: registry,
  transactionHash: `0x${"01".repeat(32)}`,
  logIndex: 0,
  blockNumber: 100n,
  topics: encodeEventTopics({
    abi: registryAbi,
    eventName: "MerchantRegistered",
    args: { owner: merchant, payoutAddress: payout },
  }),
  data: encodeAbiParameters(parseAbiParameters("bytes32"), [metadata]),
});

const intentLog = log({
  address: factory,
  transactionHash: `0x${"02".repeat(32)}`,
  logIndex: 0,
  blockNumber: 101n,
  topics: encodeEventTopics({
    abi: factoryAbi,
    eventName: "PaymentIntentCreated",
    args: { orderId, merchant, vault },
  }),
  data: encodeAbiParameters(
    parseAbiParameters("address,uint256,uint16,uint64,bytes32"),
    [payout, 1_000_000n, 100, 2_000_000_000n, metadata],
  ),
});

const settlementLog = log({
  address: vault,
  transactionHash: `0x${"03".repeat(32)}`,
  logIndex: 0,
  blockNumber: 102n,
  topics: encodeEventTopics({
    abi: vaultAbi,
    eventName: "PaymentSettled",
    args: { orderId, caller: merchant },
  }),
  data: encodeAbiParameters(
    parseAbiParameters("uint256,uint256,uint256,uint256"),
    [1_000_000n, 990_000n, 10_000n, 0n],
  ),
});

function intentCreatedLog(input: {
  transactionByte: string;
  blockNumber: bigint;
  orderId: Hex;
  vault: Address;
}): Log<bigint, number, false> {
  return log({
    address: factory,
    transactionHash: `0x${input.transactionByte.repeat(32)}`,
    logIndex: 0,
    blockNumber: input.blockNumber,
    topics: encodeEventTopics({
      abi: factoryAbi,
      eventName: "PaymentIntentCreated",
      args: { orderId: input.orderId, merchant, vault: input.vault },
    }),
    data: encodeAbiParameters(
      parseAbiParameters("address,uint256,uint16,uint64,bytes32"),
      [payout, 1_000_000n, 100, 2_000_000_000n, metadata],
    ),
  });
}

const cancelledIntentLog = intentCreatedLog({
  transactionByte: "04",
  blockNumber: 103n,
  orderId: cancelledOrderId,
  vault: cancelledVault,
});
const cancellationLog = log({
  address: cancelledVault,
  transactionHash: `0x${"05".repeat(32)}`,
  logIndex: 0,
  blockNumber: 104n,
  topics: encodeEventTopics({
    abi: vaultAbi,
    eventName: "PaymentCancelled",
    args: { orderId: cancelledOrderId, merchant },
  }),
  data: "0x",
});
const refundedIntentLog = intentCreatedLog({
  transactionByte: "06",
  blockNumber: 105n,
  orderId: refundedOrderId,
  vault: refundedVault,
});
const refundLog = log({
  address: refundedVault,
  transactionHash: `0x${"07".repeat(32)}`,
  logIndex: 0,
  blockNumber: 106n,
  topics: encodeEventTopics({
    abi: vaultAbi,
    eventName: "PaymentRefunded",
    args: { orderId: refundedOrderId, caller: merchant, refundAddress: payout },
  }),
  data: encodeAbiParameters(parseAbiParameters("uint256"), [400_000n]),
});
const excessLog = log({
  address: refundedVault,
  transactionHash: `0x${"08".repeat(32)}`,
  logIndex: 0,
  blockNumber: 107n,
  topics: encodeEventTopics({
    abi: vaultAbi,
    eventName: "ExcessSwept",
    args: { orderId: refundedOrderId, refundAddress: payout },
  }),
  data: encodeAbiParameters(parseAbiParameters("uint256"), [25_000n]),
});

function mockClient(includeMerchant: boolean): PublicClient {
  const all = includeMerchant
    ? [
        merchantLog,
        merchantLog,
        intentLog,
        settlementLog,
        cancelledIntentLog,
        cancellationLog,
        refundedIntentLog,
        refundLog,
        excessLog,
      ]
    : [intentLog, settlementLog];
  return {
    getBlockNumber: () => Promise.resolve(120n),
    getBlock: () => Promise.resolve({ number: 110n }),
    getLogs: (parameters: {
      address?: Address;
      fromBlock?: bigint;
      toBlock?: bigint;
    }) =>
      Promise.resolve(
        all.filter(
          (entry) =>
            entry.blockNumber >= (parameters.fromBlock ?? 0n) &&
            entry.blockNumber <= (parameters.toBlock ?? 2n ** 64n) &&
            (parameters.address
              ? entry.address.toLowerCase() === parameters.address.toLowerCase()
              : ![registry, factory].some(
                  (address) =>
                    entry.address.toLowerCase() === address.toLowerCase(),
                )),
        ),
      ),
  } as unknown as PublicClient;
}

function options(client: PublicClient): ArcIndexerOptions {
  return {
    client,
    chainId,
    merchantRegistryAddress: registry,
    checkoutFactoryAddress: factory,
    deploymentBlock: 100n,
    pageSize: 100n,
  };
}

describe.skipIf(!databaseAvailable)("Arc indexer with PostgreSQL", () => {
  afterAll(async () => {
    const indexedMerchant = await prisma.merchant.findUnique({
      where: { walletAddress: merchant.toLowerCase() },
    });
    await prisma.indexerCursor.deleteMany({ where: { chainId } });
    await prisma.chainTransaction.deleteMany({ where: { chainId } });
    if (indexedMerchant)
      await prisma.merchant.delete({ where: { id: indexedMerchant.id } });
  });

  it("does not advance a failed page and recovers when merchant history appears", async () => {
    await expect(indexArcEvents(options(mockClient(false)))).rejects.toThrow(
      "unindexed merchant",
    );
    expect(
      await prisma.indexerCursor.findUniqueOrThrow({
        where: { chainId_stream: { chainId, stream: "arc-events" } },
        select: { blockNumber: true, lastError: true },
      }),
    ).toEqual({
      blockNumber: 99n,
      lastError: "Payment intent references an unindexed merchant",
    });

    const indexed = await indexArcEvents(options(mockClient(true)));
    expect(indexed).toMatchObject({
      processedThrough: 110n,
      headBlock: 120n,
      finalizedBlock: 110n,
      lag: 0n,
    });
    expect(await prisma.chainTransaction.count({ where: { chainId } })).toBe(8);
    const intent = await prisma.paymentIntent.findUniqueOrThrow({
      where: { vaultAddress: vault.toLowerCase() },
    });
    expect(intent).toMatchObject({
      status: "SETTLED",
      fundedAmount: 1_000_000n,
      settlementMerchantAmount: 990_000n,
      protocolFeeAmount: 10_000n,
      settlementTransactionHash: settlementLog.transactionHash,
    });
    expect(
      await prisma.paymentIntent.findUniqueOrThrow({
        where: { vaultAddress: cancelledVault.toLowerCase() },
        select: { status: true },
      }),
    ).toEqual({ status: "CANCELLED" });
    expect(
      await prisma.paymentIntent.findUniqueOrThrow({
        where: { vaultAddress: refundedVault.toLowerCase() },
        select: { status: true, refundedAmount: true, excessAmount: true },
      }),
    ).toEqual({
      status: "REFUNDED",
      refundedAmount: 400_000n,
      excessAmount: 25_000n,
    });
  });

  it("resumes after restart and deduplicates a replayed page and log", async () => {
    expect((await indexArcEvents(options(mockClient(true)))).logCount).toBe(0);
    await prisma.indexerCursor.update({
      where: { chainId_stream: { chainId, stream: "arc-events" } },
      data: { blockNumber: 99n },
    });
    await indexArcEvents(options(mockClient(true)));
    expect(await prisma.chainTransaction.count({ where: { chainId } })).toBe(8);
    const cursor = await prisma.indexerCursor.findUniqueOrThrow({
      where: { chainId_stream: { chainId, stream: "arc-events" } },
    });
    expect(cursor).toMatchObject({
      blockNumber: 110n,
      headBlock: 120n,
      finalizedBlock: 110n,
      lastError: null,
    });
    expect(cursor.lastSuccessAt).not.toBeNull();
  });
});
