import { describe, expect, it } from "vitest";
import { chainsByKey } from "./index.js";

describe("chain configuration", () => {
  it("uses the official Arc testnet identifiers", () => {
    expect(chainsByKey.arcTestnet.chainId).toBe(5_042_002);
    expect(chainsByKey.arcTestnet.cctpDomain).toBe(26);
    expect(chainsByKey.arcTestnet.usdc).toBe(
      "0x3600000000000000000000000000000000000000",
    );
  });
});
