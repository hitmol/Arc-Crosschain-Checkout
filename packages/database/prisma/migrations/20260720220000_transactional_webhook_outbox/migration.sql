CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "merchantId" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

ALTER TYPE "WebhookDeliveryStatus" ADD VALUE IF NOT EXISTS 'PROCESSING' AFTER 'PENDING';

CREATE UNIQUE INDEX "WebhookEvent_sequence_key"
  ON "WebhookEvent"("sequence");
CREATE INDEX "WebhookEvent_paymentIntentId_sequence_idx"
  ON "WebhookEvent"("paymentIntentId", "sequence");
CREATE INDEX "WebhookEvent_merchantId_createdAt_idx"
  ON "WebhookEvent"("merchantId", "createdAt");

ALTER TABLE "WebhookEvent"
  ADD CONSTRAINT "WebhookEvent_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent"
  ADD CONSTRAINT "WebhookEvent_paymentIntentId_fkey"
  FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve legacy queued deliveries by promoting their immutable payloads to
-- outbox events. Invalid legacy rows cannot have been delivered safely and are
-- removed before the new required foreign key is added.
INSERT INTO "WebhookEvent" (
  "id", "eventType", "payload", "createdAt", "merchantId", "paymentIntentId"
)
SELECT
  delivery."eventId",
  delivery."eventType",
  delivery."payload",
  delivery."createdAt",
  endpoint."merchantId",
  intent."id"
FROM "WebhookDelivery" AS delivery
JOIN "WebhookEndpoint" AS endpoint
  ON endpoint."id" = delivery."webhookEndpointId"
JOIN "PaymentIntent" AS intent
  ON intent."id" = delivery."payload" ->> 'invoiceId'
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "WebhookDelivery" AS delivery
WHERE NOT EXISTS (
  SELECT 1 FROM "WebhookEvent" AS event WHERE event."id" = delivery."eventId"
);

DROP INDEX "WebhookDelivery_eventId_key";
ALTER TABLE "WebhookDelivery"
  DROP COLUMN "eventType",
  DROP COLUMN "payload",
  ADD COLUMN "replayCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockToken" TEXT,
  ADD COLUMN "lockedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "WebhookDelivery_eventId_webhookEndpointId_key"
  ON "WebhookDelivery"("eventId", "webhookEndpointId");
CREATE INDEX "WebhookDelivery_webhookEndpointId_createdAt_idx"
  ON "WebhookDelivery"("webhookEndpointId", "createdAt");
CREATE UNIQUE INDEX "WebhookDelivery_lockToken_key"
  ON "WebhookDelivery"("lockToken");
CREATE INDEX "WebhookDelivery_status_lockedAt_idx"
  ON "WebhookDelivery"("status", "lockedAt");
ALTER TABLE "WebhookDelivery"
  ADD CONSTRAINT "WebhookDelivery_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebhookDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "responseStatus" INTEGER,
  "errorMessage" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "webhookDeliveryId" TEXT NOT NULL,
  CONSTRAINT "WebhookDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookDeliveryAttempt_webhookDeliveryId_attemptNumber_key"
  ON "WebhookDeliveryAttempt"("webhookDeliveryId", "attemptNumber");
CREATE INDEX "WebhookDeliveryAttempt_webhookDeliveryId_requestedAt_idx"
  ON "WebhookDeliveryAttempt"("webhookDeliveryId", "requestedAt");
ALTER TABLE "WebhookDeliveryAttempt"
  ADD CONSTRAINT "WebhookDeliveryAttempt_webhookDeliveryId_fkey"
  FOREIGN KEY ("webhookDeliveryId") REFERENCES "WebhookDelivery"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
