export type DuplicateFlight = { id: string; flightDate: Date | null; takeoffAt: Date | null; landingAt: Date | null; localUtcOffsetMinutes: number | null; durationS: number | null; glider: string | null; takeoffSiteName: string | null };
const normalizeName = (value: string | null) => (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function duplicateKey(flight: DuplicateFlight) {
  const date = flight.takeoffAt ? new Date(flight.takeoffAt.getTime() + (flight.localUtcOffsetMinutes ?? 0) * 60000).toISOString().slice(0, 10) : flight.flightDate?.toISOString().slice(0, 10);
  return date ?? "";
}

export function flightTimeInterval(flight: DuplicateFlight) {
  if (!flight.takeoffAt) return null;
  const start = flight.takeoffAt.getTime();
  const end = flight.landingAt?.getTime()
    ?? (flight.durationS != null ? start + flight.durationS * 1000 : NaN);
  return Number.isFinite(end) && end > start ? { start, end } : null;
}

/** Null means at least one flight has no recorded takeoff time to compare. */
export function overlappingFlightTimes(a: DuplicateFlight, b: DuplicateFlight) {
  const first = flightTimeInterval(a), second = flightTimeInterval(b);
  const firstStart = a.takeoffAt?.getTime(), secondStart = b.takeoffAt?.getTime();
  if (firstStart == null || secondStart == null) return null;
  if (first && second) return first.start < second.end && second.start < first.end;
  if (first) return secondStart >= first.start && secondStart < first.end;
  if (second) return firstStart >= second.start && firstStart < second.end;
  return firstStart === secondStart;
}

export function duplicateTimeLabel(flight: DuplicateFlight) {
  const start = flight.takeoffAt?.getTime();
  if (start == null) return null;
  const interval = flightTimeInterval(flight);
  const offset = (flight.localUtcOffsetMinutes ?? 0) * 60_000;
  const clock = (milliseconds: number) => new Date(milliseconds + offset).toISOString().slice(11, 16);
  return interval ? `${clock(interval.start)}–${clock(interval.end)}` : clock(start);
}

export function possibleDuplicate(a: DuplicateFlight, b: DuplicateFlight) {
  const overlaps = overlappingFlightTimes(a, b);
  if (overlaps != null) return overlaps;
  if (duplicateKey(a) !== duplicateKey(b)) return false;
  if (a.durationS != null && b.durationS != null && Math.abs(a.durationS - b.durationS) > 60) return false;
  return normalizeName(a.takeoffSiteName) === normalizeName(b.takeoffSiteName) && normalizeName(a.glider) === normalizeName(b.glider);
}

/**
 * IGC recordings rarely contain a site name, and detected airtime can differ
 * from a rounded logbook duration. Treat matching known fields as evidence and
 * missing fields as unknown, while rejecting known conflicts. This intentionally
 * produces suggestions, never an automatic merge or deletion.
 */
export function possibleIgcDuplicate(a: DuplicateFlight, b: DuplicateFlight) {
  const overlaps = overlappingFlightTimes(a, b);
  if (overlaps != null) return overlaps;
  if (duplicateKey(a) !== duplicateKey(b)) return false;

  const siteA = normalizeName(a.takeoffSiteName), siteB = normalizeName(b.takeoffSiteName);
  const wingA = normalizeName(a.glider), wingB = normalizeName(b.glider);
  const siteMatches = Boolean(siteA && siteB && siteA === siteB);
  const wingMatches = Boolean(wingA && wingB && wingA === wingB);
  if (siteA && siteB && !siteMatches) return false;
  if (wingA && wingB && !wingMatches) return false;

  const durationClose = a.durationS != null && b.durationS != null
    && Math.abs(a.durationS - b.durationS) <= 300;
  return durationClose || (siteMatches && wingMatches);
}
