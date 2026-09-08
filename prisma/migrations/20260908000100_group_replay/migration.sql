ALTER TABLE "FlightData" ADD COLUMN "replay" JSONB;
CREATE INDEX "Flight_ownerId_status_takeoffAt_idx" ON "Flight"("ownerId", "status", "takeoffAt");
