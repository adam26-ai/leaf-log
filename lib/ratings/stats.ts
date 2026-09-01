import { siteKey, type FlightListItem } from "@/lib/flights/repo";
import { SKILL_TAG_KEYS, type SkillTagKey } from "@/lib/ratings/skill-tags";

/**
 * Sibling to `statsFrom` (lib/flights/repo.ts), not an extension of it — ratings
 * math is a different shape (P2/P3/P4 progress) with a different consumer
 * (/ratings), so the logbook stats bar never has to change to support it.
 */
export interface RatingStats {
  flightCount: number;
  flyingDayCount: number;
  totalAirtimeSeconds: number;
  // Excludes tandem flights (occupancy === "tandem"); a null occupancy
  // (every pre-existing row) counts as solo-equivalent.
  soloAirtimeSeconds: number;
  soloAirtimeIsExact: boolean;
  siteCount: number;
  gliderCount: number;
  // Self-reported USHPA Special-Skill tags, tallied across ready flights —
  // how many flights carry each tag. Display-only context on /ratings, never
  // proof of a verified skill (that needs an instructor's sign-off).
  skillTagCounts: Record<SkillTagKey, number>;
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
  const soloAirtimeSeconds = ready.reduce(
    (s, f) => s + (f.occupancy === "tandem" ? 0 : (f.durationS ?? 0)),
    0,
  );

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

  const skillTagCounts = Object.fromEntries(
    SKILL_TAG_KEYS.map((key) => [key, 0]),
  ) as Record<SkillTagKey, number>;
  for (const f of ready) {
    for (const tag of f.flightTypeTags) {
      if ((SKILL_TAG_KEYS as readonly string[]).includes(tag)) {
        skillTagCounts[tag as SkillTagKey]++;
      }
    }
    for (const tag of f.launchTypes) {
      if ((SKILL_TAG_KEYS as readonly string[]).includes(tag)) {
        skillTagCounts[tag as SkillTagKey]++;
      }
    }
    if (f.restrictedLandingField) skillTagCounts.RLF++;
  }

  return {
    flightCount: ready.length,
    flyingDayCount,
    totalAirtimeSeconds,
    soloAirtimeSeconds,
    soloAirtimeIsExact: true,
    siteCount,
    gliderCount,
    skillTagCounts,
  };
}
