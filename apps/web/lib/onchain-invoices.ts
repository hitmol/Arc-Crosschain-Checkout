import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  formatUnits,
  getAddress,
  isAddress,
  type Address,
  type Hash,
  type TransactionReceipt,
  zeroAddress,
} from "viem";
import {
  orderIdSchema,
  orderIdToBytes32,
  parseUsdc,
  usdcAmountSchema,
} from "@arc-checkout/shared";
import { z } from "zod";
import { checkoutFactoryAbi } from "./contracts";

export const ARC_CHAIN_ID = 5_042_002;
export const MIN_INVOICE_EXPIRY_SECONDS = 5 * 60;
export const MAX_INVOICE_EXPIRY_SECONDS = 30 * 24 * 60 * 60;
export const ONCHAIN_INVOICE_STORAGE_KEY = "settlelink.onchain-invoices.v1";

const addressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), "Invalid EVM address")
  .transform((value) => getAddress(value));
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const localInvoiceSchema = z.object({
  version: z.literal(1),
  merchant: addressSchema,
  orderReference: z.string().min(1).max(80),
  orderId: bytes32Schema,
  amount: z.string().min(1),
  amountUnits: z.string().regex(/^\d+$/),
  expiresAt: z.number().int().positive(),
  metadataHash: bytes32Schema,
  predictedVault: addressSchema,
  vault: addressSchema.optional(),
  creationTransaction: hashSchema,
  blockNumber: z.string().regex(/^\d+$/).optional(),
  eventName: z.literal("PaymentIntentCreated").optional(),
  status: z.enum(["pending", "confirmed", "reverted"]),
  createdAt: z.string().datetime(),
  failure: z.string().max(500).optional(),
});

export type LocalInvoice = z.infer<typeof localInvoiceSchema>;

export type InvoiceFormInput = {
  orderReference: string;
  amount: string;
  expiresAt: number;
};

export type ValidatedInvoiceInput = InvoiceFormInput & {
  orderId: Hash;
  amountUnits: bigint;
};

export function validateInvoiceInput(
  input: InvoiceFormInput,
  nowSeconds = Math.floor(Date.now() / 1_000),
): ValidatedInvoiceInput {
  const orderReference = orderIdSchema.parse(input.orderReference);
  const amount = usdcAmountSchema.parse(input.amount);
  if (!Number.isSafeInteger(input.expiresAt))
    throw new Error("Expiry must be a valid Unix timestamp");
  if (input.expiresAt < nowSeconds + MIN_INVOICE_EXPIRY_SECONDS)
    throw new Error("Expiry must be at least 5 minutes in the future");
  if (input.expiresAt > nowSeconds + MAX_INVOICE_EXPIRY_SECONDS)
    throw new Error("Expiry cannot be more than 30 days in the future");
  return {
    orderReference,
    amount,
    expiresAt: input.expiresAt,
    orderId: orderIdToBytes32(orderReference),
    amountUnits: parseUsdc(amount),
  };
}

export function validatePayoutAddress(value: string): Address {
  if (!isAddress(value, { strict: false }))
    throw new Error("Enter a valid Arc payout address");
  return getAddress(value);
}

export function assertOrderIdAvailable(existingVault: Address) {
  if (existingVault !== zeroAddress)
    throw new Error(
      "This order ID has already been used by the connected merchant.",
    );
}

export function readLocalInvoices(storage: Pick<Storage, "getItem">): LocalInvoice[] {
  const raw = storage.getItem(ONCHAIN_INVOICE_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const result = localInvoiceSchema.safeParse(entry);
      return result.success ? [result.data] : [];
    });
  } catch {
    return [];
  }
}

export function writeLocalInvoices(
  storage: Pick<Storage, "setItem">,
  invoices: LocalInvoice[],
) {
  const validated = z.array(localInvoiceSchema).parse(invoices).slice(0, 100);
  storage.setItem(ONCHAIN_INVOICE_STORAGE_KEY, JSON.stringify(validated));
}

export function upsertLocalInvoice(
  storage: Pick<Storage, "getItem" | "setItem">,
  invoice: LocalInvoice,
): LocalInvoice[] {
  const validated = localInvoiceSchema.parse(invoice);
  const invoices = readLocalInvoices(storage).filter(
    (entry) =>
      !(
        entry.merchant.toLowerCase() === validated.merchant.toLowerCase() &&
        entry.orderId.toLowerCase() === validated.orderId.toLowerCase()
      ),
  );
  const next = [validated, ...invoices];
  writeLocalInvoices(storage, next);
  return next;
}

export function decodeCreatedInvoice(
  receipt: Pick<TransactionReceipt, "logs" | "status" | "blockNumber">,
  expected: {
    factory: Address;
    merchant: Address;
    orderId: Hash;
    amountUnits: bigint;
    expiresAt: number;
    predictedVault: Address;
  },
) {
  if (receipt.status !== "success") throw new Error("Invoice transaction reverted");
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== expected.factory.toLowerCase()) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: checkoutFactoryAbi,
        data: log.data,
        topics: log.topics,
        eventName: "PaymentIntentCreated",
      });
    } catch {
      continue;
    }
    const args = decoded.args as unknown as {
      orderId: Hash;
      merchant: Address;
      vault: Address;
      payoutAddress: Address;
      expectedAmount: bigint;
      protocolFeeBps: number;
      expiresAt: bigint;
      metadataHash: Hash;
    };
    if (args.orderId.toLowerCase() !== expected.orderId.toLowerCase()) continue;
    if (args.merchant.toLowerCase() !== expected.merchant.toLowerCase())
      throw new Error("Receipt merchant does not match the connected wallet");
    if (args.expectedAmount !== expected.amountUnits)
      throw new Error("Receipt amount does not match the signed invoice");
    if (Number(args.expiresAt) !== expected.expiresAt)
      throw new Error("Receipt expiry does not match the signed invoice");
    if (args.vault.toLowerCase() !== expected.predictedVault.toLowerCase())
      throw new Error("Predicted and emitted invoice vaults do not match");
    return { ...args, blockNumber: receipt.blockNumber };
  }
  throw new Error("PaymentIntentCreated was not found in the confirmed receipt");
}

export function invoicePath(invoice: Pick<LocalInvoice, "merchant" | "orderReference">) {
  return `/invoices/${invoice.merchant}/${encodeURIComponent(invoice.orderReference)}`;
}

export function formatInvoiceAmount(amountUnits: string | bigint) {
  return formatUnits(BigInt(amountUnits), 6);
}

function isWalletRejection(error: unknown, depth = 0): boolean {
  if (depth > 6 || (typeof error !== "object" && typeof error !== "string"))
    return false;
  if (typeof error === "string")
    return /user rejected|rejected the request|denied/i.test(error);
  if (!error) return false;
  const record = error as Record<string, unknown>;
  if (record.code === 4001 || record.code === "4001") return true;
  for (const key of ["message", "shortMessage", "details"] as const) {
    if (
      typeof record[key] === "string" &&
      /user rejected|rejected the request|denied/i.test(record[key])
    )
      return true;
  }
  return isWalletRejection(record.cause, depth + 1);
}

export function friendlyContractError(error: unknown): string {
  if (isWalletRejection(error))
    return "The wallet request was rejected. You can safely try again.";
  if (error instanceof BaseError) {
    const rejection = error.walk((candidate) => isWalletRejection(candidate));
    if (isWalletRejection(rejection))
      return "The wallet request was rejected. You can safely try again.";
    const reverted = error.walk(
      (candidate) => candidate instanceof ContractFunctionRevertedError,
    );
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      const messages: Record<string, string> = {
        AlreadyRegistered: "This wallet is already registered as a merchant.",
        DuplicateOrderId:
          "This order ID has already been used by the connected merchant.",
        InvalidAmount: "The contract rejected the invoice amount.",
        InvalidExpiry: "Choose an expiry between 5 minutes and 30 days.",
        MerchantInactive: "Register or reactivate this merchant before creating an invoice.",
        ZeroAddress: "The payout address cannot be the zero address.",
        EnforcedPause: "New invoice creation is temporarily paused onchain.",
      };
      if (name && messages[name]) return messages[name];
    }
    return error.shortMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "The transaction could not be prepared. Please try again.";
}
