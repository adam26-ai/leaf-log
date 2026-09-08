ALTER TABLE "Flight" ADD COLUMN "xcStartedAt" TIMESTAMP(3),
ADD COLUMN "metricsVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "launchAltM" INTEGER;

-- Reuse compatible measurements without re-parsing everyone's original files.
UPDATE "Flight" f SET "launchAltM" = round((d.track #>> '{baro,0,1}')::numeric)::integer,
"metricsVersion" = 1
FROM "FlightData" d
WHERE d."flightId" = f.id AND f.status = 'ready' AND f."parserVersion" = '2'
AND f."durationS" IS NOT NULL AND f."maxAltM" IS NOT NULL
AND f."takeoffAt" IS NOT NULL AND f."landingAt" IS NOT NULL
AND jsonb_typeof(d.track #> '{baro,0,1}') = 'number'
AND d.track->>'v' = '1' AND jsonb_typeof(d.replay) = 'object';

-- Missing originals cannot be repaired by repeated Calculate clicks.
UPDATE "Flight" f SET "xcStatus" = 'unavailable', "xcError" = 'The original IGC file is missing, so this flight cannot be calculated.'
WHERE NOT EXISTS (SELECT 1 FROM "FlightData" d WHERE d."flightId" = f.id AND octet_length(d."rawIgc") > 0);
