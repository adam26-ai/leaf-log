-- SPRINT-004 PR1: ownable, scoped sites. Adds columns nullable, backfills every
-- existing (curated) row, then locks NOT NULL. Every existing Site row has no
-- owner, so it becomes public + unowned, which matches curated-seed behavior.

-- AlterTable
ALTER TABLE "Site" ADD COLUMN "normalizedName" TEXT;
ALTER TABLE "Site" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Site" ADD COLUMN "updatedAt" TIMESTAMP(3);
ALTER TABLE "Site" ADD COLUMN "visibility" TEXT;

-- Backfill: curated rows are public, unowned, and get a first-pass normalized
-- name (lowercased, trimmed, whitespace-collapsed). lib/sites/name.ts's NFKC
-- normalization applies to every user-created name going forward; this
-- approximation is sufficient for the small, curated, already-distinct set.
UPDATE "Site"
SET
  "normalizedName" = lower(trim(regexp_replace("name", '\s+', ' ', 'g'))),
  "updatedAt" = COALESCE("createdAt", now()),
  "visibility" = 'public'
WHERE "normalizedName" IS NULL;

ALTER TABLE "Site" ALTER COLUMN "normalizedName" SET NOT NULL;
ALTER TABLE "Site" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "Site" ALTER COLUMN "visibility" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Flight_takeoffSiteId_idx" ON "Flight"("takeoffSiteId");
CREATE INDEX "Flight_landingSiteId_idx" ON "Flight"("landingSiteId");
CREATE INDEX "Site_ownerId_idx" ON "Site"("ownerId");
CREATE INDEX "Site_ownerId_normalizedName_idx" ON "Site"("ownerId", "normalizedName");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma v6 cannot represent CHECK constraints in schema.prisma, so these raw
-- SQL constraints intentionally live here. migrate-diff drift for these checks
-- is expected; do not delete them to "fix" drift. Deliberately NO "private ⇒
-- owned" CHECK — it would be incompatible with onDelete: SetNull on ownerId
-- (deleting a User cascades to Profile, fires SET NULL, and would violate such
-- a CHECK, breaking teardown in every integration suite). The read predicate
-- fails closed instead: an orphaned private site is readable by nobody.
ALTER TABLE "Site" ADD CONSTRAINT "site_visibility_check" CHECK ("visibility" IN ('private','public'));
ALTER TABLE "Site" ADD CONSTRAINT "site_kind_check" CHECK ("kind" IN ('takeoff','landing','both','unknown'));
ALTER TABLE "Site" ADD CONSTRAINT "site_source_check" CHECK ("source" IN ('manual','user'));
