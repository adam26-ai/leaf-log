-- AlterTable
ALTER TABLE "Flight" ADD COLUMN     "landingZoneId" TEXT,
ADD COLUMN     "landingZoneName" TEXT,
ADD COLUMN     "takeoffZoneId" TEXT,
ADD COLUMN     "takeoffZoneName" TEXT;

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'unknown',
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "ownerId" TEXT,
    "visibility" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Zone_lat_lon_idx" ON "Zone"("lat", "lon");

-- CreateIndex
CREATE INDEX "Zone_siteId_idx" ON "Zone"("siteId");

-- CreateIndex
CREATE INDEX "Zone_siteId_normalizedName_idx" ON "Zone"("siteId", "normalizedName");

-- CreateIndex
CREATE INDEX "Zone_ownerId_idx" ON "Zone"("ownerId");

-- CreateIndex
CREATE INDEX "Flight_takeoffZoneId_idx" ON "Flight"("takeoffZoneId");

-- CreateIndex
CREATE INDEX "Flight_landingZoneId_idx" ON "Flight"("landingZoneId");

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_takeoffZoneId_fkey" FOREIGN KEY ("takeoffZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_landingZoneId_fkey" FOREIGN KEY ("landingZoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SPRINT-005 PR1: Prisma v6 cannot represent CHECK constraints or partial
-- indexes in schema.prisma, so these raw SQL additions intentionally live
-- here. migrate-diff drift for them is expected; do not delete them to "fix"
-- drift — see docs/sprints/SPRINT-005.md.
ALTER TABLE "Zone" ADD CONSTRAINT "zone_visibility_check" CHECK ("visibility" IN ('private','public'));
ALTER TABLE "Zone" ADD CONSTRAINT "zone_kind_check" CHECK ("kind" IN ('takeoff','landing','both','unknown'));

-- Sibling-name uniqueness applies ONLY to PUBLIC zones. A private zone must
-- never be able to block — or, via a P2002 conflict, reveal the existence
-- of — a public zone with the same name under the same site. Two private
-- zones (or a private and a not-yet-public zone) sharing a sibling name is a
-- data-quality nit, not a correctness issue — the same posture SPRINT-004
-- took on site-name duplicates.
CREATE UNIQUE INDEX "zone_public_sibling_name_unique"
  ON "Zone" ("siteId", "normalizedName")
  WHERE "visibility" = 'public';
