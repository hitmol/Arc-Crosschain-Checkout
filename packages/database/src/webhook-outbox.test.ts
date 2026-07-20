import { describe, expect, it } from "vitest";
import {
  chainWebhookEventId,
  lifecycleWebhookEventId,
} from "./webhook-outbox.js";

describe("webhook event identities", () => {
  it("derives finalized chain event IDs from the immutable log identity", () => {
    expect(
      chainWebhookEventId({
        eventType: "payment.settled",
        chainId: 5_042_002,
        transactionHash:
          "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        logIndex: 7,
      }),
    ).toBe(
      "payment.settled:5042002:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:7",
    );
  });

  it("normalizes lifecycle identities for retry-safe deduplication", () => {
    expect(
      lifecycleWebhookEventId({
        eventType: "payment.arc_minted",
        identity:
          "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      }),
    ).toBe(
      "payment.arc_minted:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
  });
});
