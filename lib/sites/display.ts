/**
 * Pure display formatting for the two-level Site/Zone location label
 * (SPRINT-005). No DB/Next imports — by the time a caller has a `siteName`/
 * `zoneName` pair, lib/flights/repo.ts's read-path firewall has already
 * re-verified both against the live rows for the current viewer; this
 * module only composes what's left into one string.
 */

/**
 * "Mission Ridge — North Launch" when both resolve, "Mission Ridge" when
 * only the site does, or null (the caller renders "Unknown site") when
 * neither does. A zone name without a site name is deliberately treated as
 * the site-less case — never rendered bare — so a partially-stripped row
 * (the site hidden, the zone name somehow still present) can never leak a
 * dangling child name with no parent context.
 */
export function formatLocationLabel(
  siteName: string | null,
  zoneName: string | null,
): string | null {
  if (!siteName) return null;
  if (!zoneName) return siteName;
  return `${siteName} — ${zoneName}`;
}
