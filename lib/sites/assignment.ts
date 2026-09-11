import type { SiteEndpoint } from "./associate";

export const SITE_ASSIGNMENTS = [
  "unassigned",
  "custom_name",
  "auto_matched",
  "user_selected",
  "needs_review",
  "legacy",
] as const;

export type SiteAssignment = (typeof SITE_ASSIGNMENTS)[number];

export function assignmentPatch(endpoint: SiteEndpoint, assignment: SiteAssignment) {
  return endpoint === "takeoff"
    ? { takeoffSiteAssignment: assignment }
    : { landingSiteAssignment: assignment };
}
