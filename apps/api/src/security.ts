import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "./config.js";

function encryptionKey(): Buffer {
  if (config.WEBHOOK_ENCRYPTION_KEY) {
    const decoded = Buffer.from(config.WEBHOOK_ENCRYPTION_KEY, "base64");
    if (decoded.length !== 32)
      throw new Error(
        "WEBHOOK_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      );
    return decoded;
  }
  return createHash("sha256").update("arc-checkout-local-demo-only").digest();
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptSecret(value: string): string {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded)
    throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function signWebhook(
  secret: string,
  timestamp: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function safeSecretEqual(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isPrivateIp(address: string): boolean {
  if (
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    address.startsWith("fe80:")
  )
    return true;
  if (!isIP(address) || address.includes(":")) return false;
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export async function assertSafeWebhookUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (url.username || url.password || url.hash)
    throw new Error("Webhook URL must not contain credentials or fragments");
  const localDemo =
    config.DEMO_MODE &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDemo)
    throw new Error("Webhook URL must use HTTPS");
  const allowed = new Set(
    config.ALLOWED_WEBHOOK_HOSTS.split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  );
  if (allowed.size > 0 && !allowed.has(url.hostname))
    throw new Error("Webhook host is not allowlisted");
  if (!localDemo) {
    const records = await lookup(url.hostname, { all: true });
    if (
      records.length === 0 ||
      records.some((record) => isPrivateIp(record.address))
    )
      throw new Error("Webhook host resolves to a private or reserved address");
  }
  return url;
}
