import assert from "node:assert/strict";
import test from "node:test";
import {
  ARC_CHAIN_ID,
  ARC_USDC,
  assertAddress,
  normalizeRpcUrl,
  parseBroadcast,
} from "./deployment-common.mjs";

const names = [
  "MerchantRegistry",
  "FeeManager",
  "PaymentVaultImplementation",
  "CheckoutFactory",
];

test("parses complete Foundry deployment evidence", () => {
  const transactions = names.map((contractName, index) => ({
    transactionType: "CREATE",
    contractName,
    contractAddress: `0x${String(index + 1).padStart(40, "0")}`,
    hash: `0x${String(index + 1).padStart(64, "a")}`,
  }));
  const record = parseBroadcast(
    {
      transactions,
      receipts: transactions.map((transaction, index) => ({
        transactionHash: transaction.hash,
        blockNumber: `0x${(100 + index).toString(16)}`,
      })),
    },
    {
      deployer: "0x1111111111111111111111111111111111111111",
      treasury: "0x2222222222222222222222222222222222222222",
      usdc: ARC_USDC,
      protocolFeeBps: 25,
      commit: "a".repeat(40),
      deployedAt: "2026-07-20T00:00:00.000Z",
      tag: "v0.1.0-hackathon-rc1",
    },
  );
  assert.equal(record.chainId, ARC_CHAIN_ID);
  assert.equal(record.deploymentBlock, 100);
  assert.equal(
    record.contracts.CheckoutFactory,
    transactions[3].contractAddress,
  );
  assert.equal(
    record.deploymentTransactions.MerchantRegistry,
    transactions[0].hash,
  );
});

test("rejects incomplete broadcasts and unsafe configuration", () => {
  assert.throws(
    () =>
      parseBroadcast(
        { transactions: [], receipts: [] },
        {
          deployer: "0x1111111111111111111111111111111111111111",
          treasury: "0x2222222222222222222222222222222222222222",
          protocolFeeBps: 25,
        },
      ),
    /missing MerchantRegistry/,
  );
  assert.throws(() => assertAddress(`0x${"0".repeat(40)}`, "owner"), /zero/);
  assert.throws(() => normalizeRpcUrl("file:///tmp/rpc"), /HTTP/);
});
