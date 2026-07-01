-- CreateTable
CREATE TABLE "DevicePairing" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "pollHandleHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "label" TEXT,
    "claimedByOwnerId" TEXT,
    "deviceTokenId" TEXT,
    -- Plaintext device token is held only after browser claim and before the
    -- device's successful poll. pollPairing clears it when status moves to consumed.
    "tokenPlaintext" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevicePairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevicePairing_codeHash_key" ON "DevicePairing"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePairing_pollHandleHash_key" ON "DevicePairing"("pollHandleHash");

-- CreateIndex
CREATE INDEX "DevicePairing_expiresAt_idx" ON "DevicePairing"("expiresAt");
