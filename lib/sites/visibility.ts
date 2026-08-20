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
