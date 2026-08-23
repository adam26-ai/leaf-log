-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "boundary" JSONB,
ADD COLUMN     "boundaryMaxLat" DOUBLE PRECISION,
ADD COLUMN     "boundaryMaxLon" DOUBLE PRECISION,
ADD COLUMN     "boundaryMinLat" DOUBLE PRECISION,
ADD COLUMN     "boundaryMinLon" DOUBLE PRECISION,
ADD COLUMN     "boundaryUpdatedById" TEXT;

-- AlterTable
ALTER TABLE "Zone" ADD COLUMN     "boundary" JSONB,
ADD COLUMN     "boundaryMaxLat" DOUBLE PRECISION,
ADD COLUMN     "boundaryMaxLon" DOUBLE PRECISION,
ADD COLUMN     "boundaryMinLat" DOUBLE PRECISION,
ADD COLUMN     "boundaryMinLon" DOUBLE PRECISION,
ADD COLUMN     "boundaryUpdatedById" TEXT;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_boundaryUpdatedById_fkey" FOREIGN KEY ("boundaryUpdatedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_boundaryUpdatedById_fkey" FOREIGN KEY ("boundaryUpdatedById") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SPRINT-006: Prisma v6 cannot express CHECK constraints or partial indexes
-- in schema.prisma, so these raw SQL additions intentionally live here.
-- migrate-diff drift for them is expected; do not delete them to "fix"
-- drift — see docs/sprints/SPRINT-006.md.
--
-- All five geometry columns move together or not at all — boundaryColumns()
-- in lib/sites/associate.ts is the sole writer that enforces this at the app
-- layer; this CHECK is the DB-layer backstop against a hand-written or
-- partially-reverted row.
ALTER TABLE "Site" ADD CONSTRAINT "site_boundary_bbox_check"
  CHECK (num_nulls("boundary", "boundaryMinLat", "boundaryMaxLat", "boundaryMinLon", "boundaryMaxLon") IN (0, 5));

ALTER TABLE "Zone" ADD CONSTRAINT "zone_boundary_bbox_check"
  CHECK (num_nulls("boundary", "boundaryMinLat", "boundaryMaxLat", "boundaryMinLon", "boundaryMaxLon") IN (0, 5));

-- A set-reducing partial index restricting the match-time prefilter scan to
-- boundary-bearing rows (expected to be a small minority) — NOT a spatial
-- index; it does not seek within the boundary-bearing set, it only excludes
-- the (presumably much larger) circle-only set from the scan entirely. See
-- docs/sprints/SPRINT-006.md's Architecture section for the honest framing
-- and the named upgrade path (core-Postgres box + GiST) if scale ever
-- demands it.
CREATE INDEX "Site_boundary_bbox_idx"
  ON "Site" ("boundaryMinLat", "boundaryMaxLat")
  WHERE "boundary" IS NOT NULL;

CREATE INDEX "Zone_boundary_bbox_idx"
  ON "Zone" ("boundaryMinLat", "boundaryMaxLat")
  WHERE "boundary" IS NOT NULL;
