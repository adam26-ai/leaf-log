import { haversineM } from "@/lib/geo/distance";

/**
 * Pure geo helpers for site matching — no DB or Next imports, so this stays
 * unit-testable in isolation from the repo/DB layer that consumes it.
 */

export const TAKEOFF_RADIUS_M = 600;
export const LANDING_RADIUS_M = 900;
// Wider than either match radius on purpose: the "name this site" dialog only
// opens because findSite already returned null at the match radius, so by
// construction nothing visible sits inside 600 m / 900 m. A narrower suggest
// radius would be a no-op.
export const SUGGEST_RADIUS_M = 2000;

export type SiteKind = "takeoff" | "landing" | "both" | "unknown";
export type MatchKind = "takeoff" | "landing";

export function radiusForKind(kind: MatchKind): number {
  return kind === "takeoff" ? TAKEOFF_RADIUS_M : LANDING_RADIUS_M;
}

/** A candidate's kind matches a requested endpoint kind, or is the wildcard "both". */
export function kindMatches(candidateKind: string, requested: MatchKind): boolean {
  return candidateKind === requested || candidateKind === "both";
}

export interface LonRange {
  min: number;
  max: number;
}

export interface BoundingBox {
  latMin: number;
  latMax: number;
  /** One range normally; two when the padded box crosses the ±180° antimeridian. */
  lonRanges: LonRange[];
}

function wrapLon(v: number): number {
  return ((((v + 180) % 360) + 360) % 360) - 180;
}

/**
 * A lat/lon bounding box padded beyond `radiusM`, for use as a cheap indexed
 * prefilter before exact haversine ranking. Always a superset of the true
 * circle (never a false negative) — callers must still filter/rank by exact
 * distance afterward.
 *
 * `cosLat` is clamped away from zero so the box stays bounded near the poles
 * (where a naive `dLon = radius / (111_320 * cos(lat))` blows up toward
 * infinity as `cos(lat) → 0`).
 */
export function boundingBox(
  lat: number,
  lon: number,
  radiusM: number,
  paddingFactor = 1.5,
): BoundingBox {
  const dLat = (radiusM / 111_320) * paddingFactor;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = (radiusM / (111_320 * cosLat)) * paddingFactor;

  const latMin = lat - dLat;
  const latMax = lat + dLat;
  const lonMinRaw = lon - dLon;
  const lonMaxRaw = lon + dLon;

  if (lonMinRaw < -180 || lonMaxRaw > 180) {
    const wMin = wrapLon(lonMinRaw);
    const wMax = wrapLon(lonMaxRaw);
    // After wrapping, min > max means the padded box straddles ±180° — split
    // into the two ranges that together cover the same span.
    if (wMin > wMax) {
      return {
        latMin,
        latMax,
        lonRanges: [
          { min: wMin, max: 180 },
          { min: -180, max: wMax },
        ],
      };
    }
    return { latMin, latMax, lonRanges: [{ min: wMin, max: wMax }] };
  }

  return { latMin, latMax, lonRanges: [{ min: lonMinRaw, max: lonMaxRaw }] };
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** Attach a haversine distance and keep only candidates within `radiusM`. */
export function withinRadius<T extends GeoPoint>(
  candidates: readonly T[],
  lat: number,
  lon: number,
  radiusM: number,
): Array<T & { distanceM: number }> {
  const out: Array<T & { distanceM: number }> = [];
  for (const c of candidates) {
    const distanceM = haversineM(lat, lon, c.lat, c.lon);
    if (distanceM <= radiusM) out.push({ ...c, distanceM });
  }
  return out;
}

export interface RankableSite {
  id: string;
  distanceM: number;
  license?: string | null;
}

/**
 * Deterministic ordering: nearest first, curated sites break distance ties
 * ahead of user-created ones, `id` breaks any remaining tie. Matters most for
 * device push, which has no UI to disambiguate — the winner must never depend
 * on database return order.
 */
export function compareSiteCandidates(a: RankableSite, b: RankableSite): number {
  if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
  const aCurated = a.license === "curated" ? 0 : 1;
  const bCurated = b.license === "curated" ? 0 : 1;
  if (aCurated !== bCurated) return aCurated - bCurated;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
