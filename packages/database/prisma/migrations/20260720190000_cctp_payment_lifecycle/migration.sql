ALTER TYPE "AttemptStatus" ADD VALUE IF NOT EXISTS 'RECOVERABLE' AFTER 'ATTESTING';

ALTER TABLE "PaymentAttempt"
  ADD COLUMN "clientSecretHash" TEXT,
  ADD COLUMN "bridgeResult" JSONB,
  ADD COLUMN "bridgeRecoverable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sourceDomain" INTEGER,
  ADD COLUMN "destinationDomain" INTEGER,
  ADD COLUMN "messageHash" TEXT,
  ADD COLUMN "eventNonce" TEXT,
  ADD COLUMN "burnToken" TEXT,
  ADD COLUMN "mintRecipient" TEXT,
  ADD COLUMN "burnAmount" BIGINT,
  ADD COLUMN "mintedAmount" BIGINT,
  ADD COLUMN "finalityThreshold" INTEGER,
  ADD COLUMN "sourceSender" TEXT,
  ADD COLUMN "forwardState" TEXT,
  ADD COLUMN "forwardTxHash" TEXT,
  ADD COLUMN "cctpMessage" TEXT,
  ADD COLUMN "cctpAttestation" TEXT,
  ADD COLUMN "quoteId" TEXT;

CREATE TABLE "PaymentQuote" (
  "id" TEXT NOT NULL,
  "sourceChainId" INTEGER NOT NULL,
  "destinationChainId" INTEGER NOT NULL DEFAULT 5042002,
  "requestedDestinationAmount" BIGINT NOT NULL,
  "protocolFee" BIGINT NOT NULL,
  "forwardFee" BIGINT NOT NULL,
  "feeBuffer" BIGINT NOT NULL,
  "maxFee" BIGINT NOT NULL,
  "maximumSourceAmount" BIGINT NOT NULL,
  "finalityThreshold" INTEGER NOT NULL,
  "transferSpeed" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paymentIntentId" TEXT NOT NULL,
  CONSTRAINT "PaymentQuote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentAttempt_messageHash_key" ON "PaymentAttempt"("messageHash");
CREATE UNIQUE INDEX "PaymentAttempt_forwardTxHash_key" ON "PaymentAttempt"("forwardTxHash");
CREATE UNIQUE INDEX "PaymentAttempt_quoteId_key" ON "PaymentAttempt"("quoteId");
CREATE UNIQUE INDEX "PaymentAttempt_sourceDomain_eventNonce_key"
  ON "PaymentAttempt"("sourceDomain", "eventNonce");
CREATE INDEX "PaymentQuote_paymentIntentId_expiresAt_idx"
  ON "PaymentQuote"("paymentIntentId", "expiresAt");

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "PaymentAttempt_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "PaymentQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentQuote"
  ADD CONSTRAINT "PaymentQuote_paymentIntentId_fkey"
  FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
