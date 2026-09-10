export type DuplicateFlight = { id: string; flightDate: Date | null; takeoffAt: Date | null; localUtcOffsetMinutes: number | null; durationS: number | null; glider: string | null; takeoffSiteName: string | null };
const normalizeName = (value: string | null) => (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function duplicateKey(flight: DuplicateFlight) {
  const date = flight.takeoffAt ? new Date(flight.takeoffAt.getTime() + (flight.localUtcOffsetMinutes ?? 0) * 60000).toISOString().slice(0, 10) : flight.flightDate?.toISOString().slice(0, 10);
  return date ?? "";
}
export function possibleDuplicate(a: DuplicateFlight, b: DuplicateFlight) {
  if (duplicateKey(a) !== duplicateKey(b)) return false;
  if (a.takeoffAt && b.takeoffAt) return Math.abs(a.takeoffAt.getTime() - b.takeoffAt.getTime()) <= 300_000;
  if (a.durationS != null && b.durationS != null && Math.abs(a.durationS - b.durationS) > 60) return false;
  return normalizeName(a.takeoffSiteName) === normalizeName(b.takeoffSiteName) && normalizeName(a.glider) === normalizeName(b.glider);
}
