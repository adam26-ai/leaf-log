ALTER TABLE "Profile" ADD COLUMN "hiddenWings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Flight" ADD COLUMN "flightFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "Flight" SET "flightFlags" = array_remove(ARRAY[
  CASE WHEN "occupancy" = 'tandem' THEN 'tandem' END,
  CASE WHEN 'ST' = ANY("launchTypes") THEN 'tow' END
], NULL);
