ALTER TABLE "Flight" ADD COLUMN "xcStatus" TEXT NOT NULL DEFAULT 'unscored',
ADD COLUMN "xcQueuedAt" TIMESTAMP(3), ADD COLUMN "xcError" TEXT;
UPDATE "Flight" SET "xcStatus" = 'ready' WHERE "xcScore" IS NOT NULL AND "xcScore" <> 'null'::jsonb;
CREATE INDEX "Flight_xcStatus_xcQueuedAt_idx" ON "Flight"("xcStatus", "xcQueuedAt");
