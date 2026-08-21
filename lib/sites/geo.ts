import { haversineM } from "@/lib/geo/distance";

/**
 * Pure geo helpers for site matching — no DB or Next imports, so this stays
 * unit-testable in isolation from the repo/DB layer that consumes it.
 */

export const TAKEOFF_RADIUS_M = 600;
export const LANDING_RADIUS_M = 900;
// Wider than either match radius on purpose: the "name this site" dialog only
// opens because findLocation already returned null at the match radius, so by
// construction nothing visible sits inside 600 m / 900 m. A narrower suggest
// radius would be a no-op.
export const SUGGEST_RADIUS_M = 2000;

// SPRINT-005: the ZONE radius answers "which of these adjacent spots is
// this?" — tighter than the SITE radius, which answers "which named place is
// this?" Roughly half the site radius, preserving the same takeoff/landing
// asymmetry (landings scatter more than launches). The site pass still runs
// as a fallback whenever the zone pass misses — see lib/sites/lookup.ts's
// findLocation — so a tighter zone radius never creates a dead end, only a
// less precise match.
export const ZONE_TAKEOFF_RADIUS_M = 300;
export const ZONE_LANDING_RADIUS_M = 400;

export type SiteKind = "takeoff" | "landing" | "both" | "unknown";
export type MatchKind = "takeoff" | "landing";

export function radiusForKind(kind: MatchKind): number {
  return kind === "takeoff" ? TAKEOFF_RADIUS_M : LANDING_RADIUS_M;
}

export function zoneRadiusForKind(kind: MatchKind): number {
  return kind === "takeoff" ? ZONE_TAKEOFF_RADIUS_M : ZONE_LANDING_RADIUS_M;
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

// ---------------------------------------------------------------------
// SPRINT-006: custom polygon boundaries. A boundary REPLACES the radius
// circle for the row that has one — see lib/sites/boundary.ts for
// validation/normalization and docs/sprints/SPRINT-006.md for the full
// design. Everything below is pure — no DB, no Next — mirroring
// boundingBox/withinRadius above.
// ---------------------------------------------------------------------

export interface Ring {
  /** [lon, lat] pairs, GeoJSON order, closed (first === last). */
  coordinates: [number, number][];
}

export interface BoundaryGeometry {
  type: "Polygon";
  /** Exactly one ring — v1 has no holes, no MultiPolygon. */
  coordinates: [number, number][][];
}

export interface Boundary {
  v: 1;
  kind: "polygon";
  geometry: BoundaryGeometry;
}

/** A vertex or the point on the segment nearest it is within this many
 *  metres counts as "on the edge" — an order of magnitude below GPS fix
 *  noise, so it's invisible in practice but deterministic and testable,
 *  unlike leaving the ray-cast to decide (which is undefined exactly on
 *  a boundary and flips on floating-point luck). */
export const EDGE_TOLERANCE_M = 0.5;

function ringOf(boundary: Boundary): Ring {
  return { coordinates: boundary.geometry.coordinates[0] };
}

/** Perpendicular distance (metres) from (lat, lon) to the segment [a, b],
 *  both given as [lon, lat]. Small-extent equirectangular projection about
 *  the point itself — centimetre-accurate at launch scale, matching the
 *  approximation boundingBox()/area already make. */
function distanceToSegmentM(
  lat: number,
  lon: number,
  a: [number, number],
  b: [number, number],
): number {
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const toXY = ([lo, la]: [number, number]): [number, number] => [
    (lo - lon) * 111_320 * cosLat,
    (la - lat) * 111_320,
  ];
  const [px, py] = [0, 0]; // the query point, at the projection's own origin
  const [ax, ay] = toXY(a);
  const [bx, by] = toXY(b);

  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

/** True when (lat, lon) is within EDGE_TOLERANCE_M of any edge of the ring
 *  (including the vertices themselves, which are edge endpoints). */
export function pointOnRingEdge(ring: Ring, lat: number, lon: number): boolean {
  const pts = ring.coordinates;
  for (let i = 0; i < pts.length - 1; i++) {
    if (distanceToSegmentM(lat, lon, pts[i], pts[i + 1]) <= EDGE_TOLERANCE_M) return true;
  }
  return false;
}

/** Ray-casting, strict interior test — undefined ON the boundary by
 *  construction, which is why callers always run pointOnRingEdge FIRST and
 *  short-circuit to "inside" there. Half-open edge rule (`(yi > y) !== (yj > y)`)
 *  so a ray passing exactly through a vertex is counted once, not twice. */
function pointStrictlyInRing(ring: Ring, lat: number, lon: number): boolean {
  const pts = ring.coordinates;
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length - 1; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** The inclusive membership test — on a vertex or edge counts as inside,
 *  matching withinRadius's existing inclusive `<=`. */
export function boundaryContains(boundary: Boundary, lat: number, lon: number): boolean {
  const ring = ringOf(boundary);
  if (pointOnRingEdge(ring, lat, lon)) return true;
  return pointStrictlyInRing(ring, lat, lon);
}

export interface BoundaryBoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** The ring's own bounding box — the DB prefilter's boundary branch is
 *  seeded from these four numbers, not from the anchor + a radius. */
export function boundaryBoundingBox(boundary: Boundary): BoundaryBoundingBox {
  const pts = ringOf(boundary).coordinates;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [lon, lat] of pts) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

/** Shoelace area on an equirectangular projection about the ring's own
 *  centroid — accurate to well under 0.1% at launch scale, computed in
 *  METRES (not raw degrees, which would be wrong by cos(lat) at real
 *  latitudes). Always non-negative regardless of winding. */
export function ringAreaM2(ring: Ring): number {
  const pts = ring.coordinates;
  if (pts.length < 4) return 0; // fewer than 3 distinct vertices + closing repeat

  let sumLat = 0;
  let sumLon = 0;
  for (const [lon, lat] of pts) {
    sumLat += lat;
    sumLon += lon;
  }
  const centroidLat = sumLat / pts.length;
  const cosLat = Math.max(0.01, Math.cos((centroidLat * Math.PI) / 180));

  const xy = pts.map(([lon, lat]): [number, number] => [
    (lon - sumLon / pts.length) * 111_320 * cosLat,
    (lat - centroidLat) * 111_320,
  ]);

  let twiceArea = 0;
  for (let i = 0; i < xy.length - 1; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[i + 1];
    twiceArea += x1 * y2 - x2 * y1;
  }
  return Math.abs(twiceArea) / 2;
}

function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const d = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return (d1 > 0 !== d2 > 0) && (d3 > 0 !== d4 > 0);
}

/** True if any two NON-ADJACENT edges of the ring cross OR touch (a bow-tie,
 *  or a figure-eight sharing one non-adjacent vertex). Only INDEX-adjacent
 *  segments (and the wrap-around pair) are excluded, not every pair that
 *  happens to share coordinates — so a ring that revisits an earlier vertex
 *  is conservatively rejected too: it has no well-defined single interior at
 *  that point, and refusing it at write time is the only way the
 *  match-time answer stays meaningful. O(n²); bounded by the vertex cap. */
export function ringSelfIntersects(ring: Ring): boolean {
  const pts = ring.coordinates;
  const segCount = pts.length - 1; // closed ring: last point repeats the first
  for (let i = 0; i < segCount; i++) {
    for (let j = i + 1; j < segCount; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === segCount - 1);
      if (adjacent) continue;
      if (segmentsIntersect(pts[i], pts[i + 1], pts[j], pts[j + 1])) return true;
    }
  }
  return false;
}

export interface LocationMatchResult {
  matched: boolean;
  distanceM: number;
}

/**
 * THE composition point: "boundary if present, else circle" is decided
 * here, and only here — findLocation, reassociateOwnFlights, and
 * suggestNearbyLocations all call this and nothing else, so the rule can
 * never drift between call sites. `distanceM` is ALWAYS haversine-to-anchor,
 * computed unconditionally regardless of which shape decided `matched` —
 * this is what gives a polygon-matched row a real, comparable distance to
 * rank by, so compareSiteCandidates needs no separate membership-tier logic
 * (see docs/sprints/SPRINT-006.md's Open Questions Q2 for why no tier was
 * added despite one being proposed during planning).
 *
 * A boundary that fails to parse/validate is treated as `matched: false` —
 * fail closed, never thrown, never silently re-checked against the circle
 * (which would undo a pilot's deliberate tightening). Callers that detect
 * this should log it; this function itself has no logging side effect
 * since it's called from hot, pure-context code paths.
 */
export function locationMatches(
  row: { lat: number; lon: number; boundary: unknown },
  lat: number,
  lon: number,
  radiusM: number,
): LocationMatchResult {
  const distanceM = haversineM(lat, lon, row.lat, row.lon);

  if (row.boundary == null) {
    return { matched: distanceM <= radiusM, distanceM };
  }

  const boundary = row.boundary as Boundary;
  if (
    typeof boundary !== "object" ||
    boundary.v !== 1 ||
    boundary.kind !== "polygon" ||
    boundary.geometry?.type !== "Polygon" ||
    !Array.isArray(boundary.geometry.coordinates) ||
    boundary.geometry.coordinates.length !== 1
  ) {
    return { matched: false, distanceM }; // fail closed on malformed stored geometry
  }

  return { matched: boundaryContains(boundary, lat, lon), distanceM };
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
