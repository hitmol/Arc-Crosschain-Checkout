import {
  Prisma,
  prisma,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEvent,
} from "@arc-checkout/database";
import { randomUUID } from "node:crypto";

export const WEBHOOK_MAX_ATTEMPTS = 8;
export const WEBHOOK_LOCK_TIMEOUT_MS = 60_000;

export type ClaimedWebhookDelivery = WebhookDelivery & {
  event: WebhookEvent;
  webhookEndpoint: WebhookEndpoint;
};

export function webhookRetryDelayMs(retryCount: number): number {
  return Math.min(300_000, 2 ** retryCount * 1_000);
}

export async function claimWebhookDelivery(
  now = new Date(),
): Promise<ClaimedWebhookDelivery | null> {
  const lockToken = randomUUID();
  const staleBefore = new Date(now.getTime() - WEBHOOK_LOCK_TIMEOUT_MS);
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH candidate AS (
      SELECT delivery."id"
      FROM "WebhookDelivery" AS delivery
      JOIN "WebhookEvent" AS event ON event."id" = delivery."eventId"
      WHERE (
        (
          delivery."status" IN (
            'PENDING'::"WebhookDeliveryStatus",
            'RETRYING'::"WebhookDeliveryStatus"
          )
          AND delivery."nextAttemptAt" <= ${now}
        ) OR (
          delivery."status" = 'PROCESSING'::"WebhookDeliveryStatus"
          AND delivery."lockedAt" < ${staleBefore}
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "WebhookDelivery" AS prior_delivery
        JOIN "WebhookEvent" AS prior_event
          ON prior_event."id" = prior_delivery."eventId"
        WHERE prior_delivery."webhookEndpointId" = delivery."webhookEndpointId"
          AND prior_event."paymentIntentId" = event."paymentIntentId"
          AND prior_event."sequence" < event."sequence"
          AND prior_delivery."status" <> 'DELIVERED'::"WebhookDeliveryStatus"
      )
      ORDER BY event."sequence" ASC
      FOR UPDATE OF delivery SKIP LOCKED
      LIMIT 1
    )
    UPDATE "WebhookDelivery" AS delivery
    SET
      "status" = 'PROCESSING'::"WebhookDeliveryStatus",
      "lockToken" = ${lockToken},
      "lockedAt" = ${now},
      "attempts" = delivery."attempts" + 1,
      "retryCount" = delivery."retryCount" + 1
    FROM candidate
    WHERE delivery."id" = candidate."id"
    RETURNING delivery."id"
  `);
  const id = claimed[0]?.id;
  if (!id) return null;
  return prisma.webhookDelivery.findUniqueOrThrow({
    where: { id },
    include: { event: true, webhookEndpoint: true },
  });
}

export async function recordWebhookAttemptStart(
  delivery: ClaimedWebhookDelivery,
): Promise<string> {
  const attempt = await prisma.webhookDeliveryAttempt.create({
    data: {
      webhookDeliveryId: delivery.id,
      attemptNumber: delivery.attempts,
    },
    select: { id: true },
  });
  return attempt.id;
}

export async function completeWebhookAttempt(input: {
  delivery: ClaimedWebhookDelivery;
  attemptId: string;
  responseStatus?: number;
  errorMessage?: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const success = input.responseStatus !== undefined && !input.errorMessage;
  const permanent =
    !success && input.delivery.retryCount >= WEBHOOK_MAX_ATTEMPTS;
  if (!input.delivery.lockToken)
    throw new Error("Claimed webhook delivery is missing its lock token");
  await prisma.$transaction([
    prisma.webhookDeliveryAttempt.update({
      where: { id: input.attemptId },
      data: {
        responseStatus: input.responseStatus ?? null,
        errorMessage: input.errorMessage?.slice(0, 500) ?? null,
        completedAt: now,
      },
    }),
    prisma.webhookDelivery.update({
      where: {
        id: input.delivery.id,
        lockToken: input.delivery.lockToken,
      },
      data: success
        ? {
            status: "DELIVERED",
            deliveredAt: now,
            lastStatusCode: input.responseStatus ?? null,
            lastError: null,
            lockToken: null,
            lockedAt: null,
          }
        : {
            status: permanent ? "FAILED" : "RETRYING",
            lastStatusCode: input.responseStatus ?? null,
            lastError: input.errorMessage?.slice(0, 500) ?? "unknown",
            nextAttemptAt: new Date(
              now.getTime() + webhookRetryDelayMs(input.delivery.retryCount),
            ),
            lockToken: null,
            lockedAt: null,
          },
    }),
  ]);
}

export async function processWebhookQueue(
  deliver: (
    endpoint: WebhookEndpoint,
    payload: object,
    eventId: string,
  ) => Promise<Response>,
  limit = 25,
): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const delivery = await claimWebhookDelivery();
    if (!delivery) break;
    const attemptId = await recordWebhookAttemptStart(delivery);
    try {
      const response = await deliver(
        delivery.webhookEndpoint,
        delivery.event.payload as object,
        delivery.event.id,
      );
      if (!response.ok) {
        await completeWebhookAttempt({
          delivery,
          attemptId,
          responseStatus: response.status,
          errorMessage: `HTTP ${response.status}`,
        });
      } else {
        await completeWebhookAttempt({
          delivery,
          attemptId,
          responseStatus: response.status,
        });
      }
    } catch (error) {
      await completeWebhookAttempt({
        delivery,
        attemptId,
        errorMessage: error instanceof Error ? error.message : "unknown",
      });
    }
    processed += 1;
  }
  return processed;
}
