import { describe, expect, it } from "vitest";
import { hashOpaqueSecret } from "./auth.js";
import {
  assertClientStatusTransition,
  verifyAttemptSecret,
} from "./payment-attempt-access.js";

describe("payment attempt access", () => {
  it("verifies an opaque attempt secret against only its hash", () => {
    const secret = "attempt_secret_value";
    expect(verifyAttemptSecret(secret, hashOpaqueSecret(secret))).toBe(true);
    expect(verifyAttemptSecret("wrong", hashOpaqueSecret(secret))).toBe(false);
    expect(verifyAttemptSecret(undefined, hashOpaqueSecret(secret))).toBe(
      false,
    );
  });

  it("allows forward progress and recovery without allowing a reset", () => {
    expect(() =>
      assertClientStatusTransition("QUOTED", "REGISTERED"),
    ).not.toThrow();
    expect(() =>
      assertClientStatusTransition("REGISTERED", "BURN_SUBMITTED"),
    ).not.toThrow();
    expect(() =>
      assertClientStatusTransition("RECOVERABLE", "BURN_SUBMITTED"),
    ).not.toThrow();
    expect(() =>
      assertClientStatusTransition("BURN_SUBMITTED", "REGISTERED"),
    ).toThrow();
    expect(() =>
      assertClientStatusTransition("SOURCE_CONFIRMED", "RECOVERABLE"),
    ).toThrow();
  });
});
