import { orderIdToBytes32, parseUsdc } from "@arc-checkout/shared";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  parseAbi,
  toBytes,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { arcTestnet } from "viem/chains";
import { config } from "./config.js";

export const paymentIntentCreatedAbi = parseAbi([
  "event PaymentIntentCreated(bytes32 indexed orderId,address indexed merchant,address indexed vault,address payoutAddress,uint256 expectedAmount,uint16 protocolFeeBps,uint64 expiresAt,bytes32 metadataHash)",
]);

const merchantRegistryReadAbi = parseAbi([
  "function merchantOf(address merchant) view returns ((address owner,address payoutAddress,bytes32 metadataHash,bool active,uint64 createdAt))",
]);

const arcClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.ARC_RPC_URL),
});

export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconciliationError";
  }
}

export type ReconcileIntentInput = {
  transactionHash: Hex;
  merchantAddress: Address;
  orderId: string;
  amount: string;
  expiresAt: string;
  description?: string;
};

export async function readRegisteredMerchant(merchantAddress: Address) {
  if (!config.ARC_MERCHANT_REGISTRY_ADDRESS)
    throw new Error("Merchant registry address is not configured");
  const merchant = await arcClient.readContract({
    address: getAddress(config.ARC_MERCHANT_REGISTRY_ADDRESS),
    abi: merchantRegistryReadAbi,
    functionName: "merchantOf",
    args: [merchantAddress],
  });
  if (
    merchant.owner === zeroAddress ||
    !isAddressEqual(merchant.owner, merchantAddress)
  )
    throw new ReconciliationError("Merchant is not registered on Arc");
  if (!merchant.active)
    throw new ReconciliationError("Merchant is inactive on Arc");
  return {
    walletAddress: getAddress(merchant.owner).toLowerCase(),
    payoutAddress: getAddress(merchant.payoutAddress).toLowerCase(),
    metadataHash: merchant.metadataHash.toLowerCase(),
  };
}

export async function verifyPaymentIntentTransaction(
  input: ReconcileIntentInput,
  expectedPayoutAddress: Address,
) {
  if (!config.NEXT_PUBLIC_CHECKOUT_FACTORY_ADDRESS)
    throw new Error("Checkout factory address is not configured");
  const factory = getAddress(config.NEXT_PUBLIC_CHECKOUT_FACTORY_ADDRESS);
  const receipt = await arcClient.getTransactionReceipt({
    hash: input.transactionHash,
  });
  if (receipt.status !== "success")
    throw new ReconciliationError("Arc transaction did not succeed");
  if (!receipt.to || !isAddressEqual(receipt.to, factory))
    throw new ReconciliationError(
      "Transaction was not sent to the configured factory",
    );
  if (!isAddressEqual(receipt.from, input.merchantAddress))
    throw new ReconciliationError(
      "Transaction sender is not the authenticated merchant",
    );

  const expectedOrderId = orderIdToBytes32(input.orderId).toLowerCase();
  const expectedAmount = parseUsdc(input.amount);
  const expectedExpiry = BigInt(
    Math.floor(new Date(input.expiresAt).getTime() / 1000),
  );
  const expectedMetadataHash = input.description
    ? keccak256(toBytes(input.description))
    : zeroHash;

  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, factory)) continue;
    const decoded = (() => {
      try {
        return decodeEventLog({
          abi: paymentIntentCreatedAbi,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        return null;
      }
    })();
    if (!decoded) continue;
    if (decoded.eventName !== "PaymentIntentCreated") continue;
    const args = decoded.args;
    if (args.orderId.toLowerCase() !== expectedOrderId)
      throw new ReconciliationError(
        "Factory event order ID does not match request",
      );
    if (!isAddressEqual(args.merchant, input.merchantAddress))
      throw new ReconciliationError(
        "Factory event merchant does not match session",
      );
    if (args.expectedAmount !== expectedAmount)
      throw new ReconciliationError(
        "Factory event amount does not match request",
      );
    if (BigInt(args.expiresAt) !== expectedExpiry)
      throw new ReconciliationError(
        "Factory event expiry does not match request",
      );
    if (!isAddressEqual(args.payoutAddress, expectedPayoutAddress))
      throw new ReconciliationError(
        "Factory event payout does not match indexed merchant",
      );
    if (
      input.description !== undefined &&
      args.metadataHash.toLowerCase() !== expectedMetadataHash.toLowerCase()
    )
      throw new ReconciliationError(
        "Factory event metadata does not match request",
      );

    return {
      chainId: arcTestnet.id,
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      logIndex: log.logIndex,
      factoryAddress: factory,
      orderIdBytes32: args.orderId.toLowerCase(),
      merchantAddress: args.merchant.toLowerCase(),
      vaultAddress: args.vault.toLowerCase(),
      payoutAddress: args.payoutAddress.toLowerCase(),
      expectedAmount: args.expectedAmount,
      protocolFeeBps: args.protocolFeeBps,
      expiresAt: new Date(Number(args.expiresAt) * 1000),
      metadataHash: args.metadataHash.toLowerCase(),
    };
  }
  throw new ReconciliationError(
    "Confirmed transaction has no PaymentIntentCreated event",
  );
}
