import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "./index.js";

describe("verifyWebhookSignature", () => {
  it("accepts an authentic, fresh payload", () => {
    const timestamp = "1700000000";
    const rawBody = '{"ok":true}';
    const signature = createHmac("sha256", "secret")
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    expect(
      verifyWebhookSignature({
        secret: "secret",
        rawBody,
        timestamp,
        signature: `v1=${signature}`,
        now: 1700000000,
      }),
    ).toBe(true);
  });

  it("rejects replayed payloads", () => {
    expect(
      verifyWebhookSignature({
        secret: "secret",
        rawBody: "{}",
        timestamp: "1",
        signature: "v1=bad",
        now: 1700000000,
      }),
    ).toBe(false);
  });
});
