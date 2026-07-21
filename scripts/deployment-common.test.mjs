import assert from "node:assert/strict";
import test from "node:test";
import {
  ARC_CHAIN_ID,
  ARC_USDC,
  assertAddress,
  normalizeRpcUrl,
  parseBroadcast,
  rpc,
} from "./deployment-common.mjs";

const names = [
  "MerchantRegistry",
  "FeeManager",
  "PaymentVaultImplementation",
  "CheckoutFactory",
];

test("parses complete Foundry deployment evidence", () => {
  const transactions = names.map((recordName, index) => ({
    transactionType: "CREATE",
    contractName:
      recordName === "PaymentVaultImplementation" ? "PaymentVault" : recordName,
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
  assert.equal(
    record.contracts.PaymentVaultImplementation,
    transactions[2].contractAddress,
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

test("retries transient RPC throttling", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(null, { status: 429 });
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x1" });
  };
  try {
    assert.equal(
      await rpc("https://rpc.testnet.arc.network", "eth_chainId"),
      "0x1",
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
