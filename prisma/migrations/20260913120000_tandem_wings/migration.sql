ALTER TABLE "Profile" ADD COLUMN "tandemEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "tandemWings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Flight" ADD COLUMN "tandemOverride" BOOLEAN;

-- Before wing defaults existed, populated occupancy and tandem flags were
-- explicit choices. Preserve both solo and tandem, including imported choices.
UPDATE "Flight" SET "tandemOverride" = ("occupancy" = 'tandem' OR 'tandem' = ANY("flightFlags"))
WHERE "occupancy" IS NOT NULL OR 'tandem' = ANY("flightFlags");
