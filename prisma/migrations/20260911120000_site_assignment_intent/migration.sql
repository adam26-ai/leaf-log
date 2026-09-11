ALTER TABLE "Flight"
ADD COLUMN "takeoffSiteAssignment" TEXT NOT NULL DEFAULT 'unassigned',
ADD COLUMN "landingSiteAssignment" TEXT NOT NULL DEFAULT 'unassigned';

UPDATE "Flight"
SET "takeoffSiteAssignment" = CASE
  WHEN "takeoffSiteId" IS NOT NULL THEN 'legacy'
  WHEN "takeoffSiteName" IS NOT NULL THEN 'custom_name'
  ELSE 'unassigned'
END,
"landingSiteAssignment" = CASE
  WHEN "landingSiteId" IS NOT NULL THEN 'legacy'
  WHEN "landingSiteName" IS NOT NULL THEN 'custom_name'
  ELSE 'unassigned'
END;

ALTER TABLE "Flight"
ADD CONSTRAINT "Flight_takeoffSiteAssignment_check"
CHECK ("takeoffSiteAssignment" IN ('unassigned', 'custom_name', 'auto_matched', 'user_selected', 'needs_review', 'legacy')),
ADD CONSTRAINT "Flight_landingSiteAssignment_check"
CHECK ("landingSiteAssignment" IN ('unassigned', 'custom_name', 'auto_matched', 'user_selected', 'needs_review', 'legacy'));

ALTER TABLE "LocationAuditEntry" DROP CONSTRAINT "audit_action_check";
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "audit_action_check"
CHECK ("action" IN ('create','published','renamed','moved','boundary_set','boundary_cleared','merge'));
