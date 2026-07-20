import { describe, expect, it } from "vitest";
import { calculateQuote } from "./index.js";

describe("CCTP checkout quote", () => {
  it("grosses up the source amount so the vault receives the invoice amount", () => {
    const quote = calculateQuote("100.00", 1.3, 50_000n, 1_500);
    expect(quote.protocolFeeSubunits).toBe(13_000n);
    expect(quote.forwardFeeSubunits).toBe(50_000n);
    expect(quote.maxFeeSubunits).toBe(72_450n);
    expect(quote.totalSourceAmountSubunits).toBe(100_072_450n);
  });
});
