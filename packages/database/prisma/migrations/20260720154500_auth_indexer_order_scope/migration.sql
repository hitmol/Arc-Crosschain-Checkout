DROP INDEX IF EXISTS "PaymentIntent_orderId_key";
DROP INDEX IF EXISTS "PaymentIntent_orderIdBytes32_key";

CREATE UNIQUE INDEX "PaymentIntent_merchantId_orderId_key"
ON "PaymentIntent"("merchantId", "orderId");

CREATE UNIQUE INDEX "PaymentIntent_merchantId_orderIdBytes32_key"
ON "PaymentIntent"("merchantId", "orderIdBytes32");

ALTER TABLE "PaymentIntent"
  ADD COLUMN "createChainId" INTEGER NOT NULL DEFAULT 5042002,
  ADD COLUMN "settlementMerchantAmount" BIGINT,
  ADD COLUMN "protocolFeeAmount" BIGINT,
  ADD COLUMN "excessAmount" BIGINT,
  ADD COLUMN "refundedAmount" BIGINT,
  ADD COLUMN "settlementLockId" TEXT,
  ADD COLUMN "settlementLockedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "PaymentIntent_createChainId_createTransactionHash_key"
ON "PaymentIntent"("createChainId", "createTransactionHash");

ALTER TABLE "ChainTransaction"
  DROP CONSTRAINT IF EXISTS "ChainTransaction_paymentIntentId_fkey";

ALTER TABLE "ChainTransaction"
  ALTER COLUMN "paymentIntentId" DROP NOT NULL,
  ADD COLUMN "blockHash" TEXT,
  ADD COLUMN "contractAddress" TEXT,
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "merchantId" TEXT;

UPDATE "ChainTransaction"
SET
  "blockHash" = 'legacy-unverified',
  "contractAddress" = '0x0000000000000000000000000000000000000000',
  "payload" = '{"legacy":true}'::jsonb
WHERE "blockHash" IS NULL OR "contractAddress" IS NULL OR "payload" IS NULL;

ALTER TABLE "ChainTransaction"
  ALTER COLUMN "blockHash" SET NOT NULL,
  ALTER COLUMN "contractAddress" SET NOT NULL,
  ALTER COLUMN "payload" SET NOT NULL;

ALTER TABLE "ChainTransaction"
  ADD CONSTRAINT "ChainTransaction_paymentIntentId_fkey"
  FOREIGN KEY ("paymentIntentId") REFERENCES "PaymentIntent"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ChainTransaction_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuthChallenge" (
  "id" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "domain" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthChallenge_nonceHash_key" ON "AuthChallenge"("nonceHash");
CREATE INDEX "AuthChallenge_walletAddress_expiresAt_idx"
ON "AuthChallenge"("walletAddress", "expiresAt");

CREATE TABLE "MerchantSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantSession_tokenHash_key" ON "MerchantSession"("tokenHash");
CREATE INDEX "MerchantSession_walletAddress_expiresAt_idx"
ON "MerchantSession"("walletAddress", "expiresAt");

CREATE TABLE "MerchantApiKey" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopes" TEXT[],
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "merchantId" TEXT NOT NULL,
  CONSTRAINT "MerchantApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MerchantApiKey_keyHash_key" ON "MerchantApiKey"("keyHash");
CREATE INDEX "MerchantApiKey_merchantId_revokedAt_idx"
ON "MerchantApiKey"("merchantId", "revokedAt");

ALTER TABLE "MerchantApiKey"
  ADD CONSTRAINT "MerchantApiKey_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
