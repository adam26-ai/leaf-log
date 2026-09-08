export interface FilterFlight { takeoffSiteId: string | null; takeoffSiteName: string | null; glider: string | null }
export const siteKey = (f: FilterFlight) => f.takeoffSiteId ?? (f.takeoffSiteName ? `name:${f.takeoffSiteName}` : "unknown");
export const wingKey = (f: FilterFlight) => f.glider?.trim() || "Unknown wing";
export function matchesLogbookFilters(f: FilterFlight & { id: string }, sites: string[] | null, wings: string[] | null, trophiesOnly: boolean, trophyIds: Set<string>) {
  return (sites === null || sites.includes(siteKey(f))) && (wings === null || wings.includes(wingKey(f))) && (!trophiesOnly || trophyIds.has(f.id));
}
