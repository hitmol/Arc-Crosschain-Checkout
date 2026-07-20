import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertMerchantScope,
  buildMerchantSignInMessage,
  createApiKey,
  hashOpaqueSecret,
  verifyAuthChallenge,
  type StoredChallenge,
} from "./auth.js";

const merchant = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const attacker = privateKeyToAccount(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
);

function challenge(overrides: Partial<StoredChallenge> = {}): StoredChallenge {
  return {
    id: "d98a7df0-a4ef-4e11-995a-96f9e6336913",
    walletAddress: merchant.address.toLowerCase(),
    chainId: 5_042_002,
    domain: "checkout.example",
    nonceHash: hashOpaqueSecret("nonce-that-is-long-enough"),
    expiresAt: new Date("2026-07-20T12:05:00.000Z"),
    usedAt: null,
    createdAt: new Date("2026-07-20T12:00:00.000Z"),
    ...overrides,
  };
}

async function signatureFor(
  stored: StoredChallenge,
  signer = merchant,
): Promise<`0x${string}`> {
  const message = buildMerchantSignInMessage({
    id: stored.id,
    walletAddress: stored.walletAddress,
    chainId: stored.chainId,
    domain: stored.domain,
    nonce: "nonce-that-is-long-enough",
    issuedAt: stored.createdAt,
    expiresAt: stored.expiresAt,
    uri: "https://checkout.example",
  });
  return signer.signMessage({ message });
}

describe("merchant wallet authentication", () => {
  it("accepts the wallet bound to the challenge", async () => {
    const stored = challenge();
    await expect(
      verifyAuthChallenge({
        challenge: stored,
        nonce: "nonce-that-is-long-enough",
        signature: await signatureFor(stored),
        uri: "https://checkout.example",
        now: new Date("2026-07-20T12:01:00.000Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects an invalid signer", async () => {
    const stored = challenge();
    await expect(
      verifyAuthChallenge({
        challenge: stored,
        nonce: "nonce-that-is-long-enough",
        signature: await signatureFor(stored, attacker),
        uri: "https://checkout.example",
        now: new Date("2026-07-20T12:01:00.000Z"),
      }),
    ).rejects.toThrow("Wallet signature does not match challenge");
  });

  it("rejects an expired challenge", async () => {
    const stored = challenge();
    await expect(
      verifyAuthChallenge({
        challenge: stored,
        nonce: "nonce-that-is-long-enough",
        signature: await signatureFor(stored),
        uri: "https://checkout.example",
        now: new Date("2026-07-20T12:06:00.000Z"),
      }),
    ).rejects.toThrow("expired");
  });

  it("rejects nonce replay", async () => {
    const stored = challenge({ usedAt: new Date("2026-07-20T12:01:00.000Z") });
    await expect(
      verifyAuthChallenge({
        challenge: stored,
        nonce: "nonce-that-is-long-enough",
        signature: await signatureFor(stored),
        uri: "https://checkout.example",
        now: new Date("2026-07-20T12:02:00.000Z"),
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("blocks cross-merchant access", () => {
    expect(() =>
      assertMerchantScope(
        {
          kind: "session",
          walletAddress: merchant.address.toLowerCase(),
          merchantId: "merchant-1",
          scopes: [],
        },
        attacker.address,
      ),
    ).toThrow("cannot access this wallet");
  });

  it("stores API keys as hashes and exposes only a prefix", () => {
    const key = createApiKey();
    expect(key.raw).toMatch(/^ack_/);
    expect(key.hash).toBe(hashOpaqueSecret(key.raw));
    expect(key.hash).not.toContain(key.raw);
    expect(key.prefix.length).toBeLessThan(key.raw.length);
  });
});
