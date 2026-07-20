import {
  CCTP_FAST_FINALITY_THRESHOLD,
  CIRCLE_IRIS_SANDBOX,
  chainsById,
} from "@arc-checkout/chain-config";
import { formatUsdc, parseUsdc } from "@arc-checkout/shared";
import { z } from "zod";

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

const messageResponseSchema = z.object({
  messages: z.array(
    z.object({
      status: z.string(),
      message: z.string().optional(),
      attestation: z.string().optional(),
      eventNonce: z.string().optional(),
      messageHash: z.string().optional(),
      forwardTxHash: z.string().optional(),
    }),
  ),
});

export interface CheckoutQuote {
  requestedAmount: string;
  requestedAmountSubunits: bigint;
  protocolFeeSubunits: bigint;
  forwardFeeSubunits: bigint;
  feeBufferSubunits: bigint;
  maxFeeSubunits: bigint;
  totalSourceAmountSubunits: bigint;
  totalSourceAmount: string;
  expiresAt: string;
  finalityThreshold: number;
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
    totalSourceAmountSubunits: total,
    totalSourceAmount: formatUsdc(total),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    finalityThreshold: CCTP_FAST_FINALITY_THRESHOLD,
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

export async function fetchCctpMessage(
  sourceChainId: number,
  transactionHash: string,
  baseUrl = CIRCLE_IRIS_SANDBOX,
  signal?: AbortSignal,
) {
  const source = chainsById.get(sourceChainId);
  if (!source || !/^0x[a-fA-F0-9]{64}$/.test(transactionHash))
    throw new Error("Invalid source chain or transaction hash");
  const response = await fetch(
    `${baseUrl}/v2/messages/${source.cctpDomain}?transactionHash=${transactionHash}`,
    { ...(signal ? { signal } : {}), headers: { Accept: "application/json" } },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Circle message lookup failed (${response.status})`);
  return messageResponseSchema.parse(await response.json()).messages[0] ?? null;
}
