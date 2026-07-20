const attemptSteps: Record<string, number> = {
  QUOTED: 2,
  REGISTERED: 2,
  APPROVING: 3,
  BURN_SUBMITTED: 4,
  SOURCE_CONFIRMED: 4,
  ATTESTING: 5,
  RECOVERABLE: 5,
  ARC_MINTED: 6,
  SETTLING: 7,
  SETTLED: 8,
};

export function recoveryStep(attemptStatus: string, invoiceStatus: string) {
  if (invoiceStatus === "SETTLED") return 8;
  if (invoiceStatus === "SETTLING") return 7;
  return attemptSteps[attemptStatus] ?? 2;
}

export function isPermanentAttemptFailure(
  attemptStatus: string,
  bridgeRecoverable: boolean,
) {
  return attemptStatus === "FAILED" && !bridgeRecoverable;
}

export function refundIsPermitted(
  invoiceStatus: string,
  expiresAt: string,
  now = Date.now(),
) {
  return (
    invoiceStatus === "CANCELLED" ||
    invoiceStatus === "EXPIRED" ||
    Date.parse(expiresAt) <= now
  );
}
