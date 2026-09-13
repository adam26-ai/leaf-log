-- Expand first: old coordinates and selections are retained. Historical name
-- conversion is a separate, previewable operation, never a deployment side effect.
ALTER TABLE "Site" ALTER COLUMN "lat" DROP NOT NULL;
ALTER TABLE "Site" ALTER COLUMN "lon" DROP NOT NULL;
ALTER TABLE "Site" ADD COLUMN "pinSource" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "Site" ADD COLUMN "autoGroupKey" TEXT;
ALTER TABLE "Site" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Site_ownerId_autoGroupKey_key" ON "Site"("ownerId", "autoGroupKey");
ALTER TABLE "Site" ADD CONSTRAINT "Site_pin_pair_check" CHECK (
  ("lat" IS NULL AND "lon" IS NULL) OR
  ("lat" IS NOT NULL AND "lon" IS NOT NULL AND "lat" BETWEEN -90 AND 90 AND "lon" BETWEEN -180 AND 180)
);
ALTER TABLE "Site" ADD CONSTRAINT "Site_public_pin_check" CHECK ("visibility" <> 'public' OR "lat" IS NOT NULL);
ALTER TABLE "Site" ADD CONSTRAINT "Site_boundary_pin_check" CHECK ("boundary" IS NULL OR "lat" IS NOT NULL);
ALTER TABLE "Flight" ADD COLUMN "takeoffLocationSource" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "Flight" ADD COLUMN "landingLocationSource" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "Flight" ADD COLUMN "takeoffLocationEvidence" JSONB;
ALTER TABLE "Flight" ADD COLUMN "landingLocationEvidence" JSONB;
ALTER TABLE "LogbookImport" ADD COLUMN "siteChanges" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Flight" DROP CONSTRAINT "Flight_takeoffSiteAssignment_check";
ALTER TABLE "Flight" DROP CONSTRAINT "Flight_landingSiteAssignment_check";
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_takeoffSiteAssignment_check" CHECK ("takeoffSiteAssignment" IN ('unassigned','custom_name','auto_matched','user_selected','needs_review','legacy','imported','cleared'));
ALTER TABLE "Flight" ADD CONSTRAINT "Flight_landingSiteAssignment_check" CHECK ("landingSiteAssignment" IN ('unassigned','custom_name','auto_matched','user_selected','needs_review','legacy','imported','cleared'));
ALTER TABLE "LocationAuditEntry" DROP CONSTRAINT "audit_action_check";
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "audit_action_check" CHECK ("action" IN ('create','published','renamed','moved','updated','boundary_set','boundary_cleared','merge'));
