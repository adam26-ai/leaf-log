/**
 * Custom polygon boundary validation and normalization for SPRINT-006. Pure
 * — no DB/Next imports — shaped like lib/sites/name.ts: validate → normalize
 * → return a canonical value or a typed error, so the server action, the
 * operator script, and the client-side live preview all share one
 * authority. See docs/sprints/SPRINT-006.md for the full design.
 */
import {
  ringAreaM2,
  ringSelfIntersects,
  boundaryContains,
  boundaryBoundingBox,
  type Boundary,
  type Ring,
} from "./geo";

export const MIN_BOUNDARY_VERTICES = 3;
export const MAX_BOUNDARY_VERTICES = 200;
export const MIN_BOUNDARY_AREA_M2 = 100; // a 10 m x 10 m box
export const MAX_SITE_BOUNDARY_AREA_M2 = 50_000_000; // 50 km^2 (~44x the 600m circle)
// Deliberately generous, not tied to the old 300-400m zone circle scale —
// SPRINT-006 planning interview explicitly chose "allow large zone
// boundaries, accept the risk" over a tight cap. Kept smaller than the site
// cap only to preserve some asymmetry, not to bound scale.
export const MAX_ZONE_BOUNDARY_AREA_M2 = 20_000_000; // 20 km^2

const COORD_DECIMALS = 6; // ~11cm precision

export type BoundaryError =
  | "malformed"
  | "unsupported_version"
  | "too_few_vertices"
  | "too_many_vertices"
  | "coordinate_out_of_range"
  | "crosses_antimeridian"
  | "self_intersecting"
  | "degenerate"
  | "too_large"
  | "excludes_anchor";

export type BoundaryValidationResult =
  | { ok: true; boundary: Boundary }
  | { ok: false; error: BoundaryError };

export type BoundaryLevel = "site" | "zone";

function maxAreaForLevel(level: BoundaryLevel): number {
  return level === "site" ? MAX_SITE_BOUNDARY_AREA_M2 : MAX_ZONE_BOUNDARY_AREA_M2;
}

const COORD_ROUND_FACTOR = 10 ** COORD_DECIMALS;

function round6(n: number): number {
  return Math.round(n * COORD_ROUND_FACTOR) / COORD_ROUND_FACTOR;
}

/** Extract the raw ring's coordinate array from either a full envelope
 *  ({v, kind, geometry}) or a bare GeoJSON-shaped geometry ({type, coordinates}).
 *  Both forms are accepted so a client can submit either shape; the server
 *  always re-derives v/kind itself rather than trusting what's sent. */
function extractRawRing(raw: unknown): unknown[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const geometry =
    typeof obj.geometry === "object" && obj.geometry !== null
      ? (obj.geometry as Record<string, unknown>)
      : obj.type === "Polygon"
        ? obj
        : null;
  if (!geometry || geometry.type !== "Polygon") return null;
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 1) return null;

  const ring = geometry.coordinates[0];
  return Array.isArray(ring) ? ring : null;
}

function toFiniteLonLat(pt: unknown): [number, number] | null {
  if (!Array.isArray(pt) || pt.length < 2) return null;
  const lon = Number(pt[0]);
  const lat = Number(pt[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lon, lat];
}

function samePoint(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Dedupe consecutive-identical points (the common double-tap case), then
 *  close the ring if the client omitted the repeated final vertex. */
function dedupeAndClose(points: [number, number][]): [number, number][] {
  const deduped: [number, number][] = [];
  for (const p of points) {
    if (deduped.length === 0 || !samePoint(deduped[deduped.length - 1], p)) deduped.push(p);
  }
  // Drop a trailing point that duplicates the first (client already closed it) —
  // it's re-appended below unconditionally so the result always has exactly
  // one closing repeat, never zero or two.
  if (deduped.length > 1 && samePoint(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop();
  }
  if (deduped.length > 0) deduped.push(deduped[0]);
  return deduped;
}

function lonSpanDegrees(points: [number, number][]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const [lon] of points) {
    if (lon < min) min = lon;
    if (lon > max) max = lon;
  }
  return max - min;
}

/** Signed area (shoelace, on raw lon/lat) — sign only, used to detect
 *  winding; the real area is computed in metres by ringAreaM2 elsewhere. */
function signedShoelace(points: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** RFC 7946 exterior rings wind counter-clockwise; a positive shoelace sum
 *  (in [lon, lat] order) is counter-clockwise. Ray-casting/point-in-polygon
 *  is winding-agnostic, so this is purely so stored data is portable GeoJSON. */
function orientCounterClockwise(points: [number, number][]): [number, number][] {
  return signedShoelace(points) < 0 ? [...points].reverse() : points;
}

/**
 * Validate and normalize an arbitrary, untrusted value into a canonical
 * Boundary — or a specific, named reason it can't be. `anchor` is the row's
 * own (site or zone) coordinate; the boundary must contain it, checked AFTER
 * normalization (rounding, closure) so the rule is against what's actually
 * stored, not whatever precision the client happened to submit.
 */
export function validateBoundary(
  raw: unknown,
  level: BoundaryLevel,
  anchor: { lat: number; lon: number },
): BoundaryValidationResult {
  const rawRing = extractRawRing(raw);
  if (!rawRing || rawRing.length < MIN_BOUNDARY_VERTICES) return { ok: false, error: "malformed" };

  if (typeof raw === "object" && raw !== null && "v" in raw) {
    const v = (raw as { v: unknown }).v;
    if (v !== 1 && v !== undefined) return { ok: false, error: "unsupported_version" };
  }

  const parsed: [number, number][] = [];
  for (const pt of rawRing) {
    const coord = toFiniteLonLat(pt);
    if (!coord) return { ok: false, error: "coordinate_out_of_range" };
    parsed.push(coord);
  }

  const closed = dedupeAndClose(parsed);
  const distinctCount = closed.length - 1;
  if (distinctCount < MIN_BOUNDARY_VERTICES) return { ok: false, error: "too_few_vertices" };
  if (distinctCount > MAX_BOUNDARY_VERTICES) return { ok: false, error: "too_many_vertices" };

  if (lonSpanDegrees(closed) >= 180) return { ok: false, error: "crosses_antimeridian" };

  const rounded = closed.map(([lon, lat]): [number, number] => [round6(lon), round6(lat)]);
  // Rounding to 6 decimals can (rarely) collapse two very-close-but-distinct
  // points onto the same value — re-run the same dedupe/count check against
  // the ROUNDED coordinates so a shape that only clears the cap before
  // rounding can't sneak through as fewer effective vertices than validated.
  const roundedClosed = dedupeAndClose(rounded);
  const roundedDistinctCount = roundedClosed.length - 1;
  if (roundedDistinctCount < MIN_BOUNDARY_VERTICES) return { ok: false, error: "too_few_vertices" };

  const oriented = orientCounterClockwise(roundedClosed);
  const ring: Ring = { coordinates: oriented };

  if (ringSelfIntersects(ring)) return { ok: false, error: "self_intersecting" };

  const areaM2 = ringAreaM2(ring);
  if (areaM2 < MIN_BOUNDARY_AREA_M2) return { ok: false, error: "degenerate" };
  if (areaM2 > maxAreaForLevel(level)) return { ok: false, error: "too_large" };

  const boundary: Boundary = { v: 1, kind: "polygon", geometry: { type: "Polygon", coordinates: [oriented] } };

  if (!boundaryContains(boundary, anchor.lat, anchor.lon)) return { ok: false, error: "excludes_anchor" };

  return { ok: true, boundary };
}

/** Re-normalize an already-valid Boundary (idempotent) — e.g. for display or
 *  re-derivation. Skips validation entirely; only use on a value that
 *  already passed validateBoundary (a DB row, typically). */
export function normalizeBoundary(boundary: Boundary): Boundary {
  const ring = boundary.geometry.coordinates[0];
  const rounded = ring.map(([lon, lat]): [number, number] => [round6(lon), round6(lat)]);
  const oriented = orientCounterClockwise(dedupeAndClose(rounded));
  return { v: 1, kind: "polygon", geometry: { type: "Polygon", coordinates: [oriented] } };
}

export interface BoundaryColumns {
  boundary: Boundary | null;
  boundaryMinLat: number | null;
  boundaryMaxLat: number | null;
  boundaryMinLon: number | null;
  boundaryMaxLon: number | null;
  boundaryUpdatedById: string | null;
}

/**
 * The single writer of the five mutable boundary columns per table — all
 * five move together (a `boundary` and its bbox, or all null), which is
 * what the DB's `num_nulls(...) IN (0,5)` CHECK enforces independently.
 * Pure: derives the bbox from an already-validated boundary.
 */
export function boundaryColumns(boundary: Boundary | null, updatedById: string): BoundaryColumns {
  if (boundary === null) {
    return {
      boundary: null,
      boundaryMinLat: null,
      boundaryMaxLat: null,
      boundaryMinLon: null,
      boundaryMaxLon: null,
      boundaryUpdatedById: updatedById,
    };
  }

  const box = boundaryBoundingBox(boundary);
  return {
    boundary,
    boundaryMinLat: box.minLat,
    boundaryMaxLat: box.maxLat,
    boundaryMinLon: box.minLon,
    boundaryMaxLon: box.maxLon,
    boundaryUpdatedById: updatedById,
  };
}
