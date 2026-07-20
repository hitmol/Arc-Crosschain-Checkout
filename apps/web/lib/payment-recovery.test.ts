import { describe, expect, it } from "vitest";
import {
  isPermanentAttemptFailure,
  recoveryStep,
  refundIsPermitted,
} from "./payment-recovery";

describe("payment recovery", () => {
  it("maps persisted backend states without regressing a settled invoice", () => {
    expect(recoveryStep("BURN_SUBMITTED", "PARTIALLY_FUNDED")).toBe(4);
    expect(recoveryStep("RECOVERABLE", "PARTIALLY_FUNDED")).toBe(5);
    expect(recoveryStep("ARC_MINTED", "FUNDED")).toBe(6);
    expect(recoveryStep("BURN_SUBMITTED", "SETTLED")).toBe(8);
  });

  it("distinguishes a retryable bridge from a permanent failure", () => {
    expect(isPermanentAttemptFailure("FAILED", false)).toBe(true);
    expect(isPermanentAttemptFailure("FAILED", true)).toBe(false);
    expect(isPermanentAttemptFailure("RECOVERABLE", true)).toBe(false);
  });

  it("permits permissionless refunds only after cancellation or expiry", () => {
    expect(refundIsPermitted("CANCELLED", "2030-01-01T00:00:00Z", 0)).toBe(
      true,
    );
    expect(refundIsPermitted("OPEN", "2020-01-01T00:00:00Z", Date.now())).toBe(
      true,
    );
    expect(refundIsPermitted("OPEN", "2030-01-01T00:00:00Z", 0)).toBe(false);
  });
});
