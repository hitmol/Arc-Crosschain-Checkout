#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function url(env, name, options = {}) {
  const value = required(env, name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (options.protocols && !options.protocols.includes(parsed.protocol))
    throw new Error(`${name} must use ${options.protocols.join(" or ")}`);
  return parsed;
}

function address(env, name) {
  const value = required(env, name);
  if (!addressPattern.test(value) || /^0x0{40}$/i.test(value))
    throw new Error(`${name} must be a non-zero EVM address`);
  return value.toLowerCase();
}

function productionBase(env) {
  if (required(env, "NODE_ENV") !== "production")
    throw new Error("NODE_ENV must be production");
  if (required(env, "DEMO_MODE") !== "false")
    throw new Error("DEMO_MODE must be false in a live environment");
}

function validatePublicAddresses(env) {
  const factory = address(env, "NEXT_PUBLIC_CHECKOUT_FACTORY_ADDRESS");
  const registry = address(env, "NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS");
  if (factory === registry)
    throw new Error("Factory and registry addresses must be distinct");
}

function validateDatabase(env) {
  const database = url(env, "DATABASE_URL", {
    protocols: ["postgres:", "postgresql:"],
  });
  const sslMode = database.searchParams.get("sslmode");
  if (!sslMode || !["require", "verify-ca", "verify-full"].includes(sslMode))
    throw new Error("DATABASE_URL must require TLS with sslmode");
}

function validateWebhookKey(env) {
  const encoded = required(env, "WEBHOOK_ENCRYPTION_KEY");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded))
    throw new Error(
      "WEBHOOK_ENCRYPTION_KEY must be base64 for exactly 32 bytes",
    );
  if (Buffer.from(encoded, "base64").length !== 32)
    throw new Error("WEBHOOK_ENCRYPTION_KEY must decode to 32 bytes");
}

export function validateComponentEnv(component, env) {
  if (!["web", "api", "worker"].includes(component))
    throw new Error("Component must be web, api, or worker");
  productionBase(env);

  if (component === "web") {
    url(env, "NEXT_PUBLIC_APP_URL", { protocols: ["https:"] });
    url(env, "NEXT_PUBLIC_API_URL", { protocols: ["https:"] });
    validatePublicAddresses(env);
    required(env, "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID");
  }

  if (component === "api") {
    const app = url(env, "NEXT_PUBLIC_APP_URL", { protocols: ["https:"] });
    validateDatabase(env);
    url(env, "ARC_RPC_URL", { protocols: ["https:"] });
    address(env, "ARC_CHECKOUT_FACTORY_ADDRESS");
    address(env, "ARC_MERCHANT_REGISTRY_ADDRESS");
    validateWebhookKey(env);
    required(env, "ALLOWED_WEBHOOK_HOSTS");
    if (required(env, "AUTH_DOMAIN") !== app.host)
      throw new Error(
        "AUTH_DOMAIN must exactly match NEXT_PUBLIC_APP_URL host",
      );
  }

  if (component === "worker") {
    validateDatabase(env);
    url(env, "ARC_RPC_URL", { protocols: ["https:"] });
    url(env, "CIRCLE_API_BASE_URL", { protocols: ["https:"] });
    address(env, "ARC_CHECKOUT_FACTORY_ADDRESS");
    address(env, "ARC_MERCHANT_REGISTRY_ADDRESS");
    validateWebhookKey(env);
    const block = required(env, "ARC_DEPLOYMENT_BLOCK");
    if (!/^\d+$/.test(block))
      throw new Error("ARC_DEPLOYMENT_BLOCK must be a non-negative integer");
    const pageSize = Number.parseInt(
      required(env, "ARC_INDEXER_PAGE_SIZE"),
      10,
    );
    if (!Number.isInteger(pageSize) || pageSize <= 0)
      throw new Error("ARC_INDEXER_PAGE_SIZE must be a positive integer");
    if (
      env.SETTLER_PRIVATE_KEY &&
      !/^0x[a-fA-F0-9]{64}$/.test(env.SETTLER_PRIVATE_KEY)
    )
      throw new Error("SETTLER_PRIVATE_KEY has invalid format");
  }

  return { component, valid: true };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const component = process.argv[2];
  const result = validateComponentEnv(component, process.env);
  console.log(`${result.component} production environment is valid`);
}
