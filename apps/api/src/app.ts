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
import {
  chainWebhookEventId,
  enqueuePaymentWebhook,
  lifecycleWebhookEventId,
  prisma,
} from "@arc-checkout/database";
import {
  formatUsdc,
  addressSchema,
  orderIdToBytes32,
  parseUsdc,
  paymentAttemptInputSchema,
  paymentAttemptProgressSchema,
  paymentIntentInputSchema,
  webhookInputSchema,
} from "@arc-checkout/shared";
import { isAddressEqual, zeroAddress } from "viem";
import { config } from "./config.js";
import {
  ReconciliationError,
  verifyPaymentIntentTransaction,
} from "./arc-reconciliation.js";
import {
  apiKeyScopes,
  assertMerchantScope,
  AUTH_CHAIN_ID,
  AUTH_CHALLENGE_TTL_MS,
  AUTH_COOKIE_NAME,
  AUTH_SESSION_TTL_MS,
  AuthError,
  buildMerchantSignInMessage,
  createApiKey,
  createOpaqueToken,
  hashOpaqueSecret,
  parseCookieHeader,
  requireScope,
  verifyAuthChallenge,
  type ApiKeyScope,
  type AuthPrincipal,
} from "./auth.js";
import { jsonSafe } from "./serialize.js";
import { getMerchantDashboard, getVerifiedReceipt } from "./payment-views.js";
import { verifyPaymentAuthorization } from "./payment-authorization.js";
import {
  assertClientStatusTransition,
  verifyAttemptSecret,
} from "./payment-attempt-access.js";
import {
  assertSafeWebhookUrl,
  decryptSecret,
  encryptSecret,
  signWebhook,
} from "./security.js";
import { z } from "zod";

const logger = pino({
  level: config.LOG_LEVEL,
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.headers.x-payment-attempt-secret",
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

const appUrl = new URL(config.NEXT_PUBLIC_APP_URL);
const authDomain = config.AUTH_DOMAIN ?? appUrl.host;

async function authenticate(request: Request): Promise<AuthPrincipal | null> {
  const sessionToken = parseCookieHeader(request.header("cookie")).get(
    AUTH_COOKIE_NAME,
  );
  if (sessionToken) {
    const session = await prisma.merchantSession.findUnique({
      where: { tokenHash: hashOpaqueSecret(sessionToken) },
    });
    if (session && !session.revokedAt && session.expiresAt > new Date()) {
      const merchant = await prisma.merchant.findUnique({
        where: { walletAddress: session.walletAddress },
        select: { id: true },
      });
      await prisma.merchantSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
      return {
        kind: "session",
        walletAddress: session.walletAddress,
        merchantId: merchant?.id ?? null,
        scopes: apiKeyScopes,
      };
    }
  }

  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const rawKey = authorization.slice("Bearer ".length).trim();
  const apiKey = await prisma.merchantApiKey.findUnique({
    where: { keyHash: hashOpaqueSecret(rawKey) },
    include: { merchant: true },
  });
  if (
    !apiKey ||
    apiKey.revokedAt ||
    (apiKey.expiresAt && apiKey.expiresAt <= new Date())
  )
    return null;
  await prisma.merchantApiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });
  return {
    kind: "api-key",
    walletAddress: apiKey.merchant.walletAddress,
    merchantId: apiKey.merchantId,
    scopes: apiKey.scopes,
  };
}

function merchantGuard(scope: ApiKeyScope, walletSessionOnly = false) {
  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const principal = await authenticate(request);
      if (!principal) {
        if (config.DEMO_MODE) return next();
        throw new AuthError("Merchant authentication is required");
      }
      if (walletSessionOnly && principal.kind !== "session")
        throw new AuthError("A merchant wallet session is required", 403);
      requireScope(principal, scope);
      response.locals.auth = principal;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function authenticatedMerchant(response: Response): AuthPrincipal | null {
  return (response.locals.auth as AuthPrincipal | undefined) ?? null;
}

function assertRequestedMerchant(
  response: Response,
  requestedWallet: string,
): void {
  const principal = authenticatedMerchant(response);
  if (principal) assertMerchantScope(principal, requestedWallet);
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
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: [
        "Content-Type",
        "Idempotency-Key",
        "Authorization",
        "X-Payment-Attempt-Secret",
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

  app.post(
    "/api/auth/challenge",
    asyncRoute(async (request, response) => {
      const input = z
        .object({
          walletAddress: paymentIntentInputSchema.shape.merchantAddress,
          chainId: z.literal(AUTH_CHAIN_ID),
          domain: z.string().min(1).max(255),
        })
        .parse(request.body);
      if (input.domain !== authDomain)
        throw new AuthError("Authentication domain is not allowed", 403);

      const nonce = createOpaqueToken(18);
      const challenge = await prisma.authChallenge.create({
        data: {
          walletAddress: input.walletAddress.toLowerCase(),
          chainId: input.chainId,
          domain: input.domain,
          nonceHash: hashOpaqueSecret(nonce),
          expiresAt: new Date(Date.now() + AUTH_CHALLENGE_TTL_MS),
        },
      });
      response.status(201).json({
        id: challenge.id,
        nonce,
        expiresAt: challenge.expiresAt.toISOString(),
        message: buildMerchantSignInMessage({
          id: challenge.id,
          walletAddress: challenge.walletAddress,
          chainId: challenge.chainId,
          domain: challenge.domain,
          nonce,
          issuedAt: challenge.createdAt,
          expiresAt: challenge.expiresAt,
          uri: appUrl.origin,
        }),
      });
    }),
  );

  app.post(
    "/api/auth/verify",
    asyncRoute(async (request, response) => {
      const input = z
        .object({
          challengeId: z.string().uuid(),
          nonce: z.string().min(16).max(128),
          signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
        })
        .parse(request.body);
      const challenge = await prisma.authChallenge.findUnique({
        where: { id: input.challengeId },
      });
      if (!challenge) throw new AuthError("Authentication challenge not found");
      await verifyAuthChallenge({
        challenge,
        nonce: input.nonce,
        signature: input.signature as `0x${string}`,
        uri: appUrl.origin,
      });

      const consumed = await prisma.authChallenge.updateMany({
        where: {
          id: challenge.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new AuthError(
          "Authentication challenge was already consumed",
          409,
        );

      const token = createOpaqueToken();
      const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_MS);
      await prisma.merchantSession.create({
        data: {
          tokenHash: hashOpaqueSecret(token),
          walletAddress: challenge.walletAddress,
          chainId: challenge.chainId,
          expiresAt,
        },
      });
      response.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: AUTH_SESSION_TTL_MS,
      });
      response.json({
        authenticated: true,
        walletAddress: challenge.walletAddress,
        chainId: challenge.chainId,
        expiresAt: expiresAt.toISOString(),
      });
    }),
  );

  app.get(
    "/api/auth/session",
    asyncRoute(async (request, response) => {
      const principal = await authenticate(request);
      response.setHeader("Cache-Control", "no-store");
      response.status(principal ? 200 : 401).json(
        principal
          ? {
              authenticated: true,
              walletAddress: principal.walletAddress,
              merchantId: principal.merchantId,
              kind: principal.kind,
            }
          : { authenticated: false },
      );
    }),
  );

  app.post(
    "/api/auth/logout",
    asyncRoute(async (request, response) => {
      const token = parseCookieHeader(request.header("cookie")).get(
        AUTH_COOKIE_NAME,
      );
      if (token) {
        await prisma.merchantSession.updateMany({
          where: { tokenHash: hashOpaqueSecret(token), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      response.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        secure: config.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      response.status(204).end();
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
    "/api/api-keys",
    merchantGuard("merchant:read", true),
    asyncRoute(async (request, response) => {
      const principal = authenticatedMerchant(response)!;
      if (!principal.merchantId)
        throw new AuthError(
          "Merchant must be indexed before creating an API key",
          409,
        );
      const input = z
        .object({
          name: z.string().trim().min(1).max(80),
          scopes: z.array(z.enum(apiKeyScopes)).min(1),
          expiresAt: z.string().datetime().optional(),
        })
        .parse(request.body);
      const generated = createApiKey();
      const apiKey = await prisma.merchantApiKey.create({
        data: {
          merchantId: principal.merchantId,
          name: input.name,
          keyPrefix: generated.prefix,
          keyHash: generated.hash,
          scopes: [...new Set(input.scopes)],
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        },
      });
      response.status(201).json({
        id: apiKey.id,
        name: apiKey.name,
        prefix: apiKey.keyPrefix,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt,
        key: generated.raw,
        warning: "This API key is shown only once.",
      });
    }),
  );

  app.get(
    "/api/api-keys",
    merchantGuard("merchant:read", true),
    asyncRoute(async (_request, response) => {
      const principal = authenticatedMerchant(response)!;
      if (!principal.merchantId) {
        response.json([]);
        return;
      }
      const apiKeys = await prisma.merchantApiKey.findMany({
        where: { merchantId: principal.merchantId },
        select: {
          id: true,
          name: true,
          keyPrefix: true,
          scopes: true,
          expiresAt: true,
          revokedAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
      response.json(jsonSafe(apiKeys));
    }),
  );

  app.delete(
    "/api/api-keys/:id",
    merchantGuard("merchant:read", true),
    asyncRoute(async (request, response) => {
      const principal = authenticatedMerchant(response)!;
      const revoked = await prisma.merchantApiKey.updateMany({
        where: {
          id: String(request.params.id),
          merchantId: principal.merchantId ?? "",
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) {
        response.status(404).json({ error: "API key not found" });
        return;
      }
      response.status(204).end();
    }),
  );

  app.post(
    "/api/api-keys/:id/rotate",
    merchantGuard("merchant:read", true),
    asyncRoute(async (request, response) => {
      const principal = authenticatedMerchant(response)!;
      if (!principal.merchantId)
        throw new AuthError("Merchant is not indexed", 409);
      const existing = await prisma.merchantApiKey.findFirst({
        where: {
          id: String(request.params.id),
          merchantId: principal.merchantId,
          revokedAt: null,
        },
      });
      if (!existing) {
        response.status(404).json({ error: "API key not found" });
        return;
      }
      const generated = createApiKey();
      const replacement = await prisma.$transaction(async (transaction) => {
        await transaction.merchantApiKey.update({
          where: { id: existing.id },
          data: { revokedAt: new Date() },
        });
        return transaction.merchantApiKey.create({
          data: {
            merchantId: existing.merchantId,
            name: existing.name,
            keyPrefix: generated.prefix,
            keyHash: generated.hash,
            scopes: existing.scopes,
            expiresAt: existing.expiresAt,
          },
        });
      });
      response.status(201).json({
        id: replacement.id,
        name: replacement.name,
        prefix: replacement.keyPrefix,
        scopes: replacement.scopes,
        expiresAt: replacement.expiresAt,
        key: generated.raw,
        warning: "This replacement API key is shown only once.",
      });
    }),
  );

  app.post(
    "/api/merchants",
    merchantGuard("merchant:read", true),
    asyncRoute(async (request, response) => {
      const input = z
        .object({
          merchantAddress: paymentIntentInputSchema.shape.merchantAddress,
          payoutAddress: addressSchema,
          displayName: z.string().trim().min(1).max(80).optional(),
          metadataHash: z
            .string()
            .regex(/^0x[a-fA-F0-9]{64}$/)
            .optional(),
        })
        .parse(request.body);
      assertRequestedMerchant(response, input.merchantAddress);
      if (!config.DEMO_MODE) {
        const indexed = await prisma.merchant.findUnique({
          where: { walletAddress: input.merchantAddress.toLowerCase() },
        });
        if (!indexed) {
          response.status(409).json({
            error: "Merchant registration has not been indexed yet",
          });
          return;
        }
        if (indexed.payoutAddress !== input.payoutAddress.toLowerCase()) {
          response.status(400).json({
            error: "Payout address does not match the indexed Arc event",
          });
          return;
        }
        const updated = await prisma.merchant.update({
          where: { id: indexed.id },
          data:
            input.displayName === undefined
              ? {}
              : { displayName: input.displayName },
        });
        response.json(jsonSafe(updated));
        return;
      }
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
    merchantGuard("merchant:read"),
    asyncRoute(async (request, response) => {
      assertRequestedMerchant(response, String(request.params.address));
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

  app.get(
    "/api/dashboard",
    merchantGuard("merchant:read"),
    asyncRoute(async (request, response) => {
      const input = z
        .object({
          merchantAddress: addressSchema,
          page: z.coerce.number().int().positive().default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(20),
          status: z
            .enum([
              "OPEN",
              "PARTIALLY_FUNDED",
              "FUNDED",
              "SETTLING",
              "SETTLED",
              "REFUNDED",
              "CANCELLED",
              "EXPIRED",
            ])
            .optional(),
          sourceChainId: z.coerce.number().int().positive().optional(),
          search: z.string().trim().min(1).max(100).optional(),
        })
        .parse(request.query);
      assertRequestedMerchant(response, input.merchantAddress);
      const merchant = await prisma.merchant.findUnique({
        where: { walletAddress: input.merchantAddress.toLowerCase() },
        select: { id: true },
      });
      if (!merchant) {
        response.status(404).json({ error: "Merchant not found" });
        return;
      }
      const dashboard = await getMerchantDashboard(merchant.id, {
        page: input.page,
        pageSize: input.pageSize,
        ...(input.status ? { status: input.status } : {}),
        ...(input.sourceChainId ? { sourceChainId: input.sourceChainId } : {}),
        ...(input.search ? { search: input.search } : {}),
      });
      response.setHeader("Cache-Control", "no-store");
      response.json(jsonSafe(dashboard));
    }),
  );

  app.get(
    "/api/receipts/:invoiceSlug",
    asyncRoute(async (request, response) => {
      const invoiceSlug = z
        .string()
        .trim()
        .min(1)
        .max(120)
        .parse(request.params.invoiceSlug);
      const receipt = await getVerifiedReceipt(invoiceSlug);
      if (!receipt) {
        response.status(404).json({ error: "Receipt not found" });
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.json(jsonSafe(receipt));
    }),
  );

  app.post(
    "/api/payment-intents",
    merchantGuard("payment-intents:write"),
    asyncRoute(async (request, response) => {
      const input = paymentIntentInputSchema.parse(request.body);
      assertRequestedMerchant(response, input.merchantAddress);
      if (!config.DEMO_MODE) {
        response.status(400).json({
          error:
            "Testnet invoices must be imported from a verified Arc transaction at /api/payment-intents/reconcile",
        });
        return;
      }
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
      const payload = await prisma.$transaction(async (transaction) => {
        const created = await transaction.paymentIntent.create({
          data: {
            slug,
            orderId: input.orderId,
            orderIdBytes32: orderIdToBytes32(input.orderId),
            expectedAmount: parseUsdc(input.amount),
            refundAddress: null,
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
        await enqueuePaymentWebhook(transaction, {
          eventId: lifecycleWebhookEventId({
            eventType: "payment.intent.created",
            identity: `demo:${created.id}`,
          }),
          eventType: "payment.intent.created",
          intent: created,
          data: { vaultAddress: created.vaultAddress, demo: true },
        });
        const responsePayload = jsonSafe({
          ...created,
          amount: formatUsdc(created.expectedAmount),
          paymentUrl: `${config.NEXT_PUBLIC_APP_URL}/pay/${slug}`,
          mode: config.DEMO_MODE ? "demo" : "testnet",
        });
        await transaction.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            scope: "payment-intents",
            response: responsePayload,
            statusCode: 201,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        return responsePayload;
      });
      response.status(201).json(payload);
    }),
  );

  app.post(
    "/api/payment-intents/reconcile",
    merchantGuard("payment-intents:write"),
    asyncRoute(async (request, response) => {
      const input = paymentIntentInputSchema
        .omit({ vaultAddress: true, createTransactionHash: true })
        .extend({
          transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
        })
        .parse(request.body);
      assertRequestedMerchant(response, input.merchantAddress);
      const merchant = await prisma.merchant.findUnique({
        where: { walletAddress: input.merchantAddress.toLowerCase() },
      });
      if (!merchant) {
        response.status(409).json({
          error: "Merchant registration has not been indexed yet",
        });
        return;
      }

      const existing = await prisma.paymentIntent.findUnique({
        where: {
          createChainId_createTransactionHash: {
            createChainId: AUTH_CHAIN_ID,
            createTransactionHash: input.transactionHash.toLowerCase(),
          },
        },
        include: { merchant: true },
      });
      if (existing) {
        if (existing.merchantId !== merchant.id)
          throw new AuthError("Transaction belongs to another merchant", 403);
        response.json(
          jsonSafe({
            ...existing,
            amount: formatUsdc(existing.expectedAmount),
            paymentUrl: `${config.NEXT_PUBLIC_APP_URL}/pay/${existing.slug}`,
            mode: "testnet",
          }),
        );
        return;
      }

      const verified = await verifyPaymentIntentTransaction(
        {
          transactionHash: input.transactionHash as `0x${string}`,
          merchantAddress: input.merchantAddress as `0x${string}`,
          orderId: input.orderId,
          amount: input.amount,
          expiresAt: input.expiresAt,
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
        },
        merchant.payoutAddress as `0x${string}`,
      );
      const slugBase =
        input.orderId
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40) || "invoice";
      const slug = `${slugBase}-${input.transactionHash.slice(2, 10).toLowerCase()}`;
      const created = await prisma.$transaction(async (transaction) => {
        const intent = await transaction.paymentIntent.create({
          data: {
            slug,
            orderId: input.orderId,
            orderIdBytes32: verified.orderIdBytes32,
            expectedAmount: verified.expectedAmount,
            refundAddress: null,
            payoutAddress: verified.payoutAddress,
            vaultAddress: verified.vaultAddress,
            description: input.description ?? null,
            metadataHash: verified.metadataHash,
            expiresAt: verified.expiresAt,
            createChainId: verified.chainId,
            createTransactionHash: verified.transactionHash.toLowerCase(),
            merchantId: merchant.id,
          },
          include: { merchant: true },
        });
        await transaction.chainTransaction.create({
          data: {
            chainId: verified.chainId,
            transactionHash: verified.transactionHash.toLowerCase(),
            logIndex: verified.logIndex,
            blockNumber: verified.blockNumber,
            blockHash: verified.blockHash.toLowerCase(),
            contractAddress: verified.factoryAddress.toLowerCase(),
            type: "PaymentIntentCreated",
            payload: {
              orderId: verified.orderIdBytes32,
              merchant: verified.merchantAddress,
              vault: verified.vaultAddress,
              payoutAddress: verified.payoutAddress,
              expectedAmount: verified.expectedAmount.toString(),
              protocolFeeBps: verified.protocolFeeBps,
              expiresAt: verified.expiresAt.toISOString(),
              metadataHash: verified.metadataHash,
            },
            merchantId: merchant.id,
            paymentIntentId: intent.id,
          },
        });
        await enqueuePaymentWebhook(transaction, {
          eventId: chainWebhookEventId({
            eventType: "payment.intent.created",
            chainId: verified.chainId,
            transactionHash: verified.transactionHash,
            logIndex: verified.logIndex,
          }),
          eventType: "payment.intent.created",
          intent,
          data: {
            chainId: verified.chainId,
            transactionHash: verified.transactionHash.toLowerCase(),
            logIndex: verified.logIndex,
            vaultAddress: verified.vaultAddress,
          },
        });
        return intent;
      });
      response.status(201).json(
        jsonSafe({
          ...created,
          amount: formatUsdc(created.expectedAmount),
          paymentUrl: `${config.NEXT_PUBLIC_APP_URL}/pay/${created.slug}`,
          mode: "testnet",
        }),
      );
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
      if (intent.status !== "OPEN" || intent.fundedAmount !== 0n) {
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
        let quote;
        let quoteSource: "circle-iris" | "local-mock" = "circle-iris";
        try {
          quote = await fetchCheckoutQuote(
            sourceChainId,
            formatUsdc(remaining),
            config.CIRCLE_API_BASE_URL,
            controller.signal,
          );
        } catch (error) {
          if (!config.DEMO_MODE) throw error;
          const { calculateQuote } = await import("@arc-checkout/cctp");
          quote = calculateQuote(formatUsdc(remaining), 0, 50_000n, 0);
          quoteSource = "local-mock";
        }
        const effectiveExpiry = new Date(
          Math.min(
            new Date(quote.expiresAt).getTime(),
            intent.expiresAt.getTime() - 1_000,
          ),
        );
        if (effectiveExpiry <= new Date()) {
          response
            .status(410)
            .json({ error: "Invoice expires too soon to quote" });
          return;
        }
        const persistedQuote = await prisma.paymentQuote.create({
          data: {
            sourceChainId,
            destinationChainId: 5_042_002,
            requestedDestinationAmount: quote.requestedAmountSubunits,
            protocolFee: quote.protocolFeeSubunits,
            forwardFee: quote.forwardFeeSubunits,
            feeBuffer: quote.feeBufferSubunits,
            maxFee: quote.maxFeeSubunits,
            maximumSourceAmount: quote.totalSourceAmountSubunits,
            finalityThreshold: quote.finalityThreshold,
            transferSpeed: quote.transferSpeed,
            expiresAt: effectiveExpiry,
            paymentIntentId: intent.id,
          },
        });
        response.json(
          jsonSafe({
            ...quote,
            expiresAt: effectiveExpiry.toISOString(),
            quoteId: persistedQuote.id,
            sourceChainId,
            destinationChainId: 5_042_002,
            vaultAddress: intent.vaultAddress,
            quoteSource,
          }),
        );
      } finally {
        clearTimeout(timeout);
      }
    }),
  );

  app.post(
    "/api/payment-intents/:id/demo-attempts",
    asyncRoute(async (request, response) => {
      if (!config.DEMO_MODE) {
        response.status(404).json({ error: "Demo lifecycle is disabled" });
        return;
      }
      const input = z
        .object({
          sourceChainId: z.union([z.literal(84532), z.literal(11155111)]),
          customerAddress: addressSchema,
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
      const existing = await prisma.paymentAttempt.findFirst({
        where: { paymentIntentId: intent.id, active: true },
      });
      if (existing) {
        response.json(jsonSafe(existing));
        return;
      }
      const attempt = await prisma.$transaction(async (transaction) => {
        const created = await transaction.paymentAttempt.create({
          data: {
            active: true,
            vaultAddress: intent.vaultAddress,
            orderIdBytes32: intent.orderIdBytes32,
            sourceChainId: input.sourceChainId,
            destinationChainId: 5_042_002,
            customerAddress: input.customerAddress.toLowerCase(),
            refundAddress: input.customerAddress.toLowerCase(),
            destinationAmount: intent.expectedAmount,
            quotedSourceAmount: intent.expectedAmount,
            maximumSourceAmount: intent.expectedAmount,
            status: "QUOTED",
            paymentIntentId: intent.id,
          },
        });
        await enqueuePaymentWebhook(transaction, {
          eventId: lifecycleWebhookEventId({
            eventType: "payment.attempt.created",
            identity: `demo:${created.id}`,
          }),
          eventType: "payment.attempt.created",
          intent,
          data: {
            attemptId: created.id,
            sourceChainId: created.sourceChainId,
            customerAddress: created.customerAddress,
            refundAddress: created.refundAddress,
            demo: true,
          },
        });
        return created;
      });
      response.status(201).json(jsonSafe(attempt));
    }),
  );

  app.post(
    "/api/payment-intents/:id/attempts",
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
      if (
        intent.status !== "OPEN" ||
        intent.fundedAmount !== 0n ||
        intent.expiresAt <= new Date()
      ) {
        response.status(409).json({ error: "Invoice is not payable" });
        return;
      }
      if (input.registeredTransactionHash || input.sourceTransactionHash) {
        response.status(400).json({
          error: "Create the signed attempt before submitting any transaction",
        });
        return;
      }
      const quote = await prisma.paymentQuote.findUnique({
        where: { id: input.quoteId },
      });
      if (
        !quote ||
        quote.paymentIntentId !== intent.id ||
        quote.usedAt ||
        quote.expiresAt <= new Date()
      ) {
        response.status(409).json({ error: "Quote is invalid or expired" });
        return;
      }
      if (
        isAddressEqual(input.customerAddress as `0x${string}`, zeroAddress) ||
        isAddressEqual(input.refundAddress as `0x${string}`, zeroAddress)
      ) {
        response
          .status(400)
          .json({ error: "Payer and refund addresses must be non-zero" });
        return;
      }
      if (
        !intent.vaultAddress ||
        !isAddressEqual(
          intent.vaultAddress as `0x${string}`,
          input.invoiceVault as `0x${string}`,
        )
      ) {
        response
          .status(400)
          .json({ error: "Attempt vault does not match the verified invoice" });
        return;
      }
      if (
        orderIdToBytes32(input.orderId).toLowerCase() !==
        intent.orderIdBytes32.toLowerCase()
      ) {
        response
          .status(400)
          .json({ error: "Attempt order ID does not match the invoice" });
        return;
      }
      const destinationAmount = parseUsdc(input.destinationAmount);
      const maximumSourceAmount = parseUsdc(input.maximumSourceAmount);
      const quotedSourceAmount = parseUsdc(input.quotedSourceAmount);
      const quoteExpiresAt = new Date(input.quoteExpiresAt);
      const attemptExpiresAt = new Date(input.attemptExpiresAt);
      const remaining = intent.expectedAmount - intent.fundedAmount;
      if (
        input.sourceChainId !== quote.sourceChainId ||
        input.destinationChainId !== quote.destinationChainId ||
        destinationAmount !== quote.requestedDestinationAmount ||
        destinationAmount !== remaining ||
        maximumSourceAmount !== quote.maximumSourceAmount ||
        quotedSourceAmount !== quote.maximumSourceAmount ||
        maximumSourceAmount < destinationAmount ||
        quoteExpiresAt.getTime() !== quote.expiresAt.getTime() ||
        attemptExpiresAt <= quoteExpiresAt ||
        attemptExpiresAt > intent.expiresAt
      ) {
        response.status(400).json({
          error: "Payment attempt does not match the active quote or invoice",
        });
        return;
      }
      const message = {
        attemptId: input.attemptId as `0x${string}`,
        sourceChainId: BigInt(input.sourceChainId),
        destinationChainId: BigInt(input.destinationChainId),
        invoiceVault: input.invoiceVault as `0x${string}`,
        orderId: intent.orderIdBytes32 as `0x${string}`,
        payer: input.customerAddress as `0x${string}`,
        refundAddress: input.refundAddress as `0x${string}`,
        destinationAmount,
        maximumSourceAmount,
        quoteExpiresAt: BigInt(Math.floor(quoteExpiresAt.getTime() / 1000)),
        nonce: BigInt(input.nonce),
        attemptExpiresAt: BigInt(Math.floor(attemptExpiresAt.getTime() / 1000)),
      } as const;
      const digest = await verifyPaymentAuthorization({
        message,
        signature: input.signature as `0x${string}`,
        claimedDigest: input.authorizationDigest as `0x${string}`,
      }).catch(() => null);
      if (!digest) {
        response
          .status(401)
          .json({ error: "Invalid payment attempt authorization" });
        return;
      }
      const clientSecret = createOpaqueToken(32);
      const attempt = await prisma.$transaction(async (transaction) => {
        const claimedQuote = await transaction.paymentQuote.updateMany({
          where: {
            id: quote.id,
            paymentIntentId: intent.id,
            usedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { usedAt: new Date() },
        });
        if (claimedQuote.count !== 1)
          throw new AuthError("Quote was already used or expired", 409);
        const active = await transaction.paymentAttempt.findFirst({
          where: { paymentIntentId: intent.id, active: true },
        });
        if (active) {
          const now = new Date();
          const replaceable =
            (active.status === "QUOTED" &&
              active.quoteExpiresAt !== null &&
              active.quoteExpiresAt <= now) ||
            (active.attemptExpiresAt !== null &&
              active.attemptExpiresAt <= now);
          if (!replaceable)
            throw new AuthError(
              "Invoice already has a conflicting active customer attempt",
              409,
            );
          await transaction.paymentAttempt.update({
            where: { id: active.id },
            data: { active: false, status: "EXPIRED" },
          });
        }
        const created = await transaction.paymentAttempt.create({
          data: {
            attemptIdentifier: input.attemptId.toLowerCase(),
            active: true,
            vaultAddress: input.invoiceVault.toLowerCase(),
            orderIdBytes32: intent.orderIdBytes32,
            paymentIntentId: intent.id,
            sourceChainId: input.sourceChainId,
            destinationChainId: input.destinationChainId,
            customerAddress: input.customerAddress.toLowerCase(),
            refundAddress: input.refundAddress.toLowerCase(),
            destinationAmount,
            quotedSourceAmount,
            maximumSourceAmount,
            maxFee: quote.maxFee,
            finalityThreshold: quote.finalityThreshold,
            quoteExpiresAt,
            nonce: BigInt(input.nonce),
            attemptExpiresAt,
            authorizationDigest: digest.toLowerCase(),
            signature: input.signature.toLowerCase(),
            clientSecretHash: hashOpaqueSecret(clientSecret),
            quoteId: quote.id,
            status: "QUOTED",
          },
        });
        await enqueuePaymentWebhook(transaction, {
          eventId: lifecycleWebhookEventId({
            eventType: "payment.attempt.created",
            identity: input.attemptId,
          }),
          eventType: "payment.attempt.created",
          intent,
          data: {
            attemptId: created.id,
            attemptIdentifier: input.attemptId.toLowerCase(),
            sourceChainId: created.sourceChainId,
            customerAddress: created.customerAddress,
            refundAddress: created.refundAddress,
          },
        });
        return created;
      });
      const payload = jsonSafe(attempt);
      delete payload.clientSecretHash;
      delete payload.signature;
      delete payload.authorizationDigest;
      response.status(201).json({ ...payload, clientSecret });
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
      const payload = jsonSafe(attempt);
      delete payload.clientSecretHash;
      delete payload.signature;
      delete payload.authorizationDigest;
      response.json(payload);
    }),
  );

  app.patch(
    "/api/payment-attempts/:id/progress",
    asyncRoute(async (request, response) => {
      const input = paymentAttemptProgressSchema.parse(request.body);
      const attempt = await prisma.paymentAttempt.findUnique({
        where: { id: String(request.params.id) },
        include: { paymentIntent: true },
      });
      if (!attempt) {
        response.status(404).json({ error: "Payment attempt not found" });
        return;
      }
      if (
        !verifyAttemptSecret(
          request.header("x-payment-attempt-secret"),
          attempt.clientSecretHash,
        )
      ) {
        response.status(401).json({ error: "Invalid payment attempt secret" });
        return;
      }
      if (
        [
          "SOURCE_CONFIRMED",
          "ATTESTING",
          "ARC_MINTED",
          "SETTLING",
          "SETTLED",
        ].includes(attempt.status)
      ) {
        const registrationConflicts =
          input.registeredTransactionHash &&
          attempt.registeredTransactionHash !==
            input.registeredTransactionHash.toLowerCase();
        const sourceConflicts =
          input.sourceTransactionHash &&
          attempt.sourceTransactionHash !==
            input.sourceTransactionHash.toLowerCase();
        if (registrationConflicts || sourceConflicts) {
          response.status(409).json({
            error: "Client transaction does not match reconciled attempt",
          });
          return;
        }
        const payload = jsonSafe(attempt);
        delete payload.clientSecretHash;
        delete payload.signature;
        delete payload.authorizationDigest;
        response.json(payload);
        return;
      }
      try {
        assertClientStatusTransition(attempt.status, input.status);
      } catch (error) {
        response.status(409).json({
          error: error instanceof Error ? error.message : "Invalid transition",
        });
        return;
      }
      const registeredTransactionHash =
        input.registeredTransactionHash?.toLowerCase() ??
        attempt.registeredTransactionHash;
      const sourceTransactionHash =
        input.sourceTransactionHash?.toLowerCase() ??
        attempt.sourceTransactionHash;
      if (
        attempt.registeredTransactionHash &&
        input.registeredTransactionHash &&
        attempt.registeredTransactionHash !==
          input.registeredTransactionHash.toLowerCase()
      ) {
        response
          .status(409)
          .json({ error: "Registration transaction cannot change" });
        return;
      }
      if (
        attempt.sourceTransactionHash &&
        input.sourceTransactionHash &&
        attempt.sourceTransactionHash !==
          input.sourceTransactionHash.toLowerCase()
      ) {
        response
          .status(409)
          .json({ error: "Source transaction cannot change" });
        return;
      }
      if (!registeredTransactionHash) {
        response
          .status(400)
          .json({ error: "Registration transaction is required" });
        return;
      }
      if (
        ["BURN_SUBMITTED", "RECOVERABLE"].includes(input.status) &&
        !sourceTransactionHash
      ) {
        response
          .status(400)
          .json({ error: "Source burn transaction is required" });
        return;
      }
      if (input.status === "RECOVERABLE" && !input.bridgeResult) {
        response
          .status(400)
          .json({ error: "Recoverable BridgeResult is required" });
        return;
      }
      const updated = await prisma.$transaction(async (transaction) => {
        const progress = await transaction.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: input.status,
            registeredTransactionHash,
            sourceTransactionHash,
            ...(input.bridgeResult === undefined
              ? {}
              : {
                  bridgeResult: jsonSafe(input.bridgeResult),
                }),
            bridgeRecoverable: input.status === "RECOVERABLE",
            errorCode:
              input.status === "RECOVERABLE"
                ? (input.errorCode ?? attempt.errorCode)
                : null,
            errorMessage:
              input.status === "RECOVERABLE"
                ? (input.errorMessage ?? attempt.errorMessage)
                : null,
          },
        });
        if (
          ["BURN_SUBMITTED", "RECOVERABLE"].includes(input.status) &&
          sourceTransactionHash
        ) {
          await enqueuePaymentWebhook(transaction, {
            eventId: lifecycleWebhookEventId({
              eventType: "payment.source_submitted",
              identity: `${attempt.sourceChainId}:${sourceTransactionHash}`,
            }),
            eventType: "payment.source_submitted",
            intent: attempt.paymentIntent,
            data: {
              attemptId: attempt.id,
              sourceChainId: attempt.sourceChainId,
              sourceTransactionHash,
            },
          });
        }
        return progress;
      });
      const payload = jsonSafe(updated);
      delete payload.clientSecretHash;
      delete payload.signature;
      delete payload.authorizationDigest;
      response.json(payload);
    }),
  );

  app.post(
    "/api/webhooks",
    merchantGuard("webhooks:write"),
    asyncRoute(async (request, response) => {
      const input = webhookInputSchema.parse(request.body);
      assertRequestedMerchant(response, input.merchantAddress);
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
    merchantGuard("webhooks:read"),
    asyncRoute(async (request, response) => {
      const merchantAddress = paymentIntentInputSchema.shape.merchantAddress
        .parse(request.query.merchantAddress)
        .toLowerCase();
      assertRequestedMerchant(response, merchantAddress);
      const endpoints = await prisma.webhookEndpoint.findMany({
        where: { merchant: { walletAddress: merchantAddress } },
        select: {
          id: true,
          url: true,
          events: true,
          active: true,
          createdAt: true,
          deliveries: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: {
              event: true,
              history: { orderBy: { attemptNumber: "desc" }, take: 10 },
            },
          },
        },
      });
      response.json(jsonSafe(endpoints));
    }),
  );

  app.post(
    "/api/webhooks/deliveries/:id/replay",
    merchantGuard("webhooks:write"),
    asyncRoute(async (request, response) => {
      const principal = authenticatedMerchant(response);
      const delivery = await prisma.webhookDelivery.findUnique({
        where: { id: String(request.params.id) },
        include: { webhookEndpoint: true, event: true },
      });
      if (!delivery) {
        response.status(404).json({ error: "Webhook delivery not found" });
        return;
      }
      if (principal?.merchantId !== delivery.webhookEndpoint.merchantId)
        throw new AuthError(
          "Webhook delivery belongs to another merchant",
          403,
        );
      if (delivery.status !== "FAILED") {
        response.status(409).json({
          error: "Only permanently failed deliveries can be replayed",
        });
        return;
      }
      const replayed = await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "PENDING",
          retryCount: 0,
          replayCount: { increment: 1 },
          nextAttemptAt: new Date(),
          deliveredAt: null,
          lastStatusCode: null,
          lastError: null,
          lockToken: null,
          lockedAt: null,
        },
        include: { event: true },
      });
      response.json(jsonSafe(replayed));
    }),
  );

  app.post(
    "/api/webhooks/events/:id/resend",
    merchantGuard("webhooks:write"),
    asyncRoute(async (request, response) => {
      const principal = authenticatedMerchant(response);
      const event = await prisma.webhookEvent.findUnique({
        where: { id: String(request.params.id) },
      });
      if (!event) {
        response.status(404).json({ error: "Webhook event not found" });
        return;
      }
      if (principal?.merchantId !== event.merchantId)
        throw new AuthError("Webhook event belongs to another merchant", 403);
      const endpoints = await prisma.webhookEndpoint.findMany({
        where: {
          merchantId: event.merchantId,
          active: true,
          events: { has: event.eventType },
        },
        select: { id: true },
      });
      const endpointIds = endpoints.map((endpoint) => endpoint.id);
      const resent = await prisma.$transaction(async (transaction) => {
        if (endpointIds.length > 0) {
          await transaction.webhookDelivery.createMany({
            data: endpointIds.map((webhookEndpointId) => ({
              eventId: event.id,
              webhookEndpointId,
            })),
            skipDuplicates: true,
          });
          return transaction.webhookDelivery.updateMany({
            where: {
              eventId: event.id,
              webhookEndpointId: { in: endpointIds },
              status: { not: "PROCESSING" },
            },
            data: {
              status: "PENDING",
              retryCount: 0,
              replayCount: { increment: 1 },
              nextAttemptAt: new Date(),
              deliveredAt: null,
              lastStatusCode: null,
              lastError: null,
              lockToken: null,
              lockedAt: null,
            },
          });
        }
        return { count: 0 };
      });
      response.json({ eventId: event.id, queuedDeliveries: resent.count });
    }),
  );

  app.post(
    "/api/webhooks/:id/test",
    merchantGuard("webhooks:write"),
    asyncRoute(async (request, response) => {
      const principal = authenticatedMerchant(response);
      const endpoint = await prisma.webhookEndpoint.findUnique({
        where: { id: String(request.params.id) },
        include: { merchant: true },
      });
      if (!endpoint) {
        response.status(404).json({ error: "Webhook not found" });
        return;
      }
      if (principal?.merchantId !== endpoint.merchantId)
        throw new AuthError("Webhook belongs to another merchant", 403);
      await assertSafeWebhookUrl(endpoint.url);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const eventId = crypto.randomUUID();
      const body = JSON.stringify({
        id: eventId,
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
          "x-arc-event-id": eventId,
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
      const statusCode =
        error instanceof AuthError
          ? error.statusCode
          : error instanceof ReconciliationError || clientError
            ? 400
            : 500;
      response.status(statusCode).json({
        error:
          statusCode < 500 ? message : "The request could not be completed",
      });
    },
  );

  return app;
}
