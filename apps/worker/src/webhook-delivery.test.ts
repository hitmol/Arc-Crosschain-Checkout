import { describe, expect, it } from "vitest";
import { webhookRetryDelayMs } from "./webhook-delivery.js";

describe("webhook retry policy", () => {
  it("uses bounded exponential backoff", () => {
    expect(webhookRetryDelayMs(1)).toBe(2_000);
    expect(webhookRetryDelayMs(4)).toBe(16_000);
    expect(webhookRetryDelayMs(20)).toBe(300_000);
  });
});
