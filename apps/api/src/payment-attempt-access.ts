import { timingSafeEqual } from "node:crypto";
import { hashOpaqueSecret } from "./auth.js";

const clientStatuses = [
  "QUOTED",
  "REGISTERED",
  "APPROVING",
  "BURN_SUBMITTED",
  "RECOVERABLE",
] as const;

type ClientStatus = (typeof clientStatuses)[number];

const transitions: Record<ClientStatus, readonly ClientStatus[]> = {
  QUOTED: ["REGISTERED"],
  REGISTERED: ["REGISTERED", "APPROVING", "BURN_SUBMITTED", "RECOVERABLE"],
  APPROVING: ["APPROVING", "BURN_SUBMITTED", "RECOVERABLE"],
  BURN_SUBMITTED: ["BURN_SUBMITTED", "RECOVERABLE"],
  RECOVERABLE: ["BURN_SUBMITTED", "RECOVERABLE"],
};

export function verifyAttemptSecret(
  suppliedSecret: string | undefined,
  storedHash: string | null,
): boolean {
  if (!suppliedSecret || !storedHash) return false;
  const actual = Buffer.from(hashOpaqueSecret(suppliedSecret), "hex");
  const expected = Buffer.from(storedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function assertClientStatusTransition(
  currentStatus: string,
  nextStatus: ClientStatus,
): void {
  if (!clientStatuses.includes(currentStatus as ClientStatus))
    throw new Error("Payment attempt is already controlled by reconciliation");
  if (!transitions[currentStatus as ClientStatus].includes(nextStatus))
    throw new Error(
      `Invalid payment attempt transition: ${currentStatus} -> ${nextStatus}`,
    );
}
