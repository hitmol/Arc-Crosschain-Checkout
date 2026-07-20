import {
  CCTP_FAST_FINALITY_THRESHOLD,
  CIRCLE_IRIS_SANDBOX,
  FORWARDING_HOOK_DATA,
  chainsById,
} from "@arc-checkout/chain-config";
import { formatUsdc, parseUsdc } from "@arc-checkout/shared";
import {
  getAddress,
  hexToBigInt,
  hexToNumber,
  isAddressEqual,
  keccak256,
  size,
  slice,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";

const transactionHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const hexSchema = z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/);
const decimalSchema = z.string().regex(/^\d+$/);

const feeQuoteSchema = z.array(
  z.object({
    finalityThreshold: z.number(),
    minimumFee: z.number().nonnegative(),
    forwardFee: z
      .object({
        min: z.number().nonnegative(),
        med: z.number().nonnegative(),
        max: z.number().nonnegative(),
      })
      .optional(),
  }),
);

const irisMessageSchema = z
  .object({
    status: z.string(),
    message: hexSchema,
    attestation: z.union([hexSchema, z.literal("PENDING")]).optional(),
    eventNonce: decimalSchema.optional(),
    messageHash: transactionHashSchema.optional(),
    cctpVersion: z.number().int().optional(),
    forwardState: z.string().optional(),
    forwardTxHash: transactionHashSchema.optional(),
    decodedMessage: z.unknown().optional(),
  })
  .passthrough();

const messageResponseSchema = z.object({
  messages: z.array(irisMessageSchema),
  sourceTxHash: transactionHashSchema.optional(),
});

export type IrisCctpMessage = z.infer<typeof irisMessageSchema>;

export interface CheckoutQuote {
  requestedAmount: string;
  requestedAmountSubunits: bigint;
  protocolFeeSubunits: bigint;
  forwardFeeSubunits: bigint;
  feeBufferSubunits: bigint;
  maxFeeSubunits: bigint;
  maxFee: string;
  totalSourceAmountSubunits: bigint;
  totalSourceAmount: string;
  expiresAt: string;
  finalityThreshold: number;
  transferSpeed: "FAST";
}

export interface ParsedCctpMessage {
  messageHash: Hex;
  sourceDomain: number;
  destinationDomain: number;
  nonce: Hex;
  sender: Address;
  recipient: Address;
  destinationCaller: Address;
  minFinalityThreshold: number;
  finalityThresholdExecuted: number;
  burnToken: Address;
  mintRecipient: Address;
  burnAmount: bigint;
  sourceSender: Address;
  maxFee: bigint;
  feeExecuted: bigint;
  expirationBlock: bigint;
  hookData: Hex;
}

export interface CctpMessageExpectation {
  sourceChainId: number;
  sourceTransactionHash: Hex;
  destinationChainId: 5_042_002;
  mintRecipient: Address;
  sourceSender: Address;
  burnAmount: bigint;
  minimumDestinationAmount: bigint;
  maxFee: bigint;
  finalityThreshold: number;
}

export interface ValidatedCctpMessage extends ParsedCctpMessage {
  sourceChainId: number;
  sourceTransactionHash: Hex;
  eventNonce: string | null;
  destinationAmount: bigint;
  status: string;
  attestation: Hex | null;
  forwardState: string | null;
  forwardTxHash: Hex | null;
  rawMessage: Hex;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function bpsToHundredths(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new Error("Invalid fee rate");
  return BigInt(Math.ceil(value * 100));
}

export function calculateQuote(
  requestedAmount: string,
  minimumFeeBps: number,
  forwardFeeSubunits: bigint,
  bufferBps = 1_500,
): CheckoutQuote {
  const requested = parseUsdc(requestedAmount);
  const protocolFee = ceilDiv(
    requested * bpsToHundredths(minimumFeeBps),
    1_000_000n,
  );
  const rawFee = protocolFee + forwardFeeSubunits;
  const buffer = ceilDiv(rawFee * BigInt(bufferBps), 10_000n);
  const maxFee = rawFee + buffer;
  const total = requested + maxFee;
  return {
    requestedAmount,
    requestedAmountSubunits: requested,
    protocolFeeSubunits: protocolFee,
    forwardFeeSubunits,
    feeBufferSubunits: buffer,
    maxFeeSubunits: maxFee,
    maxFee: formatUsdc(maxFee),
    totalSourceAmountSubunits: total,
    totalSourceAmount: formatUsdc(total),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    finalityThreshold: CCTP_FAST_FINALITY_THRESHOLD,
    transferSpeed: "FAST",
  };
}

export async function fetchCheckoutQuote(
  sourceChainId: number,
  requestedAmount: string,
  baseUrl = CIRCLE_IRIS_SANDBOX,
  signal?: AbortSignal,
): Promise<CheckoutQuote> {
  const source = chainsById.get(sourceChainId);
  const destination = chainsById.get(5_042_002);
  if (!source || !destination || source.chainId === destination.chainId)
    throw new Error("Unsupported CCTP route");
  const url = `${baseUrl}/v2/burn/USDC/fees/${source.cctpDomain}/${destination.cctpDomain}?forward=true`;
  const response = await fetch(url, {
    ...(signal ? { signal } : {}),
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Circle fee quote failed (${response.status})`);
  const fees = feeQuoteSchema.parse(await response.json());
  const fast = fees.find(
    (fee) => fee.finalityThreshold === CCTP_FAST_FINALITY_THRESHOLD,
  );
  if (!fast?.forwardFee)
    throw new Error("Fast forwarding quote is unavailable");
  return calculateQuote(
    requestedAmount,
    fast.minimumFee,
    BigInt(fast.forwardFee.med),
  );
}

export async function fetchCctpMessages(
  sourceChainId: number,
  transactionHash: string,
  baseUrl = CIRCLE_IRIS_SANDBOX,
  signal?: AbortSignal,
) {
  const source = chainsById.get(sourceChainId);
  if (!source || !transactionHashSchema.safeParse(transactionHash).success)
    throw new Error("Invalid source chain or transaction hash");
  const response = await fetch(
    `${baseUrl}/v2/messages/${source.cctpDomain}?transactionHash=${transactionHash}`,
    { ...(signal ? { signal } : {}), headers: { Accept: "application/json" } },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Circle message lookup failed (${response.status})`);
  const parsed = messageResponseSchema.parse(await response.json());
  if (
    parsed.sourceTxHash &&
    parsed.sourceTxHash.toLowerCase() !== transactionHash.toLowerCase()
  ) {
    throw new Error(
      "Circle response source transaction does not match request",
    );
  }
  return parsed;
}

function uint32At(value: Hex, offset: number): number {
  return hexToNumber(slice(value, offset, offset + 4));
}

function uint256At(value: Hex, offset: number): bigint {
  return hexToBigInt(slice(value, offset, offset + 32));
}

function addressAt(value: Hex, offset: number): Address {
  const word = slice(value, offset, offset + 32);
  return getAddress(`0x${word.slice(-40)}`);
}

export function parseCctpMessage(rawMessage: string): ParsedCctpMessage {
  const message = hexSchema.parse(rawMessage) as Hex;
  const bodyOffset = 148;
  const minimumSize = bodyOffset + 228;
  if (size(message) < minimumSize)
    throw new Error("CCTP V2 message is truncated");
  const version = uint32At(message, 0);
  const bodyVersion = uint32At(message, bodyOffset);
  if (version !== 1 || bodyVersion !== 1)
    throw new Error("Unsupported CCTP message version");

  return {
    messageHash: keccak256(message),
    sourceDomain: uint32At(message, 4),
    destinationDomain: uint32At(message, 8),
    nonce: slice(message, 12, 44),
    sender: addressAt(message, 44),
    recipient: addressAt(message, 76),
    destinationCaller: addressAt(message, 108),
    minFinalityThreshold: uint32At(message, 140),
    finalityThresholdExecuted: uint32At(message, 144),
    burnToken: addressAt(message, bodyOffset + 4),
    mintRecipient: addressAt(message, bodyOffset + 36),
    burnAmount: uint256At(message, bodyOffset + 68),
    sourceSender: addressAt(message, bodyOffset + 100),
    maxFee: uint256At(message, bodyOffset + 132),
    feeExecuted: uint256At(message, bodyOffset + 164),
    expirationBlock: uint256At(message, bodyOffset + 196),
    hookData: slice(message, bodyOffset + 228),
  };
}

export function validateCctpMessage(
  irisMessage: IrisCctpMessage,
  expected: CctpMessageExpectation,
): ValidatedCctpMessage {
  const source = chainsById.get(expected.sourceChainId);
  const destination = chainsById.get(expected.destinationChainId);
  if (!source || !destination || destination.cctpDomain !== 26)
    throw new Error("Unsupported CCTP route");
  if (irisMessage.cctpVersion !== undefined && irisMessage.cctpVersion !== 2)
    throw new Error("Circle response is not CCTP V2");

  const parsed = parseCctpMessage(irisMessage.message);
  if (parsed.sourceDomain !== source.cctpDomain)
    throw new Error("CCTP source domain mismatch");
  if (parsed.destinationDomain !== destination.cctpDomain)
    throw new Error("CCTP destination domain mismatch");
  if (!isAddressEqual(parsed.sender, source.tokenMessengerV2 as Address))
    throw new Error("CCTP header sender is not the source TokenMessenger V2");
  if (
    !isAddressEqual(parsed.recipient, destination.tokenMessengerV2 as Address)
  )
    throw new Error(
      "CCTP header recipient is not the destination TokenMessenger V2",
    );
  if (!isAddressEqual(parsed.destinationCaller, zeroAddress))
    throw new Error(
      "CCTP destination caller would block the forwarding service",
    );
  if (!isAddressEqual(parsed.burnToken, source.usdc as Address))
    throw new Error("CCTP burn token is not native USDC");
  if (!isAddressEqual(parsed.mintRecipient, expected.mintRecipient))
    throw new Error("CCTP mint recipient does not match invoice vault");
  if (!isAddressEqual(parsed.sourceSender, expected.sourceSender))
    throw new Error("CCTP source sender does not match payer");
  if (parsed.burnAmount !== expected.burnAmount)
    throw new Error("CCTP burn amount does not match payment attempt");
  if (parsed.maxFee !== expected.maxFee)
    throw new Error("CCTP maximum fee does not match quote");
  if (parsed.minFinalityThreshold !== expected.finalityThreshold)
    throw new Error("CCTP finality threshold does not match quote");
  if (parsed.finalityThresholdExecuted < parsed.minFinalityThreshold)
    throw new Error("CCTP executed finality is below the authorized threshold");
  if (parsed.hookData.toLowerCase() !== FORWARDING_HOOK_DATA.toLowerCase())
    throw new Error("CCTP forwarding hook is invalid");
  if (
    parsed.feeExecuted > parsed.maxFee ||
    parsed.feeExecuted > parsed.burnAmount
  )
    throw new Error("CCTP executed fee exceeds authorized bounds");
  const destinationAmount = parsed.burnAmount - parsed.feeExecuted;
  if (destinationAmount < expected.minimumDestinationAmount)
    throw new Error("CCTP destination amount is below invoice amount");
  if (
    irisMessage.messageHash &&
    irisMessage.messageHash.toLowerCase() !== parsed.messageHash.toLowerCase()
  ) {
    throw new Error("Circle message hash does not match raw message");
  }

  return {
    ...parsed,
    sourceChainId: expected.sourceChainId,
    sourceTransactionHash: expected.sourceTransactionHash,
    eventNonce: irisMessage.eventNonce ?? null,
    destinationAmount,
    status: irisMessage.status,
    attestation: irisMessage.attestation?.startsWith("0x")
      ? (irisMessage.attestation as Hex)
      : null,
    forwardState: irisMessage.forwardState ?? null,
    forwardTxHash: (irisMessage.forwardTxHash as Hex | undefined) ?? null,
    rawMessage: irisMessage.message as Hex,
  };
}

export function selectCctpMessage(
  messages: IrisCctpMessage[],
  expected: CctpMessageExpectation,
): ValidatedCctpMessage {
  const matches: ValidatedCctpMessage[] = [];
  for (const message of messages) {
    try {
      matches.push(validateCctpMessage(message, expected));
    } catch {
      // A transaction may contain unrelated CCTP messages. Only a complete
      // identity match can be attached to this payment attempt.
    }
  }
  if (matches.length === 0)
    throw new Error("No CCTP message matches the payment attempt");
  if (matches.length !== 1)
    throw new Error("Multiple CCTP messages match the payment attempt");
  return matches[0]!;
}
