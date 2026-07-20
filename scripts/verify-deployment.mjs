#!/usr/bin/env node
import path from "node:path";
import {
  CONTRACT_NAMES,
  normalizeRpcUrl,
  readJson,
  root,
  verifyDeployment,
  writeJsonAtomic,
} from "./deployment-common.mjs";

if (process.argv.includes("--help")) {
  console.log(`Usage: node scripts/verify-deployment.mjs [--write]

Reads deployments/arc-testnet.json and independently checks receipt success,
contract bytecode, Arc USDC, owners, treasury, protocol fee and every factory
constructor relationship. Requires ARC_RPC_URL.`);
  process.exit(0);
}

const deploymentFile = path.join(root, "deployments", "arc-testnet.json");
const record = readJson(deploymentFile);
if (record.status !== "deployed")
  throw new Error(
    `Deployment status is ${record.status}; no real deployment can be verified`,
  );
for (const name of CONTRACT_NAMES) {
  if (!record.contracts?.[name] || !record.deploymentTransactions?.[name])
    throw new Error(`Deployment record is missing real ${name} evidence`);
}
const rpcUrl = normalizeRpcUrl(process.env.ARC_RPC_URL);
const result = await verifyDeployment(record, rpcUrl);
console.log("Arc deployment verification passed.");
for (const [name, value] of Object.entries(result.relationships))
  console.log(`${name}: ${value}`);

if (process.argv.includes("--write")) {
  writeJsonAtomic(deploymentFile, {
    ...record,
    lastVerifiedAt: new Date().toISOString(),
    onchainVerification: "passed",
  });
  console.log("Verification timestamp recorded.");
}
