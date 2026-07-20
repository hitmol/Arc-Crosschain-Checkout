import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { hashTypedData } from "viem";
import {
  paymentAuthorizationDomain,
  paymentAuthorizationTypes,
  verifyPaymentAuthorization,
  type PaymentAuthorizationMessage,
} from "./payment-authorization.js";

const payer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044976f7d2e5c70f6f87e6e57a7a66a7d7f2a0fcd45b5a",
);
const other = privateKeyToAccount(
  "0x8b3a350cf5c34c9194ca3a545d4f4d9f4d80b1e92b4c48f1fdbf6fcda8c3d4e7",
);
const message: PaymentAuthorizationMessage = {
  attemptId: `0x${"11".repeat(32)}`,
  sourceChainId: 84_532n,
  destinationChainId: 5_042_002n,
  invoiceVault: `0x${"22".repeat(20)}`,
  orderId: `0x${"33".repeat(32)}`,
  payer: payer.address,
  refundAddress: `0x${"44".repeat(20)}`,
  destinationAmount: 100_000_000n,
  maximumSourceAmount: 101_000_000n,
  quoteExpiresAt: 2_000_000_000n,
  nonce: 1n,
  attemptExpiresAt: 2_000_000_600n,
};

function typedData(value: PaymentAuthorizationMessage) {
  return {
    domain: paymentAuthorizationDomain(value.invoiceVault),
    types: paymentAuthorizationTypes,
    primaryType: "PaymentAuthorization" as const,
    message: value,
  };
}

describe("payment attempt EIP-712 authorization", () => {
  it("accepts the payer signature bound to the Arc vault", async () => {
    const signature = await payer.signTypedData(typedData(message));
    const digest = hashTypedData(typedData(message));
    await expect(
      verifyPaymentAuthorization({ message, signature, claimedDigest: digest }),
    ).resolves.toBe(digest);
  });

  it("rejects a different signer", async () => {
    const signature = await other.signTypedData(typedData(message));
    const digest = hashTypedData(typedData(message));
    await expect(
      verifyPaymentAuthorization({ message, signature, claimedDigest: digest }),
    ).rejects.toThrow("does not match the payer");
  });

  it("rejects cross-invoice digest reuse", async () => {
    const signature = await payer.signTypedData(typedData(message));
    const digest = hashTypedData(typedData(message));
    const changed = {
      ...message,
      invoiceVault: `0x${"55".repeat(20)}` as const,
    };
    await expect(
      verifyPaymentAuthorization({
        message: changed,
        signature,
        claimedDigest: digest,
      }),
    ).rejects.toThrow("digest does not match");
  });
});
