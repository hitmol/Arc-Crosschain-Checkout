import { describe, expect, it } from "vitest";
import { resolvePublicCapabilities } from "./capabilities";

describe("public application capabilities", () => {
  it("keeps onchain invoice creation enabled without an API", () => {
    expect(resolvePublicCapabilities(null)).toEqual({
      publicOnchainMode: true,
      backendEnabled: false,
      merchantAuthenticationEnabled: false,
      onchainInvoiceCreationEnabled: true,
      localInvoiceHistoryEnabled: true,
      cctpPublicPaymentEnabled: false,
    });
  });

  it("enables only backend-dependent capabilities when an API exists", () => {
    const capabilities = resolvePublicCapabilities("https://api.example.com");
    expect(capabilities.backendEnabled).toBe(true);
    expect(capabilities.merchantAuthenticationEnabled).toBe(true);
    expect(capabilities.onchainInvoiceCreationEnabled).toBe(true);
    expect(capabilities.cctpPublicPaymentEnabled).toBe(false);
  });
});
