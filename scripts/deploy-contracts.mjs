#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import {
  ARC_CHAIN_ID,
  ARC_USDC,
  assertAddress,
  assertArcNetwork,
  assertArcUsdc,
  git,
  normalizeRpcUrl,
  parseBroadcast,
  readJson,
  root,
  rpc,
  runFoundry,
  verifyDeployment,
  writeJsonAtomic,
} from "./deployment-common.mjs";

const args = new Set(process.argv.slice(2));
if (args.has("--help")) {
  console.log(`Usage: node scripts/deploy-contracts.mjs [--preflight]

Required environment:
  ARC_RPC_URL, FOUNDRY_ACCOUNT, PROTOCOL_TREASURY
Optional:
  PROTOCOL_FEE_BPS=25, ARC_USDC_ADDRESS=${ARC_USDC}
  MIN_DEPLOYER_GAS_WEI=100000000000000000

The account must already exist in Foundry's encrypted keystore. Plaintext
private-key arguments and environment variables are rejected.`);
  process.exit(0);
}
for (const argument of args) {
  if (argument.includes("private-key") || argument.startsWith("0x"))
    throw new Error("Plaintext private keys are never accepted");
}
for (const name of ["PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY"]) {
  if (process.env[name])
    throw new Error(`${name} is rejected; use FOUNDRY_ACCOUNT keystore alias`);
}

const rpcUrl = normalizeRpcUrl(process.env.ARC_RPC_URL);
const account = process.env.FOUNDRY_ACCOUNT?.trim();
if (!account) throw new Error("FOUNDRY_ACCOUNT is required");
const treasury = assertAddress(
  process.env.PROTOCOL_TREASURY,
  "PROTOCOL_TREASURY",
);
const usdc = assertAddress(
  process.env.ARC_USDC_ADDRESS ?? ARC_USDC,
  "ARC_USDC_ADDRESS",
);
const protocolFeeBps = Number.parseInt(
  process.env.PROTOCOL_FEE_BPS ?? "25",
  10,
);
if (
  !Number.isInteger(protocolFeeBps) ||
  protocolFeeBps < 0 ||
  protocolFeeBps > 500
)
  throw new Error("PROTOCOL_FEE_BPS must be an integer from 0 through 500");
const minimumGasBalance = BigInt(
  process.env.MIN_DEPLOYER_GAS_WEI ?? "100000000000000000",
);

if (git("status", "--porcelain"))
  throw new Error("Refusing to deploy from a dirty working tree");
const commit = git("rev-parse", "HEAD");
const tags = git("tag", "--points-at", "HEAD").split(/\r?\n/).filter(Boolean);
const tag =
  process.env.RELEASE_TAG ?? tags.find((value) => /hackathon-rc/i.test(value));
if (!tag && process.env.ALLOW_UNTAGGED_DEPLOYMENT !== "true")
  throw new Error(
    "Tag this green release candidate (for example v0.1.0-hackathon-rc1) before deployment",
  );
if (tag && !tags.includes(tag))
  throw new Error(`Release tag ${tag} does not point at current HEAD`);

if (process.env.REQUIRE_GREEN_CI !== "false") {
  const repository =
    process.env.GITHUB_REPOSITORY ?? "hitmol/Arc-Crosschain-Checkout";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error("GITHUB_REPOSITORY is invalid");
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "arc-checkout-deployer",
    ...(process.env.GITHUB_TOKEN
      ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {}),
  };
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/runs?head_sha=${commit}&event=push&per_page=20`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok)
    throw new Error(`GitHub CI gate returned HTTP ${response.status}`);
  const runs = (await response.json()).workflow_runs ?? [];
  const green = runs.some(
    (run) => run.name === "ci" && run.conclusion === "success",
  );
  if (!green) throw new Error(`No successful ci push run exists for ${commit}`);
}

await assertArcNetwork(rpcUrl);
await assertArcUsdc(rpcUrl, usdc);
const deployer = assertAddress(
  runFoundry("cast", ["wallet", "address", "--account", account]),
  "Foundry deployer",
);
const balance = BigInt(
  await rpc(rpcUrl, "eth_getBalance", [deployer, "latest"]),
);
if (balance < minimumGasBalance)
  throw new Error(
    `Deployer Arc gas balance ${balance} wei is below required ${minimumGasBalance} wei`,
  );

console.log(`Arc chain: ${ARC_CHAIN_ID}`);
console.log(`Deployer: ${deployer}`);
console.log(`Treasury: ${treasury}`);
console.log(`Arc USDC: ${usdc}`);
console.log(`Gas balance (wei): ${balance}`);

runFoundry("forge", ["test", "-vvv"], { inherit: true });
if (args.has("--preflight")) {
  console.log("Preflight passed. No transactions were broadcast.");
  process.exit(0);
}

runFoundry(
  "forge",
  [
    "script",
    "script/Deploy.s.sol:Deploy",
    "--rpc-url",
    rpcUrl,
    "--account",
    account,
    "--broadcast",
  ],
  {
    inherit: true,
    env: {
      ...process.env,
      ARC_RPC_URL: rpcUrl,
      PROTOCOL_TREASURY: treasury,
      PROTOCOL_FEE_BPS: String(protocolFeeBps),
    },
  },
);

const broadcastFile = path.join(
  root,
  "packages",
  "contracts",
  "broadcast",
  "Deploy.s.sol",
  String(ARC_CHAIN_ID),
  "run-latest.json",
);
if (!existsSync(broadcastFile))
  throw new Error(`Foundry broadcast output not found: ${broadcastFile}`);
const record = parseBroadcast(readJson(broadcastFile), {
  deployer,
  treasury,
  usdc,
  protocolFeeBps,
  commit,
  tag: tag ?? null,
});
await verifyDeployment(record, rpcUrl);
const deploymentFile = path.join(root, "deployments", "arc-testnet.json");
writeJsonAtomic(deploymentFile, record);
console.log(`Verified deployment recorded in ${deploymentFile}`);
console.log("ArcScan source verification remains a separate optional step.");
