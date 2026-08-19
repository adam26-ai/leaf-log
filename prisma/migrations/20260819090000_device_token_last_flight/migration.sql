ALTER TABLE "DeviceToken" ADD COLUMN "lastFlightId" TEXT;

CREATE INDEX "DeviceToken_lastFlightId_idx" ON "DeviceToken"("lastFlightId");

ALTER TABLE "DeviceToken"
ADD CONSTRAINT "DeviceToken_lastFlightId_fkey"
FOREIGN KEY ("lastFlightId") REFERENCES "Flight"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
