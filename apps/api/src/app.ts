import { createHash, randomBytes } from "node:crypto";
import cors from "cors";
import express, {
  type Application,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pino from "pino";
import pinoHttp from "pino-http";
import { fetchCheckoutQuote } from "@arc-checkout/cctp";
import { prisma } from "@arc-checkout/database";
import {
  formatUsdc,
  orderIdToBytes32,
  parseUsdc,
  paymentAttemptInputSchema,
  paymentIntentInputSchema,
  webhookInputSchema,
} from "@arc-checkout/shared";
import { config } from "./config.js";
import { jsonSafe } from "./serialize.js";
import {
  assertSafeWebhookUrl,
  decryptSecret,
  encryptSecret,
  safeSecretEqual,
  signWebhook,
} from "./security.js";
import { z } from "zod";

const logger = pino({
  level: config.LOG_LEVEL,
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.body.secret",
    "*.encryptedSecret",
  ],
});

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) =>
    handler(request, response).catch(next);
}

function mutationGuard(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (
    config.DEMO_MODE ||
    safeSecretEqual(
      request.header("x-internal-api-secret"),
      config.INTERNAL_API_SECRET,
    )
  )
    return next();
  response.status(401).json({ error: "Merchant authentication is required" });
}

function demoVault(orderId: string): string {
  return `0x${createHash("sha256").update(`arc-demo:${orderId}`).digest("hex").slice(0, 40)}`;
}

export function createApp(): Application {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: config.NEXT_PUBLIC_APP_URL,
      methods: ["GET", "POST"],
      allowedHeaders: [
        "Content-Type",
        "Idempotency-Key",
        "X-Internal-Api-Secret",
      ],
    }),
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(pinoHttp({ logger }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );

  app.get(
    "/api/health",
    asyncRoute(async (_request, response) => {
      await prisma.$queryRaw`SELECT 1`;
      response.json({
        status: "ok",
        mode: config.DEMO_MODE ? "demo" : "testnet",
        time: new Date().toISOString(),
      });
    }),
  );

  app.post(
    "/api/merchants",
    mutationGuard,
    asyncRoute(async (request, response) => {
      const input = z
        .object({
          merchantAddress: paymentIntentInputSchema.shape.merchantAddress,
          payoutAddress: paymentIntentInputSchema.shape.refundAddress,
          displayName: z.string().trim().min(1).max(80).optional(),
          metadataHash: z
            .string()
            .regex(/^0x[a-fA-F0-9]{64}$/)
            .optional(),
        })
        .parse(request.body);
      const merchant = await prisma.merchant.upsert({
        where: { walletAddress: input.merchantAddress.toLowerCase() },
        update: {
          payoutAddress: input.payoutAddress.toLowerCase(),
          ...(input.displayName === undefined
            ? {}
            : { displayName: input.displayName }),
        },
        create: {
          walletAddress: input.merchantAddress.toLowerCase(),
          payoutAddress: input.payoutAddress.toLowerCase(),
          displayName: input.displayName ?? null,
          metadataHash: input.metadataHash ?? null,
        },
      });
      response.status(201).json(jsonSafe(merchant));
    }),
  );

  app.get(
    "/api/merchants/:address",
    asyncRoute(async (request, response) => {
      const merchant = await prisma.merchant.findUnique({
        where: { walletAddress: String(request.params.address).toLowerCase() },
        include: {
          intents: { orderBy: { createdAt: "desc" }, take: 20 },
          webhooks: {
            select: {
              id: true,
              url: true,
              events: true,
              active: true,
              createdAt: true,
            },
          },
        },
      });
      if (!merchant) {
        response.status(404).json({ error: "Merchant not found" });
        return;
      }
      response.json(jsonSafe(merchant));
    }),
  );

  app.post(
    "/api/payment-intents",
    mutationGuard,
    asyncRoute(async (request, response) => {
      const input = paymentIntentInputSchema.parse(request.body);
      const idempotencyKey = request.header("idempotency-key");
      if (
        !idempotencyKey ||
        idempotencyKey.length < 12 ||
        idempotencyKey.length > 128
      ) {
        response
          .status(400)
          .json({ error: "A valid Idempotency-Key header is required" });
        return;
      }
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { key_scope: { key: idempotencyKey, scope: "payment-intents" } },
      });
      if (existing && existing.expiresAt > new Date()) {
        response.status(existing.statusCode).json(existing.response);
        return;
      }
      const merchant = await prisma.merchant.findUnique({
        where: { walletAddress: input.merchantAddress.toLowerCase() },
      });
      if (!merchant) {
        response.status(404).json({ error: "Register the merchant first" });
        return;
      }
      const slug = `${input.orderId
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40)}-${randomBytes(4).toString("hex")}`;
      const created = await prisma.paymentIntent.create({
        data: {
          slug,
          orderId: input.orderId,
          orderIdBytes32: orderIdToBytes32(input.orderId),
          expectedAmount: parseUsdc(input.amount),
          refundAddress: input.refundAddress.toLowerCase(),
          payoutAddress: merchant.payoutAddress,
          vaultAddress:
            input.vaultAddress?.toLowerCase() ??
            (config.DEMO_MODE ? demoVault(input.orderId) : null),
          description: input.description ?? null,
          metadataHash: input.metadata
            ? `0x${createHash("sha256").update(JSON.stringify(input.metadata)).digest("hex")}`
            : null,
          expiresAt: new Date(input.expiresAt),
          createTransactionHash: input.createTransactionHash ?? null,
          merchantId: merchant.id,
        },
        include: { merchant: true },
      });
      const payload = jsonSafe({
        ...created,
        amount: formatUsdc(created.expectedAmount),
        paymentUrl: `${config.NEXT_PUBLIC_APP_URL}/pay/${slug}`,
        mode: config.DEMO_MODE ? "demo" : "testnet",
      });
      await prisma.idempotencyRecord.create({
        data: {
          key: idempotencyKey,
          scope: "payment-intents",
          response: payload,
          statusCode: 201,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      response.status(201).json(payload);
    }),
  );

  app.get(
    "/api/payment-intents/:id",
    asyncRoute(async (request, response) => {
      const intent = await prisma.paymentIntent.findFirst({
        where: {
          OR: [
            { id: String(request.params.id) },
            { slug: String(request.params.id) },
          ],
        },
        include: {
          merchant: true,
          attempts: { orderBy: { createdAt: "desc" } },
          transactions: true,
        },
      });
      if (!intent) {
        response.status(404).json({ error: "Payment intent not found" });
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.json(
        jsonSafe({
          ...intent,
          amount: formatUsdc(intent.expectedAmount),
          funded: formatUsdc(intent.fundedAmount),
          mode: config.DEMO_MODE ? "demo" : "testnet",
        }),
      );
    }),
  );

  app.get(
    "/api/payment-intents/:id/status",
    asyncRoute(async (request, response) => {
      const intent = await prisma.paymentIntent.findFirst({
        where: {
          OR: [
            { id: String(request.params.id) },
            { slug: String(request.params.id) },
          ],
        },
        select: {
          id: true,
          status: true,
          expectedAmount: true,
          fundedAmount: true,
          vaultAddress: true,
          arcMintTransactionHash: true,
          settlementTransactionHash: true,
          updatedAt: true,
        },
      });
      if (!intent) {
        response.status(404).json({ error: "Payment intent not found" });
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.json(jsonSafe(intent));
    }),
  );

  app.post(
    "/api/payment-intents/:id/quote",
    asyncRoute(async (request, response) => {
      const { sourceChainId } = z
        .object({
          sourceChainId: z.union([z.literal(84532), z.literal(11155111)]),
        })
        .parse(request.body);
      const intent = await prisma.paymentIntent.findFirst({
        where: {
          OR: [
            { id: String(request.params.id) },
            { slug: String(request.params.id) },
          ],
        },
      });
      if (!intent) {
        response.status(404).json({ error: "Payment intent not found" });
        return;
      }
      if (intent.status !== "OPEN" && intent.status !== "PARTIALLY_FUNDED") {
        response.status(409).json({ error: "Invoice is not payable" });
        return;
      }
      if (intent.expiresAt <= new Date()) {
        response.status(410).json({ error: "Invoice has expired" });
        return;
      }
      const remaining = intent.expectedAmount - intent.fundedAmount;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        try {
          const quote = await fetchCheckoutQuote(
            sourceChainId,
            formatUsdc(remaining),
            config.CIRCLE_API_BASE_URL,
            controller.signal,
          );
          response.json(
            jsonSafe({
              ...quote,
              sourceChainId,
              destinationChainId: 5_042_002,
              vaultAddress: intent.vaultAddress,
              quoteSource: "circle-iris",
            }),
          );
        } catch (error) {
          if (!config.DEMO_MODE) throw error;
          const { calculateQuote } = await import("@arc-checkout/cctp");
          const quote = calculateQuote(formatUsdc(remaining), 0, 50_000n, 0);
          response.json(
            jsonSafe({
              ...quote,
              sourceChainId,
              destinationChainId: 5_042_002,
              vaultAddress: intent.vaultAddress,
              quoteSource: "local-mock",
            }),
          );
        }
      } finally {
        clearTimeout(timeout);
      }
    }),
  );

  app.post(
    "/api/payment-intents/:id/attempts",
    mutationGuard,
    asyncRoute(async (request, response) => {
      const input = paymentAttemptInputSchema.parse(request.body);
      const intent = await prisma.paymentIntent.findFirst({
        where: {
          OR: [
            { id: String(request.params.id) },
            { slug: String(request.params.id) },
          ],
        },
      });
      if (!intent) {
        response.status(404).json({ error: "Payment intent not found" });
        return;
      }
      const attempt = await prisma.paymentAttempt.create({
        data: {
          paymentIntentId: intent.id,
          sourceChainId: input.sourceChainId,
          customerAddress: input.customerAddress.toLowerCase(),
          quotedSourceAmount: parseUsdc(input.quotedSourceAmount),
          sourceTransactionHash: input.sourceTransactionHash ?? null,
          status: input.sourceTransactionHash ? "BURN_SUBMITTED" : "QUOTED",
        },
      });
      response.status(201).json(jsonSafe(attempt));
    }),
  );

  app.get(
    "/api/payment-attempts/:id",
    asyncRoute(async (request, response) => {
      const attempt = await prisma.paymentAttempt.findUnique({
        where: { id: String(request.params.id) },
        include: { paymentIntent: true },
      });
      if (!attempt) {
        response.status(404).json({ error: "Payment attempt not found" });
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.json(jsonSafe(attempt));
    }),
  );

  app.post(
    "/api/webhooks",
    mutationGuard,
    asyncRoute(async (request, response) => {
      const input = webhookInputSchema.parse(request.body);
      await assertSafeWebhookUrl(input.url);
      const merchant = await prisma.merchant.findUnique({
        where: { walletAddress: input.merchantAddress.toLowerCase() },
      });
      if (!merchant) {
        response.status(404).json({ error: "Merchant not found" });
        return;
      }
      const secret = `whsec_${randomBytes(24).toString("base64url")}`;
      const endpoint = await prisma.webhookEndpoint.create({
        data: {
          merchantId: merchant.id,
          url: input.url,
          events: input.events,
          encryptedSecret: encryptSecret(secret),
        },
      });
      response.status(201).json({
        id: endpoint.id,
        url: endpoint.url,
        events: endpoint.events,
        secret,
      });
    }),
  );

  app.get(
    "/api/webhooks",
    mutationGuard,
    asyncRoute(async (request, response) => {
      const merchantAddress = paymentIntentInputSchema.shape.merchantAddress
        .parse(request.query.merchantAddress)
        .toLowerCase();
      const endpoints = await prisma.webhookEndpoint.findMany({
        where: { merchant: { walletAddress: merchantAddress } },
        select: {
          id: true,
          url: true,
          events: true,
          active: true,
          createdAt: true,
          deliveries: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      });
      response.json(jsonSafe(endpoints));
    }),
  );

  app.post(
    "/api/webhooks/:id/test",
    mutationGuard,
    asyncRoute(async (request, response) => {
      const endpoint = await prisma.webhookEndpoint.findUnique({
        where: { id: String(request.params.id) },
        include: { merchant: true },
      });
      if (!endpoint) {
        response.status(404).json({ error: "Webhook not found" });
        return;
      }
      await assertSafeWebhookUrl(endpoint.url);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify({
        id: crypto.randomUUID(),
        type: "webhook.test",
        timestamp: new Date().toISOString(),
        merchantId: endpoint.merchantId,
      });
      const signature = signWebhook(
        decryptSecret(endpoint.encryptedSecret),
        timestamp,
        body,
      );
      const deliveryResponse = await fetch(endpoint.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
        headers: {
          "content-type": "application/json",
          "user-agent": "Arc-Checkout-Webhook/1.0",
          "x-arc-timestamp": timestamp,
          "x-arc-signature": `v1=${signature}`,
        },
        body,
      });
      response.status(deliveryResponse.ok ? 200 : 502).json({
        delivered: deliveryResponse.ok,
        statusCode: deliveryResponse.status,
      });
    }),
  );

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      void _next;
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      logger.error(
        {
          err:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : "unknown",
        },
        "request failed",
      );
      const clientError =
        error instanceof SyntaxError ||
        (typeof error === "object" && error !== null && "issues" in error);
      response.status(clientError ? 400 : 500).json({
        error: clientError ? message : "The request could not be completed",
      });
    },
  );

  return app;
}
