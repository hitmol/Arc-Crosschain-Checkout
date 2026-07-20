import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, signWebhook } from "./security.js";

describe("webhook security", () => {
  it("encrypts webhook secrets at rest", () => {
    const encrypted = encryptSecret("whsec_test");
    expect(encrypted).not.toContain("whsec_test");
    expect(decryptSecret(encrypted)).toBe("whsec_test");
  });

  it("signs timestamp and raw body", () => {
    expect(signWebhook("secret", "1700000000", "{}")).toBe(
      "b8569b78799ff9e3cbff0fc2d63a33a2b57f3282abd07c37ae5e8e7d79a5f163",
    );
  });
});
