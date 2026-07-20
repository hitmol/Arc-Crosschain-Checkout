import { describe, expect, it } from "vitest";
import {
  concatHex,
  keccak256,
  numberToHex,
  padHex,
  type Address,
  type Hex,
} from "viem";
import {
  calculateQuote,
  parseCctpMessage,
  selectCctpMessage,
  validateCctpMessage,
  type CctpMessageExpectation,
  type IrisCctpMessage,
} from "./index.js";

const sourceUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const payer = "0x1111111111111111111111111111111111111111";
const vault = "0x2222222222222222222222222222222222222222";
const tokenMessenger = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const forwardHook =
  "0x636374702d666f72776172640000000000000000000000000000000000000000" as const;

function word(value: bigint | number): Hex {
  return numberToHex(value, { size: 32 });
}

function addressWord(value: Address): Hex {
  return padHex(value, { size: 32 });
}

function makeRawMessage(
  overrides: {
    destinationDomain?: number;
    sender?: Address;
    recipient?: Address;
    destinationCaller?: Address;
    burnToken?: Address;
    mintRecipient?: Address;
    sourceSender?: Address;
    burnAmount?: bigint;
    maxFee?: bigint;
    feeExecuted?: bigint;
    finalityThreshold?: number;
    executedFinalityThreshold?: number;
    nonce?: Hex;
  } = {},
): Hex {
  const finalityThreshold = overrides.finalityThreshold ?? 1_000;
  return concatHex([
    numberToHex(1, { size: 4 }),
    numberToHex(6, { size: 4 }),
    numberToHex(overrides.destinationDomain ?? 26, { size: 4 }),
    overrides.nonce ?? `0x${"01".repeat(32)}`,
    addressWord(overrides.sender ?? tokenMessenger),
    addressWord(overrides.recipient ?? tokenMessenger),
    addressWord(
      overrides.destinationCaller ??
        "0x0000000000000000000000000000000000000000",
    ),
    numberToHex(finalityThreshold, { size: 4 }),
    numberToHex(overrides.executedFinalityThreshold ?? finalityThreshold, {
      size: 4,
    }),
    numberToHex(1, { size: 4 }),
    addressWord(overrides.burnToken ?? sourceUsdc),
    addressWord(overrides.mintRecipient ?? vault),
    word(overrides.burnAmount ?? 100_250_000n),
    addressWord(overrides.sourceSender ?? payer),
    word(overrides.maxFee ?? 250_000n),
    word(overrides.feeExecuted ?? 200_000n),
    word(99_999_999n),
    forwardHook,
  ]);
}

function irisMessage(raw = makeRawMessage()): IrisCctpMessage {
  return {
    status: "complete",
    message: raw,
    messageHash: keccak256(raw),
    eventNonce: "event-1".replace("event-", ""),
    cctpVersion: 2,
    attestation: `0x${"ab".repeat(65)}`,
    forwardState: "CONFIRMED",
    forwardTxHash: `0x${"cd".repeat(32)}`,
  };
}

const expected: CctpMessageExpectation = {
  sourceChainId: 84_532,
  sourceTransactionHash: `0x${"ef".repeat(32)}`,
  destinationChainId: 5_042_002,
  mintRecipient: vault,
  sourceSender: payer,
  burnAmount: 100_250_000n,
  minimumDestinationAmount: 100_000_000n,
  maxFee: 250_000n,
  finalityThreshold: 1_000,
};

describe("CCTP checkout quote", () => {
  it("grosses up the source amount so the vault receives the invoice amount", () => {
    const quote = calculateQuote("100.00", 1.3, 50_000n, 1_500);
    expect(quote.protocolFeeSubunits).toBe(13_000n);
    expect(quote.forwardFeeSubunits).toBe(50_000n);
    expect(quote.maxFeeSubunits).toBe(72_450n);
    expect(quote.maxFee).toBe("0.07245");
    expect(quote.totalSourceAmountSubunits).toBe(100_072_450n);
    expect(quote.transferSpeed).toBe("FAST");
  });
});

describe("CCTP V2 message validation", () => {
  it("decodes and validates every checkout-bound field", () => {
    const parsed = parseCctpMessage(makeRawMessage());
    expect(parsed.sourceDomain).toBe(6);
    expect(parsed.destinationDomain).toBe(26);
    expect(parsed.burnToken).toBe(sourceUsdc);
    expect(parsed.mintRecipient).toBe(vault);
    expect(parsed.sourceSender).toBe(payer);
    expect(parsed.burnAmount).toBe(100_250_000n);
    expect(parsed.maxFee).toBe(250_000n);

    const validated = validateCctpMessage(irisMessage(), expected);
    expect(validated.destinationAmount).toBe(100_050_000n);
    expect(validated.forwardTxHash).toBe(`0x${"cd".repeat(32)}`);
  });

  it.each([
    ["another Arc recipient", { mintRecipient: payer }, "mint recipient"],
    [
      "wrong destination domain",
      { destinationDomain: 3 },
      "destination domain",
    ],
    ["wrong burn token", { burnToken: payer }, "native USDC"],
    ["wrong header sender", { sender: payer }, "TokenMessenger"],
    ["wrong header recipient", { recipient: payer }, "TokenMessenger"],
    [
      "restricted destination caller",
      { destinationCaller: payer },
      "destination caller",
    ],
    ["wrong burn amount", { burnAmount: 90_000_000n }, "burn amount"],
    ["wrong source sender", { sourceSender: vault }, "source sender"],
    ["wrong maximum fee", { maxFee: 300_000n }, "maximum fee"],
    ["wrong finality", { finalityThreshold: 2_000 }, "finality threshold"],
    [
      "under-executed finality",
      { executedFinalityThreshold: 999 },
      "executed finality",
    ],
  ] as const)("rejects %s", (_label, overrides, error) => {
    expect(() =>
      validateCctpMessage(irisMessage(makeRawMessage(overrides)), expected),
    ).toThrow(error);
  });

  it("selects the verified identity instead of messages[0]", () => {
    const wrong = irisMessage(makeRawMessage({ mintRecipient: payer }));
    const valid = irisMessage();
    expect(selectCctpMessage([wrong, valid], expected).mintRecipient).toBe(
      vault,
    );
  });

  it("rejects ambiguous duplicate messages", () => {
    expect(() =>
      selectCctpMessage([irisMessage(), irisMessage()], expected),
    ).toThrow("Multiple CCTP messages");
  });
});
