-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_tokenHash_key" ON "DeviceToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DeviceToken_ownerId_idx" ON "DeviceToken"("ownerId");

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
