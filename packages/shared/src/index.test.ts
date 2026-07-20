import { describe, expect, it } from "vitest";
import {
  formatUsdc,
  orderIdToBytes32,
  parseUsdc,
  paymentIntentInputSchema,
} from "./index.js";

describe("USDC amount utilities", () => {
  it("round trips six-decimal values", () => {
    expect(parseUsdc("123.456789")).toBe(123_456_789n);
    expect(formatUsdc(123_456_789n)).toBe("123.456789");
  });

  it("never treats USDC as an 18-decimal application token", () => {
    expect(parseUsdc("1")).toBe(1_000_000n);
    expect(() => parseUsdc("1.0000001")).toThrow();
  });
});

describe("order IDs", () => {
  it("accepts up to 32 UTF-8 bytes", () => {
    expect(orderIdToBytes32("é".repeat(16))).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("rejects values over 32 UTF-8 bytes even when character count is lower", () => {
    const result = paymentIntentInputSchema.safeParse({
      merchantAddress: "0x1111111111111111111111111111111111111111",
      orderId: "é".repeat(17),
      amount: "1.00",
      expiresAt: "2026-07-21T00:00:00.000Z",
      refundAddress: "0x2222222222222222222222222222222222222222",
    });
    expect(result.success).toBe(false);
  });
});
