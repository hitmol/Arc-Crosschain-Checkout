import { describe, expect, it } from "vitest";
import { formatUsdc, parseUsdc } from "./index.js";

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
