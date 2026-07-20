import {
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  CctpReconciliationError,
  validateSourceTransaction,
  validatedArcMintAmount,
} from "./cctp-reconciliation.js";

const hash = `0x${"11".repeat(32)}` as const;
const payer = "0x1111111111111111111111111111111111111111" as const;
const vault = "0x2222222222222222222222222222222222222222" as const;
const usdc = "0x3600000000000000000000000000000000000000" as const;

describe("CCTP receipt reconciliation", () => {
  it("waits for required source confirmations and verifies the payer", () => {
    const base = {
      receipt: { status: "success", blockNumber: 100n, transactionHash: hash },
      transaction: { from: payer, hash },
      expectedHash: hash,
      expectedPayer: payer,
      requiredConfirmations: 2,
    } as const;
    expect(validateSourceTransaction({ ...base, headBlock: 100n })).toBe(false);
    expect(validateSourceTransaction({ ...base, headBlock: 101n })).toBe(true);
    expect(() =>
      validateSourceTransaction({
        ...base,
        headBlock: 101n,
        expectedPayer: vault,
      }),
    ).toThrow(CctpReconciliationError);
  });

  it("requires the exact forwarded USDC amount in the Arc vault", () => {
    const topics = encodeEventTopics({
      abi: [
        {
          type: "event",
          name: "Transfer",
          inputs: [
            { type: "address", name: "from", indexed: true },
            { type: "address", name: "to", indexed: true },
            { type: "uint256", name: "value", indexed: false },
          ],
        },
      ],
      eventName: "Transfer",
      args: { from: payer, to: vault },
    });
    const receipt = {
      status: "success",
      logs: [
        {
          address: usdc,
          topics,
          data: encodeAbiParameters(parseAbiParameters("uint256"), [
            1_000_000n,
          ]),
        },
      ],
    } as never;
    expect(
      validatedArcMintAmount({
        receipt,
        usdc,
        vault,
        expectedAmount: 1_000_000n,
      }),
    ).toBe(1_000_000n);
    expect(() =>
      validatedArcMintAmount({
        receipt,
        usdc,
        vault,
        expectedAmount: 999_999n,
      }),
    ).toThrow(CctpReconciliationError);
  });
});
