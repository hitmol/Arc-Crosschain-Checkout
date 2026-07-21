#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertAddress,
  assertHash,
  git,
  normalizeRpcUrl,
  readJson,
  root,
  rpc,
  writeJsonAtomic,
} from "./deployment-common.mjs";

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument ${key}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`${key} requires a value`);
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

if (process.argv.includes("--help")) {
  console.log(`Usage:
  node scripts/record-transaction-evidence.mjs \\
    --action "Merchant registration" --environment testnet \\
    --network "Arc Testnet" --chain-id 5042002 --rpc-env ARC_RPC_URL \\
    --tx 0x... --contract 0x... --method "registerMerchant" \\
    --expected-event "MerchantRegistered" --observed-event "MerchantRegistered" \\
    --resulting-state "merchant active" --event-topic 0x... \\
    [--invoice-vault 0x...] [--amount "1.00 USDC"]

The script queries the RPC for the successful transaction, receipt, required
event topic and block timestamp. It then appends deduplicated evidence and
regenerates docs/TRANSACTION_EVIDENCE.md.`);
  process.exit(0);
}

const input = parseArgs(process.argv.slice(2));
for (const name of [
  "action",
  "environment",
  "network",
  "chain-id",
  "rpc-env",
  "tx",
  "contract",
  "method",
  "expected-event",
  "observed-event",
  "resulting-state",
  "event-topic",
]) {
  if (!input[name]?.trim()) throw new Error(`--${name} is required`);
}

const chainId = Number.parseInt(input["chain-id"], 10);
if (!Number.isSafeInteger(chainId) || chainId <= 0)
  throw new Error("--chain-id must be a positive integer");
const rpcVariable = input["rpc-env"];
if (!/^[A-Z][A-Z0-9_]+$/.test(rpcVariable))
  throw new Error("--rpc-env must name an uppercase environment variable");
const rpcUrl = normalizeRpcUrl(process.env[rpcVariable]);
const actualChainId = Number.parseInt(await rpc(rpcUrl, "eth_chainId"), 16);
if (actualChainId !== chainId)
  throw new Error(`RPC chain ${actualChainId} does not match ${chainId}`);

const transactionHash = assertHash(input.tx, "transaction hash");
const [transaction, receipt] = await Promise.all([
  rpc(rpcUrl, "eth_getTransactionByHash", [transactionHash]),
  rpc(rpcUrl, "eth_getTransactionReceipt", [transactionHash]),
]);
if (!transaction || !receipt)
  throw new Error("Transaction or receipt is not available from the RPC");
if (Number.parseInt(receipt.status, 16) !== 1)
  throw new Error("Only successful transactions can be recorded as evidence");
const block = await rpc(rpcUrl, "eth_getBlockByNumber", [
  receipt.blockNumber,
  false,
]);
if (!block) throw new Error("Transaction block is unavailable");

const eventTopic = assertHash(input["event-topic"], "event topic");
const topicObserved = receipt.logs?.some(
  (log) => log.topics?.[0]?.toLowerCase() === eventTopic,
);
if (!topicObserved)
  throw new Error("Required event topic is absent from receipt");

const explorerBases = new Map([
  [5_042_002, "https://testnet.arcscan.app"],
  [84_532, "https://sepolia.basescan.org"],
  [11_155_111, "https://sepolia.etherscan.io"],
]);
const explorer = explorerBases.get(chainId);
if (!explorer)
  throw new Error(`No approved explorer configured for ${chainId}`);
const contract = /^0x/i.test(input.contract)
  ? assertAddress(input.contract, "contract")
  : input.contract.trim();
if (
  /^0x/i.test(contract) &&
  transaction.to &&
  contract !== transaction.to.toLowerCase()
)
  throw new Error("Recorded contract does not match transaction recipient");

const evidence = {
  action: input.action.trim(),
  environment: input.environment.trim(),
  network: input.network.trim(),
  chainId,
  sender: assertAddress(transaction.from, "transaction sender"),
  recipient: transaction.to
    ? assertAddress(transaction.to, "transaction recipient")
    : assertAddress(receipt.contractAddress, "created contract"),
  contract,
  method: input.method.trim(),
  transactionHash,
  block: Number.parseInt(receipt.blockNumber, 16),
  timestamp: new Date(
    Number.parseInt(block.timestamp, 16) * 1_000,
  ).toISOString(),
  expectedEvent: input["expected-event"].trim(),
  observedEvent: input["observed-event"].trim(),
  explorerUrl: `${explorer}/tx/${transactionHash}`,
  resultingState: input["resulting-state"].trim(),
  relatedCommit: git("rev-parse", "HEAD"),
  ...(input["invoice-vault"]
    ? { invoiceVault: assertAddress(input["invoice-vault"], "invoice vault") }
    : {}),
  ...(input.amount?.trim() ? { amount: input.amount.trim() } : {}),
  ...(input.payout ? { payout: assertAddress(input.payout, "payout") } : {}),
  ...(input["protocol-fee"]?.trim()
    ? { protocolFee: input["protocol-fee"].trim() }
    : {}),
  ...(input["refund-excess"]?.trim()
    ? { refundExcess: input["refund-excess"].trim() }
    : {}),
};

const evidenceFile = path.join(root, "evidence", "transaction-evidence.json");
let entries = [];
try {
  entries = readJson(evidenceFile);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!Array.isArray(entries)) throw new Error("Evidence store must be an array");
if (
  entries.some(
    (entry) =>
      entry.action === evidence.action &&
      entry.transactionHash === evidence.transactionHash,
  )
)
  throw new Error("This action and transaction are already recorded");
entries.push(evidence);
writeJsonAtomic(evidenceFile, entries);

const required = [
  "Merchant registration",
  "Invoice creation",
  "Payment attempt registration",
  "Vault funding",
  "CCTP source approval",
  "CCTP burn",
  "Arc forwarding mint",
  "Arc settlement",
];
const missing = required.filter(
  (label) =>
    !entries.some((entry) =>
      entry.action.toLowerCase().includes(label.toLowerCase()),
    ),
);
const rows = entries
  .map(
    (entry) =>
      `| ${entry.action} | ${entry.network} (${entry.chainId}) | ${entry.method} | [${entry.transactionHash.slice(0, 10)}…](${entry.explorerUrl}) | ${entry.block} | ${entry.timestamp} | ${entry.observedEvent} | ${entry.resultingState} | \`${entry.relatedCommit.slice(0, 12)}\` |`,
  )
  .join("\n");

const deployment = readJson(path.join(root, "deployments", "arc-testnet.json"));
const deploymentRows = Object.keys(deployment.contracts)
  .map(
    (name) =>
      `| ${name} | [${deployment.contracts[name]}](https://testnet.arcscan.app/address/${deployment.contracts[name]}) | [${deployment.deploymentTransactions[name].slice(0, 10)}…](https://testnet.arcscan.app/tx/${deployment.deploymentTransactions[name]}) |`,
  )
  .join("\n");
const arcMissing = missing.filter(
  (item) =>
    !item.toLowerCase().includes("cctp") && item !== "Arc forwarding mint",
);
const crosschainMissing = missing.filter(
  (item) =>
    item.toLowerCase().includes("cctp") || item === "Arc forwarding mint",
);

const markdown = `# Transaction Evidence

This file is generated from the verified deployment record and successful receipts queried from the configured RPC. The recorder rejects reverted or missing receipts, wrong chains, mismatched recipients, malformed or zero hashes, and absent required event topics.

## Deployment evidence

- Network: Arc Testnet (${deployment.chainId})
- Deployment block: ${deployment.deploymentBlock}
- Source verification: ${deployment.sourceVerification.status}
- Onchain configuration verification: ${deployment.onchainVerification}

| Project-owned contract | Address | Deployment transaction |
| --- | --- | --- |
${deploymentRows}

## Arc interaction evidence

| Action | Network | Method | Transaction | Block | Timestamp | Observed event | Resulting state | Commit |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- |
${rows || "| No real interaction evidence recorded yet | — | — | — | — | — | — | — | — |"}

### Missing Arc interaction proof

${arcMissing.length > 0 ? arcMissing.map((item) => `- ${item}: not yet recorded`).join("\n") : "- None."}

Direct Arc Testnet funding, when present, verifies invoice settlement. It is not crosschain CCTP evidence.

## Crosschain evidence

Expected correlation fields are source approval, CCTP burn, Circle message hash/attestation, Arc forwarding mint, and Arc settlement.

${crosschainMissing.length > 0 ? crosschainMissing.map((item) => `- ${item}: not yet recorded`).join("\n") : "- All tracked crosschain categories recorded."}

Circle message data and signed webhook delivery evidence must be added only after a real end-to-end run. They are not blockchain transactions and are not synthesized by this receipt recorder.
`;
const documentationFile = path.join(root, "docs", "TRANSACTION_EVIDENCE.md");
writeFileSync(documentationFile, markdown, "utf8");
console.log(`Recorded verified transaction evidence in ${documentationFile}`);
