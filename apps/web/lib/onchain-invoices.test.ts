import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  zeroHash,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { checkoutFactoryAbi } from "./contracts";
import {
  assertOrderIdAvailable,
  decodeCreatedInvoice,
  formatInvoiceAmount,
  friendlyContractError,
  readLocalInvoices,
  upsertLocalInvoice,
  validateInvoiceInput,
  validatePayoutAddress,
  type LocalInvoice,
} from "./onchain-invoices";

const factory = getAddress("0x1000000000000000000000000000000000000001");
const merchant = getAddress("0x2000000000000000000000000000000000000002");
const vault = getAddress("0x3000000000000000000000000000000000000003");
const payout = getAddress("0x4000000000000000000000000000000000000004");
const orderId: Hash = `0x${"11".repeat(32)}`;

function receipt(options: { status?: "success" | "reverted"; emittedVault?: Address } = {}) {
  const topics = encodeEventTopics({
    abi: checkoutFactoryAbi,
    eventName: "PaymentIntentCreated",
    args: { orderId, merchant, vault: options.emittedVault ?? vault },
  });
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "uint16" },
      { type: "uint64" },
      { type: "bytes32" },
    ],
    [payout, 1_500_000n, 25, 2_000_000_000n, zeroHash],
  );
  return {
    status: options.status ?? "success",
    blockNumber: 123n,
    logs: [{ address: factory, topics, data }],
  } as unknown as TransactionReceipt;
}

function memoryStorage() {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

describe("onchain invoice validation", () => {
  it("parses USDC with 6 decimals and rejects invalid amounts", () => {
    expect(
      validateInvoiceInput(
        { orderReference: "INV-1042", amount: "1.234567", expiresAt: 10_000 },
        1_000,
      ).amountUnits,
    ).toBe(1_234_567n);
    expect(() =>
      validateInvoiceInput(
        { orderReference: "INV-1042", amount: "1.0000001", expiresAt: 10_000 },
        1_000,
      ),
    ).toThrow(/6 decimals|USDC amount/i);
    expect(() =>
      validateInvoiceInput(
        { orderReference: "INV-1042", amount: "0", expiresAt: 10_000 },
        1_000,
      ),
    ).toThrow(/greater than zero/i);
  });

  it("rejects expired and unrealistically distant timestamps", () => {
    expect(() =>
      validateInvoiceInput(
        { orderReference: "INV-1", amount: "1", expiresAt: 1_200 },
        1_000,
      ),
    ).toThrow(/at least 5 minutes/i);
    expect(() =>
      validateInvoiceInput(
        { orderReference: "INV-1", amount: "1", expiresAt: 3_000_000 },
        1_000,
      ),
    ).toThrow(/30 days/i);
  });

  it("validates and checksums payout addresses", () => {
    expect(validatePayoutAddress(merchant.toLowerCase())).toBe(merchant);
    expect(() => validatePayoutAddress("not-an-address")).toThrow(
      /valid Arc payout/i,
    );
  });

  it("rejects duplicate merchant order IDs", () => {
    expect(() => assertOrderIdAvailable(vault)).toThrow(
      "This order ID has already been used by the connected merchant.",
    );
    expect(() =>
      assertOrderIdAvailable(
        "0x0000000000000000000000000000000000000000",
      ),
    ).not.toThrow();
  });
});

describe("invoice receipt verification and persistence", () => {
  const expected = {
    factory,
    merchant,
    orderId,
    amountUnits: 1_500_000n,
    expiresAt: 2_000_000_000,
    predictedVault: vault,
  };

  it("decodes the real event fields from a successful receipt", () => {
    const decoded = decodeCreatedInvoice(receipt(), expected);
    expect(decoded.vault).toBe(vault);
    expect(decoded.expectedAmount).toBe(1_500_000n);
    expect(decoded.blockNumber).toBe(123n);
  });

  it("rejects reverted receipts and predicted/event vault mismatches", () => {
    expect(() => decodeCreatedInvoice(receipt({ status: "reverted" }), expected)).toThrow(
      /reverted/i,
    );
    expect(() =>
      decodeCreatedInvoice(
        receipt(),
        { ...expected, predictedVault: payout },
      ),
    ).toThrow(/Predicted and emitted invoice vaults do not match/);
  });

  it("stores only validated public invoice history and updates pending entries", () => {
    const storage = memoryStorage();
    const pending: LocalInvoice = {
      version: 1,
      merchant,
      orderReference: "INV-1042",
      orderId,
      amount: "1.5",
      amountUnits: "1500000",
      expiresAt: 2_000_000_000,
      metadataHash: zeroHash,
      predictedVault: vault,
      creationTransaction: `0x${"22".repeat(32)}`,
      status: "pending",
      createdAt: "2026-07-21T12:00:00.000Z",
    };
    upsertLocalInvoice(storage, pending);
    upsertLocalInvoice(storage, {
      ...pending,
      status: "confirmed",
      vault,
      blockNumber: "123",
      eventName: "PaymentIntentCreated",
    });
    expect(readLocalInvoices(storage)).toHaveLength(1);
    expect(readLocalInvoices(storage)[0]?.status).toBe("confirmed");
    expect(formatInvoiceAmount("1500000")).toBe("1.5");
  });

  it("drops malformed browser storage rather than trusting it", () => {
    const storage = memoryStorage();
    storage.setItem("ignored", JSON.stringify([{ merchant: "attacker-data" }]));
    expect(readLocalInvoices(storage)).toEqual([]);
  });

  it("maps known duplicate-order failures to an actionable message", () => {
    expect(friendlyContractError(new Error("DuplicateOrderId"))).toContain(
      "DuplicateOrderId",
    );
  });

  it("recognizes a wallet rejection nested inside a transport error", () => {
    const wrapped = Object.assign(new Error("HTTP request failed."), {
      cause: Object.assign(new Error("Provider failure"), { code: 4001 }),
    });
    expect(friendlyContractError(wrapped)).toBe(
      "The wallet request was rejected. You can safely try again.",
    );
  });
});
