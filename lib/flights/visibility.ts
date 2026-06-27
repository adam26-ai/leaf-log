export const FLIGHT_VISIBILITIES = ["private", "friends", "public"] as const;

export type FlightVisibility = (typeof FLIGHT_VISIBILITIES)[number];

export function normalizeVisibility(v: unknown): FlightVisibility {
  return (FLIGHT_VISIBILITIES as readonly unknown[]).includes(v)
    ? (v as FlightVisibility)
    : "private";
}

export function canSee(
  visibility: FlightVisibility,
  isOwner: boolean,
  isFriend: boolean,
): boolean {
  if (isOwner) return true;
  if (visibility === "public") return true;
  if (visibility === "friends") return isFriend;
  return false;
}
