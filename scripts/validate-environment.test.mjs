import assert from "node:assert/strict";
import test from "node:test";
import { validateComponentEnv } from "./validate-environment.mjs";

const addressA = "0x1111111111111111111111111111111111111111";
const addressB = "0x2222222222222222222222222222222222222222";
const key = Buffer.alloc(32, 7).toString("base64");
const base = { NODE_ENV: "production", DEMO_MODE: "false" };

test("validates production web, API and worker environments", () => {
  assert.equal(
    validateComponentEnv("web", {
      ...base,
      NEXT_PUBLIC_APP_URL: "https://checkout.example",
      NEXT_PUBLIC_API_URL: "https://api.example",
      NEXT_PUBLIC_CHECKOUT_FACTORY_ADDRESS: addressA,
      NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS: addressB,
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: "public-project-id",
    }).valid,
    true,
  );
  assert.equal(
    validateComponentEnv("api", {
      ...base,
      NEXT_PUBLIC_APP_URL: "https://checkout.example",
      AUTH_DOMAIN: "checkout.example",
      DATABASE_URL:
        "postgresql://app:secret@db.example/checkout?sslmode=require",
      ARC_RPC_URL: "https://rpc.testnet.arc.network",
      ARC_CHECKOUT_FACTORY_ADDRESS: addressA,
      ARC_MERCHANT_REGISTRY_ADDRESS: addressB,
      WEBHOOK_ENCRYPTION_KEY: key,
      ALLOWED_WEBHOOK_HOSTS: "merchant.example",
    }).valid,
    true,
  );
  assert.equal(
    validateComponentEnv("worker", {
      ...base,
      DATABASE_URL:
        "postgresql://app:secret@db.example/checkout?sslmode=verify-full",
      ARC_RPC_URL: "https://rpc.testnet.arc.network",
      CIRCLE_API_BASE_URL: "https://iris-api-sandbox.circle.com",
      ARC_CHECKOUT_FACTORY_ADDRESS: addressA,
      ARC_MERCHANT_REGISTRY_ADDRESS: addressB,
      ARC_DEPLOYMENT_BLOCK: "123",
      ARC_INDEXER_PAGE_SIZE: "1000",
      WEBHOOK_ENCRYPTION_KEY: key,
    }).valid,
    true,
  );
});

test("rejects demo mode, insecure databases and mismatched auth domains", () => {
  assert.throws(
    () => validateComponentEnv("web", { ...base, DEMO_MODE: "true" }),
    /DEMO_MODE/,
  );
  assert.throws(
    () =>
      validateComponentEnv("api", {
        ...base,
        NEXT_PUBLIC_APP_URL: "https://checkout.example",
        AUTH_DOMAIN: "attacker.example",
        DATABASE_URL: "postgresql://app:secret@db.example/checkout",
      }),
    /TLS/,
  );
  assert.throws(
    () =>
      validateComponentEnv("api", {
        ...base,
        NEXT_PUBLIC_APP_URL: "https://checkout.example",
        AUTH_DOMAIN: "attacker.example",
        DATABASE_URL:
          "postgresql://app:secret@db.example/checkout?sslmode=require",
        ARC_RPC_URL: "https://rpc.testnet.arc.network",
        ARC_CHECKOUT_FACTORY_ADDRESS: addressA,
        ARC_MERCHANT_REGISTRY_ADDRESS: addressB,
        WEBHOOK_ENCRYPTION_KEY: key,
        ALLOWED_WEBHOOK_HOSTS: "merchant.example",
      }),
    /AUTH_DOMAIN/,
  );
});
