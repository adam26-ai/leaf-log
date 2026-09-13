import { canSeeSite, normalizeSiteVisibility } from "@/lib/sites/visibility";

export const duplicateSiteSelect = { takeoffSite: { select: { name: true, visibility: true, ownerId: true } } } as const;
/** Duplicate review is owner-scoped; private cache columns deliberately have no name. */
export function withOwnerSiteName<T extends { takeoffSiteName: string | null; takeoffSite: { name: string; visibility: string; ownerId: string | null } | null }>(row: T, ownerId: string): T {
  return { ...row, takeoffSiteName: row.takeoffSite ? canSeeSite(normalizeSiteVisibility(row.takeoffSite.visibility), row.takeoffSite.ownerId, ownerId) ? row.takeoffSite.name : null : row.takeoffSiteName };
}
