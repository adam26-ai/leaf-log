import { siteKey, type FlightListItem } from "@/lib/flights/repo";

/**
 * Sibling to `statsFrom` (lib/flights/repo.ts), not an extension of it — ratings
 * math is a different shape (P2/P3/P4 progress) with a different consumer
 * (/ratings), so the logbook stats bar never has to change to support it.
 */
export interface RatingStats {
  flightCount: number;
  flyingDayCount: number;
  totalAirtimeSeconds: number;
  // PR1 has no Flight.flightType yet, so solo airtime can't be distinguished
  // from tandem/tow — this is aliased to totalAirtimeSeconds below and
  // flagged inexact until PR2 lands flightType and un-approximates it.
  soloAirtimeSeconds: number;
  soloAirtimeIsExact: boolean;
  siteCount: number;
  gliderCount: number;
}

// Deliberately undercounts inconsistent wing naming (e.g. two rows that
// really are the same glider but typed differently beyond case/whitespace)
// rather than ever overcounting — the safe direction for a "you've flown at
// least N different gliders" threshold.
export function gliderKey(f: FlightListItem): string | null {
  const trimmed = f.glider?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function ratingStatsFrom(flights: FlightListItem[]): RatingStats {
  const ready = flights.filter((f) => f.status === "ready");

  const totalAirtimeSeconds = ready.reduce((s, f) => s + (f.durationS ?? 0), 0);

  const flyingDayCount = new Set(
    ready
      .map((f) => f.flightDate?.toISOString().slice(0, 10) ?? null)
      .filter((d): d is string => d !== null),
  ).size;

  const siteCount = new Set(
    ready.map(siteKey).filter((k): k is string => k !== null),
  ).size;

  const gliderCount = new Set(
    ready.map(gliderKey).filter((k): k is string => k !== null),
  ).size;

  return {
    flightCount: ready.length,
    flyingDayCount,
    totalAirtimeSeconds,
    soloAirtimeSeconds: totalAirtimeSeconds,
    soloAirtimeIsExact: false,
    siteCount,
    gliderCount,
  };
}
