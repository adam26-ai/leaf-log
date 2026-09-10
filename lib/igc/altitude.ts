import type { Fix } from "./types";

/** Calibrate once per flight using every valid paired altitude sample. */
export function baroGpsOffset(fixes: Fix[]): number | null {
  const differences = fixes.flatMap((fix) =>
    fix.valid && fix.baroAlt != null && fix.gpsAlt != null &&
    Number.isFinite(fix.baroAlt) && Number.isFinite(fix.gpsAlt)
      ? [fix.gpsAlt - fix.baroAlt] : [],
  ).sort((a, b) => a - b);
  if (differences.length === 0) return null;
  const middle = Math.floor(differences.length / 2);
  return differences.length % 2 ? differences[middle]
    : (differences[middle - 1] + differences[middle]) / 2;
}

/** GPS and corrected baro share one reference, including per-fix fallback. */
export function playbackAltitude(fix: Fix, source: "baro" | "gps", offset: number | null): number | null {
  const baro = fix.baroAlt == null ? null : fix.baroAlt + (offset ?? 0);
  return source === "baro" ? baro ?? fix.gpsAlt : fix.gpsAlt ?? baro;
}

/** Altitude records never fall back to baro or rendering corrections. */
export function recordAltitude(fix: Fix): number | null {
  return fix.valid && fix.gpsAlt != null && Number.isFinite(fix.gpsAlt) ? fix.gpsAlt : null;
}
