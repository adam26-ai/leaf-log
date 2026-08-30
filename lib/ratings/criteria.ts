import type { RatingStats } from "@/lib/ratings/stats";

export type RatingLevel = "P2" | "P3" | "P4";

/**
 * Static, data-only description of every P2/P3/P4 criterion from the USHPA
 * research brief. `id` is a stable, append-only identifier — a future PR's
 * `RatingSignoff.criterionKey` references these ids, so once shipped an id is
 * never renamed (labels may change freely). Only `future` rows are safe to
 * leave unassigned to a PR; `auto` and `instructor` rows are committed shape.
 */
export interface RatingCriterion {
  id: string;
  level: RatingLevel;
  label: string;
  kind: "auto" | "instructor" | "future";
  getValue?: (stats: RatingStats) => number;
  required: number;
  unit?: string;
  reason?: string;
}

const SECONDS_PER_HOUR = 3600;

export const RATING_CRITERIA: RatingCriterion[] = [
  // P2 — Novice
  {
    id: "p2_flight_count",
    level: "P2",
    label: "Logged flights",
    kind: "auto",
    getValue: (s) => s.flightCount,
    required: 25,
  },
  {
    id: "p2_ground_school_hours",
    level: "P2",
    label: "Ground-school theory",
    kind: "future",
    required: 8,
    unit: "hours",
    reason: "Not flight data — needs separate manual logging, not built yet.",
  },
  {
    id: "p2_skills_signoff",
    level: "P2",
    label: "Demonstrated skills and knowledge (instructor sign-off)",
    kind: "instructor",
    required: 1,
    reason: "Needs an instructor's sign-off.",
  },
  {
    id: "p2_precision_landings",
    level: "P2",
    label: "Precision landings",
    kind: "instructor",
    required: 3,
    reason: "Needs an instructor's sign-off.",
  },

  // P3 — Intermediate
  {
    id: "p3_flying_days_count",
    level: "P3",
    label: "Flying days",
    kind: "auto",
    getValue: (s) => s.flyingDayCount,
    required: 30,
  },
  {
    id: "p3_flight_count",
    level: "P3",
    label: "Total flights",
    kind: "auto",
    getValue: (s) => s.flightCount,
    required: 90,
  },
  {
    id: "p3_solo_airtime_hours",
    level: "P3",
    label: "Solo airtime",
    kind: "auto",
    getValue: (s) => s.soloAirtimeSeconds / SECONDS_PER_HOUR,
    required: 20,
    unit: "hours",
    reason:
      "Approximated as total airtime until Flight.flightType (a later PR) can exclude tandem/tow flights.",
  },
  {
    id: "p3_skills_signoff",
    level: "P3",
    label: "Demonstrated skills and knowledge (instructor sign-off)",
    kind: "instructor",
    required: 1,
    reason: "Needs an instructor's sign-off.",
  },
  {
    id: "p3_precision_landings",
    level: "P3",
    label: "Precision landings",
    kind: "instructor",
    required: 3,
    reason: "Needs an instructor's sign-off.",
  },

  // P4 — Advanced
  {
    id: "p4_flight_count",
    level: "P4",
    label: "Total flights",
    kind: "auto",
    getValue: (s) => s.flightCount,
    required: 250,
  },
  {
    id: "p4_flying_days_count",
    level: "P4",
    label: "Flying days",
    kind: "auto",
    getValue: (s) => s.flyingDayCount,
    required: 80,
  },
  {
    id: "p4_total_airtime_hours",
    level: "P4",
    label: "Total airtime",
    kind: "auto",
    getValue: (s) => s.totalAirtimeSeconds / SECONDS_PER_HOUR,
    required: 75,
    unit: "hours",
  },
  {
    id: "p4_site_count",
    level: "P4",
    label: "Distinct sites",
    kind: "auto",
    getValue: (s) => s.siteCount,
    required: 5,
  },
  {
    id: "p4_glider_count",
    level: "P4",
    label: "Distinct gliders",
    kind: "auto",
    getValue: (s) => s.gliderCount,
    required: 5,
    reason:
      "Undercounts if the same glider was logged under inconsistent wing-name spellings — undercounting, never overcounting, is the safe direction for this threshold.",
  },
  {
    id: "p4_tandem_sublimits",
    level: "P4",
    label: "Tandem/thermal airtime sub-limits (≤25h of the 75h tandem, ≤10h of the 25h thermal)",
    kind: "future",
    required: 25,
    unit: "hours",
    reason:
      "Needs Flight.flightType (solo/tandem/tow), added in a later PR, to separate tandem airtime from solo.",
  },
  {
    id: "p4_lift_type_hours",
    level: "P4",
    label: "3×1h thermal (≥2 sites) + 1×1h ridge, without sustaining the other lift type",
    kind: "future",
    required: 4,
    unit: "hours",
    reason: "Needs track-shape lift classification (thermal vs. ridge), not built yet.",
  },
  {
    id: "p4_inland_sites",
    level: "P4",
    label: "Sites flown inland",
    kind: "future",
    required: 3,
    reason: "Needs a coastal/inland attribute on Site, which doesn't exist yet.",
  },
  {
    id: "p4_skills_signoff",
    level: "P4",
    label: "Demonstrated skills and knowledge (instructor sign-off)",
    kind: "instructor",
    required: 1,
    reason: "Needs an instructor's sign-off.",
  },
  {
    id: "p4_precision_landings",
    level: "P4",
    label: "Precision landings",
    kind: "instructor",
    required: 3,
    reason: "Needs an instructor's sign-off.",
  },
];

export function criteriaForLevel(level: RatingLevel): RatingCriterion[] {
  return RATING_CRITERIA.filter((c) => c.level === level);
}
