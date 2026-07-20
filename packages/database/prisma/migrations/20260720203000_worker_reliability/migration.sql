CREATE TYPE "SettlementSubmissionStatus" AS ENUM (
  'CLAIMED',
  'PREPARED',
  'SUBMITTED',
  'CONFIRMED',
  'REVERTED',
  'FAILED'
);

ALTER TABLE "IndexerCursor"
  ADD COLUMN "headBlock" BIGINT,
  ADD COLUMN "finalizedBlock" BIGINT,
  ADD COLUMN "lastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "lastErrorAt" TIMESTAMP(3);

CREATE TABLE "SettlementSubmission" (
  "id" TEXT NOT NULL,
  "lockToken" TEXT NOT NULL,
  "transactionHash" TEXT,
  "rawTransaction" TEXT,
  "status" "SettlementSubmissionStatus" NOT NULL DEFAULT 'CLAIMED',
  "errorMessage" TEXT,
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  CONSTRAINT "SettlementSubmission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SettlementSubmission_lockToken_key"
  ON "SettlementSubmission"("lockToken");
CREATE UNIQUE INDEX "SettlementSubmission_transactionHash_key"
  ON "SettlementSubmission"("transactionHash");
CREATE INDEX "SettlementSubmission_paymentIntentId_createdAt_idx"
  ON "SettlementSubmission"("paymentIntentId", "createdAt");
CREATE INDEX "SettlementSubmission_status_updatedAt_idx"
  ON "SettlementSubmission"("status", "updatedAt");

ALTER TABLE "SettlementSubmission"
  ADD CONSTRAINT "SettlementSubmission_paymentIntentId_fkey"
  FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
