export interface FilterFlight { takeoffSiteId: string | null; takeoffSiteName: string | null; glider: string | null }
export const siteKey = (f: FilterFlight) => f.takeoffSiteId ?? (f.takeoffSiteName ? `name:${f.takeoffSiteName}` : "unknown");
export const wingKey = (f: FilterFlight) => f.glider?.trim() || "Unknown wing";
export function matchesLogbookFilters(f: FilterFlight & { id: string }, sites: string[] | null, wings: string[] | null, trophiesOnly: boolean, trophyIds: Set<string>) {
  return (sites === null || sites.includes(siteKey(f))) && (wings === null || wings.includes(wingKey(f))) && (!trophiesOnly || trophyIds.has(f.id));
}

export interface LogbookFilters {
  sites: string[] | null;
  wings: string[] | null;
  friends: string[] | null;
  trophiesOnly: boolean;
  from: string;
  until: string;
}
export const EMPTY_FILTERS: LogbookFilters = { sites: null, wings: null, friends: null, trophiesOnly: false, from: "", until: "" };

/** Read only known fields; old or malformed browser state must not break a logbook. */
export function readLogbookFilters(value: string | null): LogbookFilters {
  try {
    const parsed = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed !== "object") return EMPTY_FILTERS;
    const selection = (key: string) => Array.isArray(parsed[key]) && parsed[key].every((v: unknown) => typeof v === "string") ? parsed[key] as string[] : null;
    const date = (key: string) => typeof parsed[key] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed[key]) ? parsed[key] : "";
    // Retire the old unshared/category selections without leaving invisible filters.
    const friends = selection("friends")?.filter(key => key !== "__no_shared_flights__");
    const trophiesOnly = typeof parsed.trophiesOnly === "boolean" ? parsed.trophiesOnly : Boolean(selection("trophies")?.some(key => key !== "none"));
    return { sites: selection("sites"), wings: selection("wings"), friends: friends?.length ? friends : null, trophiesOnly, from: date("from"), until: date("until") };
  } catch { return EMPTY_FILTERS; }
}

/** Match the date printed in the row, including flights across UTC midnight. */
export function flightCalendarDate(flight: { takeoffAt?: Date | string | null; flightDate?: Date | string | null; localUtcOffsetMinutes?: number | null }): string {
  const value = flight.takeoffAt ?? flight.flightDate;
  if (!value) return "";
  const ms = new Date(value).getTime() + (flight.takeoffAt ? (flight.localUtcOffsetMinutes ?? 0) * 60_000 : 0);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : "";
}

export function matchesDateRange(date: string, from: string, until: string): boolean {
  return (!from && !until) || Boolean(date && (!from || date >= from) && (!until || date <= until));
}
