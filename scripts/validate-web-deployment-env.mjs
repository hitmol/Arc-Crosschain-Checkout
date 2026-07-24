#!/usr/bin/env node
import { validateComponentEnv } from "./validate-environment.mjs";

const requiredPublicVariables = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_CHECKOUT_FACTORY_ADDRESS",
  "NEXT_PUBLIC_MERCHANT_REGISTRY_ADDRESS",
];

const missing = requiredPublicVariables.filter(
  (name) => !process.env[name]?.trim(),
);

if (process.env.VERCEL_ENV === "production") {
  const result = validateComponentEnv("web", process.env);
  if (process.env.NEXT_PUBLIC_CCTP_ENABLED === "true") {
    validateComponentEnv("api", process.env);
    validateComponentEnv("worker", process.env);
  }
  console.log(
    `SettleLink production web environment preflight passed in ${result.mode} mode.`,
  );
} else if (missing.length > 0) {
  console.warn(
    `SettleLink deployment preflight: ${process.env.VERCEL_ENV ?? "local"} environment is missing ${missing.join(", ")}. Public proof mode remains available; live contract actions remain unavailable until configured.`,
  );
} else {
  console.log("SettleLink preview web environment preflight passed.");
}
