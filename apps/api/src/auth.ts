import { createHash, randomBytes } from "node:crypto";
import { verifyMessage, type Address, type Hex } from "viem";

export const AUTH_COOKIE_NAME = "arc_checkout_session";
export const AUTH_CHAIN_ID = 5_042_002;
export const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
export const AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

export const apiKeyScopes = [
  "merchant:read",
  "payment-intents:write",
  "webhooks:read",
  "webhooks:write",
] as const;

export type ApiKeyScope = (typeof apiKeyScopes)[number];

export type AuthPrincipal = {
  kind: "session" | "api-key";
  walletAddress: string;
  merchantId: string | null;
  scopes: readonly string[];
};

export type StoredChallenge = {
  id: string;
  walletAddress: string;
  chainId: number;
  domain: string;
  nonceHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: 401 | 403 | 409 = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function hashOpaqueSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createApiKey(): { raw: string; prefix: string; hash: string } {
  const secret = createOpaqueToken(32);
  const prefix = `ack_${createOpaqueToken(6)}`;
  const raw = `${prefix}_${secret}`;
  return { raw, prefix, hash: hashOpaqueSecret(raw) };
}

export function buildMerchantSignInMessage(input: {
  id: string;
  walletAddress: string;
  chainId: number;
  domain: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
  uri: string;
}): string {
  return `${input.domain} wants you to sign in with your Ethereum account:\n${input.walletAddress}\n\nSign in to SettleLink.\n\nURI: ${input.uri}\nVersion: 1\nChain ID: ${input.chainId}\nNonce: ${input.nonce}\nIssued At: ${input.issuedAt.toISOString()}\nExpiration Time: ${input.expiresAt.toISOString()}\nRequest ID: ${input.id}`;
}

export async function verifyAuthChallenge(input: {
  challenge: StoredChallenge;
  nonce: string;
  signature: Hex;
  uri: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  if (input.challenge.usedAt)
    throw new AuthError("Authentication challenge has already been used", 409);
  if (input.challenge.expiresAt <= now)
    throw new AuthError("Authentication challenge has expired");
  if (hashOpaqueSecret(input.nonce) !== input.challenge.nonceHash)
    throw new AuthError("Authentication challenge is invalid");

  const message = buildMerchantSignInMessage({
    id: input.challenge.id,
    walletAddress: input.challenge.walletAddress,
    chainId: input.challenge.chainId,
    domain: input.challenge.domain,
    nonce: input.nonce,
    issuedAt: input.challenge.createdAt,
    expiresAt: input.challenge.expiresAt,
    uri: input.uri,
  });
  const valid = await verifyMessage({
    address: input.challenge.walletAddress as Address,
    message,
    signature: input.signature,
  });
  if (!valid) throw new AuthError("Wallet signature does not match challenge");
}

export function parseCookieHeader(
  header: string | undefined,
): Map<string, string> {
  const values = new Map<string, string>();
  for (const pair of header?.split(";") ?? []) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const key = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (key) values.set(key, decodeURIComponent(value));
  }
  return values;
}

export function assertMerchantScope(
  principal: AuthPrincipal,
  requestedWallet: string,
): void {
  if (principal.walletAddress !== requestedWallet.toLowerCase())
    throw new AuthError(
      "Authenticated merchant cannot access this wallet",
      403,
    );
}

export function requireScope(
  principal: AuthPrincipal,
  scope: ApiKeyScope,
): void {
  if (principal.kind === "api-key" && !principal.scopes.includes(scope))
    throw new AuthError(`API key is missing scope: ${scope}`, 403);
}
