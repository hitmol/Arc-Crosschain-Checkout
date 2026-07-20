ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'REGISTERED' AFTER 'QUOTED';
ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'EXPIRED' AFTER 'FAILED';

ALTER TABLE "PaymentIntent"
  ALTER COLUMN "refundAddress" DROP NOT NULL;

ALTER TABLE "PaymentAttempt"
  ADD COLUMN "attemptIdentifier" TEXT,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "vaultAddress" TEXT,
  ADD COLUMN "orderIdBytes32" TEXT,
  ADD COLUMN "destinationChainId" INTEGER NOT NULL DEFAULT 5042002,
  ADD COLUMN "refundAddress" TEXT,
  ADD COLUMN "destinationAmount" BIGINT,
  ADD COLUMN "maximumSourceAmount" BIGINT,
  ADD COLUMN "quoteExpiresAt" TIMESTAMP(3),
  ADD COLUMN "nonce" BIGINT,
  ADD COLUMN "attemptExpiresAt" TIMESTAMP(3),
  ADD COLUMN "authorizationDigest" TEXT,
  ADD COLUMN "signature" TEXT,
  ADD COLUMN "registeredTransactionHash" TEXT;

CREATE UNIQUE INDEX "PaymentAttempt_attemptIdentifier_key"
  ON "PaymentAttempt"("attemptIdentifier");
CREATE UNIQUE INDEX "PaymentAttempt_sourceTransactionHash_key"
  ON "PaymentAttempt"("sourceTransactionHash");
CREATE UNIQUE INDEX "PaymentAttempt_cctpMessageId_key"
  ON "PaymentAttempt"("cctpMessageId");
CREATE INDEX "PaymentAttempt_paymentIntentId_active_idx"
  ON "PaymentAttempt"("paymentIntentId", "active");
-- Historical attempts predate customer authorization and must not block a new
-- signed attempt. New records retain the column default of active=true.
UPDATE "PaymentAttempt" SET "active" = false;
CREATE UNIQUE INDEX "PaymentAttempt_one_active_per_invoice_key"
  ON "PaymentAttempt"("paymentIntentId") WHERE "active" = true;
