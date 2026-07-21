import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  CIRCLE_API_BASE_URL: z
    .string()
    .url()
    .default("https://iris-api-sandbox.circle.com"),
  ARC_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
  NEXT_PUBLIC_CHECKOUT_FACTORY_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  WEBHOOK_ENCRYPTION_KEY: z.string().optional(),
  AUTH_DOMAIN: z.string().min(1).optional(),
  ALLOWED_WEBHOOK_HOSTS: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
});

export const config = configSchema.parse({
  ...process.env,
  API_PORT: process.env.API_PORT ?? process.env.PORT,
});

if (config.NODE_ENV === "production" && config.DEMO_MODE) {
  throw new Error("DEMO_MODE cannot be enabled when NODE_ENV=production");
}

if (!config.DEMO_MODE && !config.WEBHOOK_ENCRYPTION_KEY) {
  throw new Error("WEBHOOK_ENCRYPTION_KEY is required outside demo mode");
}
