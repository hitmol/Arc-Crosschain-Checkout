#!/usr/bin/env node
import { validateComponentEnv } from "./validate-environment.mjs";

const requiredPublicVariables = [
  "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_CHECKOUT_FACTORY_ADDRESS",
  "NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS",
];

const missing = requiredPublicVariables.filter(
  (name) => !process.env[name]?.trim(),
);

if (process.env.VERCEL_ENV === "production") {
  validateComponentEnv("web", process.env);
  console.log("SettleLink production web environment preflight passed.");
} else if (missing.length > 0) {
  console.warn(
    `SettleLink deployment preflight: ${process.env.VERCEL_ENV ?? "local"} environment is missing ${missing.join(", ")}. WalletConnect and live contract actions must remain unavailable until configured.`,
  );
} else {
  console.log("SettleLink preview web environment preflight passed.");
}
