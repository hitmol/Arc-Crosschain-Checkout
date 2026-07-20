import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { ArcCheckout, verifyWebhookSignature } from "./index.js";

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

describe("ArcCheckout API authentication", () => {
  it("sends scoped API keys as bearer credentials", async () => {
    let authorization: string | null = null;
    const requestFetch: typeof fetch = (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    };
    const checkout = new ArcCheckout({
      apiUrl: "https://checkout.example",
      apiKey: "ack_test_secret",
      fetch: requestFetch,
    });
    await checkout.paymentIntents.status("invoice-1");
    expect(authorization).toBe("Bearer ack_test_secret");
  });
});
