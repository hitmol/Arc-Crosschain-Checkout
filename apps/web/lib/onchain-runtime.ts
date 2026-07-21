import {
  getAddress,
  isAddress,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import { arcTestnet } from "viem/chains";
import { checkoutFactoryAbi, merchantRegistryAbi, paymentVaultAbi } from "./contracts";
import { arcDeployment } from "./deployment";
import {
  decodeCreatedInvoice,
  readLocalInvoices,
  upsertLocalInvoice,
  type LocalInvoice,
} from "./onchain-invoices";

export const factoryAddress = getAddress(
  arcDeployment.contracts.CheckoutFactory,
);
export const registryAddress = getAddress(
  arcDeployment.contracts.MerchantRegistry,
);

export type MerchantRecord = {
  owner: Address;
  payoutAddress: Address;
  metadataHash: Hash;
  active: boolean;
  createdAt: bigint;
};

function contractAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false }))
    throw new Error(`Arc returned an invalid ${field} address`);
  return getAddress(value);
}

export async function verifyOnchainDeployment(publicClient: PublicClient) {
  const chainId = await publicClient.getChainId();
  if (chainId !== arcTestnet.id)
    throw new Error(`Arc Testnet ${arcTestnet.id} is required`);
  const [factoryCode, registryCode, configuredRegistry, configuredUsdc, configuredVault] =
    await Promise.all([
      publicClient.getBytecode({ address: factoryAddress }),
      publicClient.getBytecode({ address: registryAddress }),
      publicClient.readContract({
        address: factoryAddress,
        abi: checkoutFactoryAbi,
        functionName: "merchantRegistry",
      }),
      publicClient.readContract({
        address: factoryAddress,
        abi: checkoutFactoryAbi,
        functionName: "usdc",
      }),
      publicClient.readContract({
        address: factoryAddress,
        abi: checkoutFactoryAbi,
        functionName: "vaultImplementation",
      }),
    ]);
  if (!factoryCode || factoryCode === "0x" || !registryCode || registryCode === "0x")
    throw new Error("Verified SettleLink contract bytecode is unavailable on Arc");
  const expected = {
    registry: registryAddress.toLowerCase(),
    usdc: arcDeployment.usdc.toLowerCase(),
    vault: arcDeployment.contracts.PaymentVaultImplementation.toLowerCase(),
  };
  if (
    String(configuredRegistry).toLowerCase() !== expected.registry ||
    String(configuredUsdc).toLowerCase() !== expected.usdc ||
    String(configuredVault).toLowerCase() !== expected.vault
  )
    throw new Error("CheckoutFactory configuration differs from the verified deployment record");
  return true;
}

export async function readMerchant(
  publicClient: PublicClient,
  merchant: Address,
): Promise<MerchantRecord> {
  const result = await publicClient.readContract({
    address: registryAddress,
    abi: merchantRegistryAbi,
    functionName: "merchantOf",
    args: [merchant],
  });
  const decoded: unknown = result;
  const tuple = Array.isArray(decoded)
    ? (() => {
        const values: readonly unknown[] = decoded;
        return {
          owner: values[0],
          payoutAddress: values[1],
          metadataHash: values[2],
          active: values[3],
          createdAt: values[4],
        };
      })()
    : (decoded as Record<string, unknown>);
  if (
    typeof tuple.metadataHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(tuple.metadataHash) ||
    typeof tuple.active !== "boolean" ||
    typeof tuple.createdAt !== "bigint"
  )
    throw new Error("Arc returned an invalid merchant record");
  return {
    owner: contractAddress(tuple.owner, "merchant owner"),
    payoutAddress: contractAddress(tuple.payoutAddress, "merchant payout"),
    metadataHash: tuple.metadataHash as Hash,
    active: tuple.active,
    createdAt: tuple.createdAt,
  };
}

export function isRegisteredMerchant(record: MerchantRecord, address: Address) {
  return record.owner.toLowerCase() === address.toLowerCase() && record.active;
}

export async function recoverPendingInvoices(
  publicClient: PublicClient,
  storage: Pick<Storage, "getItem" | "setItem">,
): Promise<LocalInvoice[]> {
  const records = readLocalInvoices(storage);
  for (const record of records.filter((entry) => entry.status === "pending")) {
    try {
      const receipt = await publicClient.getTransactionReceipt({
        hash: record.creationTransaction as Hash,
      });
      if (receipt.status === "reverted") {
        upsertLocalInvoice(storage, {
          ...record,
          status: "reverted",
          failure: "Arc receipt confirmed that the transaction reverted.",
          blockNumber: receipt.blockNumber.toString(),
        });
        continue;
      }
      const created = decodeCreatedInvoice(receipt, {
        factory: factoryAddress,
        merchant: record.merchant,
        orderId: record.orderId as Hash,
        amountUnits: BigInt(record.amountUnits),
        expiresAt: record.expiresAt,
        predictedVault: record.predictedVault,
      });
      upsertLocalInvoice(storage, {
        ...record,
        status: "confirmed",
        vault: created.vault,
        blockNumber: created.blockNumber.toString(),
        eventName: "PaymentIntentCreated",
      });
    } catch (error) {
      if (/not found|could not be found|pending/i.test(String(error))) continue;
      upsertLocalInvoice(storage, {
        ...record,
        failure:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Receipt recovery failed",
      });
    }
  }
  return readLocalInvoices(storage);
}

export type VaultSnapshot = {
  vault: Address;
  merchant: Address;
  payoutAddress: Address;
  orderId: Hash;
  expectedAmount: bigint;
  currentBalance: bigint;
  expiresAt: bigint;
  paymentState: number;
  payer: Address;
  refundAddress: Address;
};

export async function readVaultSnapshot(
  publicClient: PublicClient,
  vault: Address,
): Promise<VaultSnapshot> {
  const code = await publicClient.getBytecode({ address: vault });
  if (!code || code === "0x") throw new Error("Invoice vault bytecode was not found on Arc");
  const [merchant, payoutAddress, orderId, expectedAmount, currentBalance, expiresAt, paymentState, payer, refundAddress] =
    await Promise.all([
      publicClient.readContract({ address: vault, abi: paymentVaultAbi, functionName: "merchant" }),
      publicClient.readContract({ address: vault, abi: paymentVaultAbi, functionName: "payoutAddress" }),
      publicClient.readContract({ address: vault, abi: paymentVaultAbi, functionName: "orderId" }),
      publicClient.readContract({ address: vault, abi: paymentVaultAbi, functionName: "expectedAmount" }),
      publicClient.readContract({ address: vault, abi: paymentVaultAbi, functionName: "currentBalance" }),
      publicClient.readContract({ address: vault, abi: paymentVaultAbi, functionName: "expiresAt" }),
      publicClient.readContract({ address: vault, abi: paymentVaultAbi, functionName: "paymentState" }),
      publicClient.readContract({ address: vault, abi: paymentVaultAbi, functionName: "payer" }),
      publicClient.readContract({ address: vault, abi: paymentVaultAbi, functionName: "payerRefundAddress" }),
    ]);
  return {
    vault,
    merchant: contractAddress(merchant, "merchant"),
    payoutAddress: contractAddress(payoutAddress, "payout"),
    orderId: orderId as Hash,
    expectedAmount: expectedAmount as bigint,
    currentBalance: currentBalance as bigint,
    expiresAt: expiresAt as bigint,
    paymentState: Number(paymentState),
    payer: contractAddress(payer, "payer"),
    refundAddress: contractAddress(refundAddress, "refund"),
  };
}
