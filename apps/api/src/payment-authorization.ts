import {
  hashTypedData,
  isAddressEqual,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { DEFAULT_PRODUCT_NAME } from "@arc-checkout/shared";

export const paymentAuthorizationTypes = {
  PaymentAuthorization: [
    { name: "attemptId", type: "bytes32" },
    { name: "sourceChainId", type: "uint256" },
    { name: "destinationChainId", type: "uint256" },
    { name: "invoiceVault", type: "address" },
    { name: "orderId", type: "bytes32" },
    { name: "payer", type: "address" },
    { name: "refundAddress", type: "address" },
    { name: "destinationAmount", type: "uint256" },
    { name: "maximumSourceAmount", type: "uint256" },
    { name: "quoteExpiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "attemptExpiresAt", type: "uint64" },
  ],
} as const;

export type PaymentAuthorizationMessage = {
  attemptId: Hex;
  sourceChainId: bigint;
  destinationChainId: bigint;
  invoiceVault: Address;
  orderId: Hex;
  payer: Address;
  refundAddress: Address;
  destinationAmount: bigint;
  maximumSourceAmount: bigint;
  quoteExpiresAt: bigint;
  nonce: bigint;
  attemptExpiresAt: bigint;
};

export function paymentAuthorizationDomain(invoiceVault: Address) {
  return {
    name: DEFAULT_PRODUCT_NAME,
    version: "1",
    chainId: 5_042_002,
    verifyingContract: invoiceVault,
  } as const;
}

export async function verifyPaymentAuthorization(input: {
  message: PaymentAuthorizationMessage;
  signature: Hex;
  claimedDigest: Hex;
}): Promise<Hex> {
  const typedData = {
    domain: paymentAuthorizationDomain(input.message.invoiceVault),
    types: paymentAuthorizationTypes,
    primaryType: "PaymentAuthorization" as const,
    message: input.message,
  };
  const digest = hashTypedData(typedData);
  if (digest.toLowerCase() !== input.claimedDigest.toLowerCase()) {
    throw new Error("Authorization digest does not match the signed attempt");
  }
  const recovered = await recoverTypedDataAddress({
    ...typedData,
    signature: input.signature,
  });
  if (!isAddressEqual(recovered, input.message.payer)) {
    throw new Error("Payment attempt signature does not match the payer");
  }
  return digest;
}
