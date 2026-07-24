const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const sameOriginApiEnabled =
  process.env.NEXT_PUBLIC_CCTP_ENABLED?.trim() === "true";

export const API_URL = configuredApiUrl || (sameOriginApiEnabled ? "" : null);
export const PUBLIC_READ_ONLY_MODE = API_URL === null;

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (API_URL === null) {
    throw new Error(
      "The merchant backend is not enabled on this public builder preview. Verified contract and transaction evidence remain available on the Proof of Build page.",
    );
  }
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Request failed");
  return payload;
}

export function compactAddress(value?: string | null): string {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Pending";
}
