import { z } from "zod";

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");
export const bytes32Schema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid bytes32 value");
export const usdcAmountSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)(\.\d{1,6})?$/,
    "Use a positive USDC amount with at most 6 decimals",
  )
  .refine((value) => parseUsdc(value) > 0n, "Amount must be greater than zero");

export const orderIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) => new TextEncoder().encode(value).length <= 32,
    "Order ID is longer than 32 UTF-8 bytes",
  );

export const paymentIntentInputSchema = z.object({
  merchantAddress: addressSchema,
  orderId: orderIdSchema,
  amount: usdcAmountSchema,
  expiresAt: z.string().datetime(),
  description: z.string().trim().max(280).optional(),
  metadata: z.record(z.string(), z.string().max(500)).optional(),
  vaultAddress: addressSchema.optional(),
  createTransactionHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
});

export const paymentAttemptInputSchema = z.object({
  attemptId: bytes32Schema,
  invoiceVault: addressSchema,
  orderId: orderIdSchema,
  sourceChainId: z.union([z.literal(84532), z.literal(11155111)]),
  destinationChainId: z.literal(5_042_002),
  customerAddress: addressSchema,
  refundAddress: addressSchema,
  destinationAmount: usdcAmountSchema,
  quotedSourceAmount: usdcAmountSchema,
  maximumSourceAmount: usdcAmountSchema,
  quoteExpiresAt: z.string().datetime(),
  nonce: z
    .string()
    .regex(/^\d+$/)
    .max(78)
    .refine((value) => BigInt(value) <= 2n ** 256n - 1n, "Exceeds uint256"),
  attemptExpiresAt: z.string().datetime(),
  authorizationDigest: bytes32Schema,
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/),
  registeredTransactionHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  sourceTransactionHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
});

export const webhookInputSchema = z.object({
  merchantAddress: addressSchema,
  url: z.string().url().max(2048),
  events: z
    .array(
      z.enum([
        "payment.intent.created",
        "payment.source_confirmed",
        "payment.arc_minted",
        "payment.settled",
        "payment.expired",
        "payment.refunded",
      ]),
    )
    .min(1),
});

export type PaymentIntentInput = z.infer<typeof paymentIntentInputSchema>;
export type PaymentAttemptInput = z.infer<typeof paymentAttemptInputSchema>;
export type WebhookInput = z.infer<typeof webhookInputSchema>;

export type PaymentStatus =
  | "OPEN"
  | "PARTIALLY_FUNDED"
  | "FUNDED"
  | "SETTLING"
  | "SETTLED"
  | "REFUNDED"
  | "CANCELLED"
  | "EXPIRED";

export function parseUsdc(value: string): bigint {
  const normalized = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(normalized))
    throw new Error("Invalid USDC amount");
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
}

export function formatUsdc(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ".00"}`;
}

export function orderIdToBytes32(orderId: string): `0x${string}` {
  const bytes = new TextEncoder().encode(orderId);
  if (bytes.length > 32)
    throw new Error("Order ID is longer than 32 UTF-8 bytes");
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0")}`;
}

export function toPublicId(): string {
  return crypto.randomUUID();
}
