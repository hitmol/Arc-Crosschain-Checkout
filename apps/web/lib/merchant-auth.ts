import type { Address, Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { apiFetch } from "./api";

type SessionResponse = {
  authenticated: boolean;
  walletAddress?: string;
};

type ChallengeResponse = {
  id: string;
  nonce: string;
  message: string;
  expiresAt: string;
};

export async function ensureMerchantSession(
  walletAddress: Address,
  signMessage: (message: string) => Promise<Hex>,
): Promise<void> {
  try {
    const session = await apiFetch<SessionResponse>("/api/auth/session");
    if (
      session.authenticated &&
      session.walletAddress?.toLowerCase() === walletAddress.toLowerCase()
    )
      return;
  } catch {
    // A missing or expired session is expected before the first sign-in.
  }

  const challenge = await apiFetch<ChallengeResponse>("/api/auth/challenge", {
    method: "POST",
    body: JSON.stringify({
      walletAddress,
      chainId: arcTestnet.id,
      domain: window.location.host,
    }),
  });
  const signature = await signMessage(challenge.message);
  await apiFetch<SessionResponse>("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeId: challenge.id,
      nonce: challenge.nonce,
      signature,
    }),
  });
}
