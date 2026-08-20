export const SITE_VISIBILITIES = ["private", "public"] as const;

export type SiteVisibility = (typeof SITE_VISIBILITIES)[number];

/** Fail-closed: anything unrecognized normalizes to "private". */
export function normalizeSiteVisibility(v: unknown): SiteVisibility {
  return (SITE_VISIBILITIES as readonly unknown[]).includes(v)
    ? (v as SiteVisibility)
    : "private";
}

/**
 * Fail-closed site read-authz. A private site is visible only to its owner —
 * an orphaned private site (`ownerId === null`, e.g. after the owning account
 * was deleted) is visible to nobody, including no viewer (`viewerId === null`).
 */
export function canSeeSite(
  visibility: SiteVisibility,
  ownerId: string | null,
  viewerId: string | null,
): boolean {
  if (visibility === "public") return true;
  return viewerId !== null && ownerId !== null && ownerId === viewerId;
}

/**
 * SPRINT-005: a zone is readable only if BOTH it and its parent site are
 * readable by the viewer — the parent gate is not redundant, since the
 * roll-up display renders the parent's name, so a readable zone under an
 * unreadable site would leak the site. Fail-closed on a missing or
 * mismatched parent (a stale/hand-written Flight row carrying a zone id from
 * a DIFFERENT site than its own site id must never render a mismatched
 * roll-up).
 */
export function canSeeZone(
  zone: { visibility: SiteVisibility; ownerId: string | null; siteId: string },
  site: { id: string; visibility: SiteVisibility; ownerId: string | null } | null,
  viewerId: string | null,
): boolean {
  if (!site || site.id !== zone.siteId) return false;
  if (!canSeeSite(site.visibility, site.ownerId, viewerId)) return false;
  return canSeeSite(zone.visibility, zone.ownerId, viewerId);
}
