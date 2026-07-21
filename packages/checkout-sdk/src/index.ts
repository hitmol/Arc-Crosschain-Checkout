import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentIntentInput } from "@arc-checkout/shared";

export class ArcCheckoutError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface ArcCheckoutOptions {
  apiUrl: string;
  apiKey?: string;
  fetch?: typeof fetch;
}
export interface CreateInvoiceInput extends Omit<
  PaymentIntentInput,
  "merchantAddress" | "expiresAt"
> {
  merchantAddress: string;
  expiresInSeconds: number;
}

export class ArcCheckout {
  private readonly requestFetch: typeof fetch;
  readonly paymentIntents: {
    create: (
      input: CreateInvoiceInput,
      idempotencyKey?: string,
    ) => Promise<Record<string, unknown>>;
    retrieve: (id: string) => Promise<Record<string, unknown>>;
    status: (id: string) => Promise<Record<string, unknown>>;
  };

  constructor(private readonly options: ArcCheckoutOptions) {
    this.requestFetch = options.fetch ?? fetch;
    this.paymentIntents = {
      create: (input, key = crypto.randomUUID()) =>
        this.request("/api/payment-intents", {
          method: "POST",
          headers: { "idempotency-key": key },
          body: JSON.stringify({
            ...input,
            expiresAt: new Date(
              Date.now() + input.expiresInSeconds * 1000,
            ).toISOString(),
          }),
        }),
      retrieve: (id) =>
        this.request(`/api/payment-intents/${encodeURIComponent(id)}`),
      status: (id) =>
        this.request(`/api/payment-intents/${encodeURIComponent(id)}/status`),
    };
  }

  async listMerchantPayments(
    address: string,
  ): Promise<Record<string, unknown>> {
    return this.request(`/api/merchants/${encodeURIComponent(address)}`);
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Record<string, unknown>> {
    const response = await this.requestFetch(
      new URL(path, this.options.apiUrl),
      {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(this.options.apiKey
            ? { Authorization: `Bearer ${this.options.apiKey}` }
            : {}),
          ...init.headers,
        },
      },
    );
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const message =
        typeof payload.error === "string"
          ? payload.error
          : "SettleLink request failed";
      throw new ArcCheckoutError(
        message,
        response.status,
        typeof payload.code === "string" ? payload.code : undefined,
      );
    }
    return payload;
  }
}

export function verifyWebhookSignature(options: {
  secret: string;
  rawBody: string;
  timestamp: string;
  signature: string;
  toleranceSeconds?: number;
  now?: number;
}): boolean {
  const tolerance = options.toleranceSeconds ?? 300;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const timestamp = Number(options.timestamp);
  if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > tolerance)
    return false;
  const provided = options.signature.replace(/^v1=/, "");
  const expected = createHmac("sha256", options.secret)
    .update(`${options.timestamp}.${options.rawBody}`)
    .digest("hex");
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
