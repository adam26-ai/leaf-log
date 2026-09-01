/**
 * Self-reported USHPA Special-Skill flight tags. These are pilot-entered on
 * the flight-edit page and surfaced on /ratings as tallies only — never as
 * verified progress. USHPA requires an instructor's witness for a Special
 * Skill; a self-reported tag is supporting context for that conversation,
 * not a substitute for it. See lib/ratings/stats.ts (tallying) and
 * app/ratings/page.tsx (display).
 */

export const OCCUPANCIES = ["solo", "tandem"] as const;
export type Occupancy = (typeof OCCUPANCIES)[number];

export const OCCUPANCY_LABELS: Record<Occupancy, string> = {
  solo: "Solo",
  tandem: "Tandem",
};

// Describes the flight as a whole (as opposed to how it launched).
export const FLIGHT_TYPE_TAGS = ["XC"] as const;
export type FlightTypeTag = (typeof FLIGHT_TYPE_TAGS)[number];

export const FLIGHT_TYPE_TAG_LABELS: Record<FlightTypeTag, string> = {
  XC: "Cross Country",
};

export const LAUNCH_TYPES = ["CL", "RS", "FSL", "TUR", "HA", "AWCL", "ST"] as const;
export type LaunchType = (typeof LAUNCH_TYPES)[number];

export const LAUNCH_TYPE_LABELS: Record<LaunchType, string> = {
  CL: "Light Wind Cliff Launch",
  RS: "Ridge Soaring",
  FSL: "Flat Slope Launch",
  TUR: "Turbulence",
  HA: "High Altitude Launch",
  AWCL: "Assisted Windy Launch",
  ST: "Surface Tow",
};

/** Every self-reported skill tag key, spanning flight type + launch + landing. */
export const SKILL_TAG_KEYS = [...FLIGHT_TYPE_TAGS, ...LAUNCH_TYPES, "RLF"] as const;
export type SkillTagKey = (typeof SKILL_TAG_KEYS)[number];

export const SKILL_TAG_LABELS: Record<SkillTagKey, string> = {
  ...FLIGHT_TYPE_TAG_LABELS,
  ...LAUNCH_TYPE_LABELS,
  RLF: "Restricted Landing Field",
};
