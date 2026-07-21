import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ARC_CHAIN_ID = 5_042_002;
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
export const CONTRACT_NAMES = [
  "MerchantRegistry",
  "FeeManager",
  "PaymentVaultImplementation",
  "CheckoutFactory",
];
const BROADCAST_CONTRACT_NAMES = new Map([
  ["MerchantRegistry", "MerchantRegistry"],
  ["FeeManager", "FeeManager"],
  ["PaymentVault", "PaymentVaultImplementation"],
  ["PaymentVaultImplementation", "PaymentVaultImplementation"],
  ["CheckoutFactory", "CheckoutFactory"],
]);
export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function assertAddress(value, name) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value ?? ""))
    throw new Error(`${name} must be a non-zero EVM address`);
  if (/^0x0{40}$/i.test(value)) throw new Error(`${name} cannot be zero`);
  return value.toLowerCase();
}

export function assertHash(value, name) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value ?? ""))
    throw new Error(`${name} must be a transaction hash`);
  return value.toLowerCase();
}

export function normalizeRpcUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("ARC_RPC_URL must be a valid HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("ARC_RPC_URL must use HTTP or HTTPS");
  return parsed.toString();
}

export async function rpc(rpcUrl, method, params = []) {
  const maximumAttempts = 5;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (
      !response.ok &&
      (response.status === 429 || response.status >= 500) &&
      attempt < maximumAttempts
    ) {
      const retryAfter = Number.parseInt(
        response.headers.get("retry-after") ?? "",
        10,
      );
      const delay = Number.isSafeInteger(retryAfter)
        ? Math.min(retryAfter * 1_000, 5_000)
        : attempt * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!response.ok)
      throw new Error(`${method} returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error)
      throw new Error(
        `${method} failed: ${payload.error.message ?? "RPC error"}`,
      );
    return payload.result;
  }
  throw new Error(`${method} exhausted RPC retry attempts`);
}

export async function assertArcNetwork(rpcUrl) {
  const chainId = Number.parseInt(await rpc(rpcUrl, "eth_chainId"), 16);
  if (chainId !== ARC_CHAIN_ID)
    throw new Error(
      `Expected Arc Testnet ${ARC_CHAIN_ID}, received ${chainId}`,
    );
  return chainId;
}

export async function assertContractCode(rpcUrl, address, name) {
  const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
  if (!code || code === "0x") throw new Error(`${name} has no deployed code`);
  return code;
}

export async function assertArcUsdc(rpcUrl, configuredAddress = ARC_USDC) {
  const address = assertAddress(configuredAddress, "ARC_USDC_ADDRESS");
  if (address !== ARC_USDC.toLowerCase())
    throw new Error(`Arc Testnet USDC must be ${ARC_USDC}`);
  await assertContractCode(rpcUrl, address, "Arc USDC");
  const decimalsHex = await rpc(rpcUrl, "eth_call", [
    { to: address, data: "0x313ce567" },
    "latest",
  ]);
  if (Number.parseInt(decimalsHex, 16) !== 6)
    throw new Error("Configured Arc USDC decimals() is not 6");
  return address;
}

function binary(name) {
  const bundled = path.join(root, ".tools", "foundry", `${name}.exe`);
  return process.platform === "win32" && existsSync(bundled) ? bundled : name;
}

export function runFoundry(name, args, options = {}) {
  const result = spawnSync(binary(name), args, {
    cwd: options.cwd ?? path.join(root, "packages", "contracts"),
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: false,
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${name} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  return (result.stdout ?? "").trim();
}

export function git(...args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || "git failed");
  return result.stdout.trim();
}

export function parseBroadcast(broadcast, metadata = {}) {
  const protocolFeeBps = Number(metadata.protocolFeeBps);
  if (
    !Number.isInteger(protocolFeeBps) ||
    protocolFeeBps < 0 ||
    protocolFeeBps > 500
  )
    throw new Error("protocolFeeBps must be an integer from 0 through 500");
  const deployments = new Map();
  for (const transaction of broadcast.transactions ?? []) {
    const recordName = BROADCAST_CONTRACT_NAMES.get(transaction.contractName);
    if (transaction.transactionType === "CREATE" && recordName) {
      deployments.set(recordName, {
        address: assertAddress(
          transaction.contractAddress,
          `${recordName} address`,
        ),
        transactionHash: assertHash(
          transaction.hash,
          `${recordName} transaction`,
        ),
      });
    }
  }
  for (const name of CONTRACT_NAMES) {
    if (!deployments.has(name))
      throw new Error(`Foundry broadcast is missing ${name}`);
  }
  const receiptBlocks = (broadcast.receipts ?? [])
    .map((receipt) => Number.parseInt(receipt.blockNumber, 16))
    .filter(Number.isSafeInteger);
  if (receiptBlocks.length === 0)
    throw new Error("Foundry broadcast has no receipt block numbers");

  return {
    network: "arc-testnet",
    chainId: ARC_CHAIN_ID,
    status: "deployed",
    deployer: assertAddress(metadata.deployer, "deployer"),
    treasury: assertAddress(metadata.treasury, "treasury"),
    usdc: assertAddress(metadata.usdc ?? ARC_USDC, "Arc USDC"),
    protocolFeeBps,
    deploymentBlock: Math.min(...receiptBlocks),
    contracts: Object.fromEntries(
      CONTRACT_NAMES.map((name) => [name, deployments.get(name).address]),
    ),
    deploymentTransactions: Object.fromEntries(
      CONTRACT_NAMES.map((name) => [
        name,
        deployments.get(name).transactionHash,
      ]),
    ),
    deployedAt: metadata.deployedAt ?? new Date().toISOString(),
    commit: metadata.commit,
    tag: metadata.tag ?? null,
    sourceVerification: { status: "not-attempted", checkedAt: null },
  };
}

function decodeAddress(value, name) {
  const normalized = String(value).trim();
  const match = normalized.match(/0x[a-fA-F0-9]{40}$/);
  if (!match) throw new Error(`${name} did not return an address`);
  return match[0].toLowerCase();
}

function decodeInteger(value, name) {
  const normalized = String(value).trim();
  const parsed = normalized.startsWith("0x")
    ? Number.parseInt(normalized, 16)
    : Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed))
    throw new Error(`${name} did not return an integer`);
  return parsed;
}

export async function verifyDeployment(record, rpcUrl) {
  await assertArcNetwork(rpcUrl);
  await assertArcUsdc(rpcUrl, record.usdc);
  for (const name of CONTRACT_NAMES)
    await assertContractCode(rpcUrl, record.contracts[name], name);

  const call = (address, signature) =>
    runFoundry("cast", ["call", address, signature, "--rpc-url", rpcUrl]);
  const relationships = {
    merchantRegistryOwner: decodeAddress(
      call(record.contracts.MerchantRegistry, "owner()(address)"),
      "MerchantRegistry.owner",
    ),
    feeManagerOwner: decodeAddress(
      call(record.contracts.FeeManager, "owner()(address)"),
      "FeeManager.owner",
    ),
    treasury: decodeAddress(
      call(record.contracts.FeeManager, "treasury()(address)"),
      "FeeManager.treasury",
    ),
    protocolFeeBps: decodeInteger(
      call(record.contracts.FeeManager, "protocolFeeBps()(uint16)"),
      "FeeManager.protocolFeeBps",
    ),
    merchantRegistry: decodeAddress(
      call(record.contracts.CheckoutFactory, "merchantRegistry()(address)"),
      "CheckoutFactory.merchantRegistry",
    ),
    feeManager: decodeAddress(
      call(record.contracts.CheckoutFactory, "feeManager()(address)"),
      "CheckoutFactory.feeManager",
    ),
    vaultImplementation: decodeAddress(
      call(record.contracts.CheckoutFactory, "vaultImplementation()(address)"),
      "CheckoutFactory.vaultImplementation",
    ),
    usdc: decodeAddress(
      call(record.contracts.CheckoutFactory, "usdc()(address)"),
      "CheckoutFactory.usdc",
    ),
  };
  const expected = {
    merchantRegistryOwner: assertAddress(record.deployer, "deployer"),
    feeManagerOwner: assertAddress(record.deployer, "deployer"),
    treasury: assertAddress(record.treasury, "treasury"),
    protocolFeeBps: record.protocolFeeBps,
    merchantRegistry: assertAddress(
      record.contracts.MerchantRegistry,
      "MerchantRegistry",
    ),
    feeManager: assertAddress(record.contracts.FeeManager, "FeeManager"),
    vaultImplementation: assertAddress(
      record.contracts.PaymentVaultImplementation,
      "PaymentVaultImplementation",
    ),
    usdc: assertAddress(record.usdc, "Arc USDC"),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (relationships[key] !== value)
      throw new Error(
        `${key} mismatch: expected ${value}, received ${relationships[key]}`,
      );
  }

  const receiptBlocks = [];
  for (const name of CONTRACT_NAMES) {
    const hash = assertHash(
      record.deploymentTransactions[name],
      `${name} deployment transaction`,
    );
    const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [hash]);
    if (!receipt || Number.parseInt(receipt.status, 16) !== 1)
      throw new Error(`${name} deployment receipt is missing or reverted`);
    if (
      assertAddress(receipt.contractAddress, `${name} receipt address`) !==
      record.contracts[name]
    )
      throw new Error(`${name} receipt contract address mismatch`);
    receiptBlocks.push(Number.parseInt(receipt.blockNumber, 16));
  }
  if (Math.min(...receiptBlocks) !== record.deploymentBlock)
    throw new Error("Recorded deployment block does not match receipts");
  return { relationships, receiptBlocks };
}

export function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}
