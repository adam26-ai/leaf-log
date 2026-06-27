-- Feed access path: accepted-friend owner ids + ready status + newest dates.
CREATE INDEX "Flight_ownerId_status_flightDate_idx" ON "Flight"("ownerId", "status", "flightDate");
