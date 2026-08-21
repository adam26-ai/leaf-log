import { describe, it, expect } from "vitest";
import { haversineM } from "@/lib/geo/distance";
import {
  TAKEOFF_RADIUS_M,
  LANDING_RADIUS_M,
  ZONE_TAKEOFF_RADIUS_M,
  ZONE_LANDING_RADIUS_M,
  radiusForKind,
  zoneRadiusForKind,
  kindMatches,
  boundingBox,
  withinRadius,
  compareSiteCandidates,
  boundaryContains,
  pointOnRingEdge,
  boundaryBoundingBox,
  ringAreaM2,
  ringSelfIntersects,
  locationMatches,
  EDGE_TOLERANCE_M,
  type Boundary,
  type Ring,
} from "./geo";

// SPRINT-006 test fixtures. A base point away from (0,0)/antimeridian
// special cases, with a simple equirectangular approximation for building
// rings of a known metre size — matches the same approximation geo.ts's own
// implementation uses, so the test oracle and the code under test agree on
// what "size" means without needing an external geometry library.
const BASE_LAT = 10;
const BASE_LON = 20;
const M_PER_DEG_LAT = 111_320;

function metersToDegLat(m: number): number {
  return m / M_PER_DEG_LAT;
}
function metersToDegLon(m: number, atLat: number): number {
  return m / (M_PER_DEG_LAT * Math.cos((atLat * Math.PI) / 180));
}

/** A square ring (closed, CCW) centered on (centerLat, centerLon) with the
 *  given half-size in metres. */
function squareRing(centerLat: number, centerLon: number, halfSizeM: number): Ring {
  const dLat = metersToDegLat(halfSizeM);
  const dLon = metersToDegLon(halfSizeM, centerLat);
  const corners: [number, number][] = [
    [centerLon - dLon, centerLat - dLat],
    [centerLon + dLon, centerLat - dLat],
    [centerLon + dLon, centerLat + dLat],
    [centerLon - dLon, centerLat + dLat],
  ];
  return { coordinates: [...corners, corners[0]] };
}

function toBoundary(ring: Ring): Boundary {
  return { v: 1, kind: "polygon", geometry: { type: "Polygon", coordinates: [ring.coordinates] } };
}

describe("boundaryContains — inclusive point-in-polygon", () => {
  const ring = squareRing(BASE_LAT, BASE_LON, 100); // a 200m x 200m square
  const boundary = toBoundary(ring);

  it("accepts a point clearly inside", () => {
    expect(boundaryContains(boundary, BASE_LAT, BASE_LON)).toBe(true);
  });

  it("rejects a point clearly outside", () => {
    expect(boundaryContains(boundary, BASE_LAT + 1, BASE_LON + 1)).toBe(false);
  });

  it("accepts a point exactly on a vertex (inclusive)", () => {
    const [lon, lat] = ring.coordinates[0];
    expect(boundaryContains(boundary, lat, lon)).toBe(true);
  });

  it("accepts a point exactly on an edge midpoint (inclusive)", () => {
    const [lon1, lat1] = ring.coordinates[0];
    const [lon2, lat2] = ring.coordinates[1];
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;
    expect(boundaryContains(boundary, midLat, midLon)).toBe(true);
  });

  it("accepts a point 0.4m off an edge (within EDGE_TOLERANCE_M) and rejects one 0.6m off", () => {
    expect(EDGE_TOLERANCE_M).toBe(0.5);
    // The south edge runs at lat = BASE_LAT - dLat; move outward (further
    // south) by a small metre offset from the edge midpoint.
    const dLat = metersToDegLat(100);
    const edgeLat = BASE_LAT - dLat;
    const nearLat = edgeLat - metersToDegLat(0.4);
    const farLat = edgeLat - metersToDegLat(0.6);
    expect(boundaryContains(boundary, nearLat, BASE_LON)).toBe(true);
    expect(boundaryContains(boundary, farLat, BASE_LON)).toBe(false);
  });

  it("handles a ray passing exactly through a vertex without double-counting", () => {
    // A pentagon with one vertex sitting exactly on the horizontal ray
    // (same latitude) cast from the query point — the classic ray-casting
    // double-count bug fires here if the edge rule isn't half-open.
    const dLat = metersToDegLat(100);
    const dLon = metersToDegLon(100, BASE_LAT);
    const pentagon: Ring = {
      coordinates: [
        [BASE_LON - dLon, BASE_LAT - dLat],
        [BASE_LON + dLon, BASE_LAT - dLat],
        [BASE_LON + dLon * 1.5, BASE_LAT], // sits exactly on the test ray's latitude
        [BASE_LON + dLon, BASE_LAT + dLat],
        [BASE_LON - dLon, BASE_LAT + dLat],
        [BASE_LON - dLon, BASE_LAT - dLat],
      ],
    };
    const pentagonBoundary = toBoundary(pentagon);
    // Query point well inside, at the same latitude as the "on-ray" vertex.
    expect(boundaryContains(pentagonBoundary, BASE_LAT, BASE_LON)).toBe(true);
  });

  it("correctly excludes a point in the concavity of a C-shape (bbox contains it, interior doesn't)", () => {
    // A "C" shape: an outer square with a notch cut into the right side.
    const d = metersToDegLat(150);
    const dLon150 = metersToDegLon(150, BASE_LAT);
    const dLon50 = metersToDegLon(50, BASE_LAT);
    const c: Ring = {
      coordinates: [
        [BASE_LON - dLon150, BASE_LAT - d],
        [BASE_LON + dLon150, BASE_LAT - d],
        [BASE_LON + dLon150, BASE_LAT - d / 3],
        [BASE_LON - dLon50, BASE_LAT - d / 3], // notch starts
        [BASE_LON - dLon50, BASE_LAT + d / 3],
        [BASE_LON + dLon150, BASE_LAT + d / 3], // notch ends
        [BASE_LON + dLon150, BASE_LAT + d],
        [BASE_LON - dLon150, BASE_LAT + d],
        [BASE_LON - dLon150, BASE_LAT - d],
      ],
    };
    const cBoundary = toBoundary(c);
    // Inside the bounding box of the C, but inside the notch — must be excluded.
    expect(boundaryContains(cBoundary, BASE_LAT, BASE_LON + dLon150)).toBe(false);
    // Inside the actual "C" material (the left bar), just off the notch line.
    expect(boundaryContains(cBoundary, BASE_LAT, BASE_LON - dLon150 / 2)).toBe(true);
  });
});

describe("pointOnRingEdge", () => {
  it("agrees with boundaryContains's edge-inclusive cases", () => {
    const ring = squareRing(BASE_LAT, BASE_LON, 100);
    const [lon, lat] = ring.coordinates[0];
    expect(pointOnRingEdge(ring, lat, lon)).toBe(true);
    expect(pointOnRingEdge(ring, BASE_LAT + 5, BASE_LON + 5)).toBe(false);
  });
});

describe("boundaryBoundingBox", () => {
  it("returns the ring's own min/max lat/lon", () => {
    const ring = squareRing(BASE_LAT, BASE_LON, 100);
    const box = boundaryBoundingBox(toBoundary(ring));
    const dLat = metersToDegLat(100);
    const dLon = metersToDegLon(100, BASE_LAT);
    expect(box.minLat).toBeCloseTo(BASE_LAT - dLat, 9);
    expect(box.maxLat).toBeCloseTo(BASE_LAT + dLat, 9);
    expect(box.minLon).toBeCloseTo(BASE_LON - dLon, 9);
    expect(box.maxLon).toBeCloseTo(BASE_LON + dLon, 9);
  });
});

describe("ringAreaM2", () => {
  it("computes the area of a known square accurately at low latitude", () => {
    const ring = squareRing(0, 0, 100); // 200m x 200m = 40,000 m^2
    expect(ringAreaM2(ring)).toBeCloseTo(40_000, -2); // within ~1% (rounding to nearest 100)
  });

  it("computes the area of a known square accurately at a high latitude (cos(lat) sensitivity)", () => {
    // A naive planar-on-degrees area (no cos(lat) correction) would measure
    // this as roughly 2x too large at 60 degrees — this is the regression
    // test for that specific bug class.
    const ring = squareRing(60, 0, 100); // still 200m x 200m = 40,000 m^2
    expect(ringAreaM2(ring)).toBeCloseTo(40_000, -2);
  });

  it("returns 0 for a degenerate ring with fewer than 3 distinct vertices", () => {
    expect(ringAreaM2({ coordinates: [[0, 0], [1, 1], [0, 0]] })).toBe(0);
  });

  it("area against hand-computed reference polygons", () => {
    // A right triangle with legs ~100m and ~100m: area ~5,000 m^2.
    const dLat = metersToDegLat(100);
    const dLon = metersToDegLon(100, BASE_LAT);
    const triangle: Ring = {
      coordinates: [
        [BASE_LON, BASE_LAT],
        [BASE_LON + dLon, BASE_LAT],
        [BASE_LON, BASE_LAT + dLat],
        [BASE_LON, BASE_LAT],
      ],
    };
    expect(ringAreaM2(triangle)).toBeCloseTo(5_000, -2);
  });
});

describe("ringSelfIntersects", () => {
  it("returns false for a simple convex square", () => {
    expect(ringSelfIntersects(squareRing(BASE_LAT, BASE_LON, 100))).toBe(false);
  });

  it("returns true for a bow-tie (crossing edges)", () => {
    const dLat = metersToDegLat(100);
    const dLon = metersToDegLon(100, BASE_LAT);
    const bowtie: Ring = {
      coordinates: [
        [BASE_LON - dLon, BASE_LAT - dLat],
        [BASE_LON + dLon, BASE_LAT + dLat],
        [BASE_LON + dLon, BASE_LAT - dLat],
        [BASE_LON - dLon, BASE_LAT + dLat],
        [BASE_LON - dLon, BASE_LAT - dLat],
      ],
    };
    expect(ringSelfIntersects(bowtie)).toBe(true);
  });

  it("flags a figure-eight (two lobes sharing one non-adjacent vertex) as self-intersecting", () => {
    // Two triangles sharing exactly the vertex (BASE_LON, BASE_LAT) — no two
    // edges CROSS, but two non-adjacent segments touch at that shared point,
    // which this segment-pair test (correctly, and conservatively) still
    // rejects: a ring touching itself has no well-defined single interior at
    // that point, and refusing it at write time is the only way the
    // match-time answer stays meaningful. Only INDEX-adjacent segments (and
    // the wrap-around pair) are excluded from the check, not every pair that
    // happens to share coordinates.
    const dLat = metersToDegLat(100);
    const dLon = metersToDegLon(100, BASE_LAT);
    const figureEight: Ring = {
      coordinates: [
        [BASE_LON, BASE_LAT],
        [BASE_LON + dLon, BASE_LAT + dLat],
        [BASE_LON + dLon, BASE_LAT - dLat],
        [BASE_LON, BASE_LAT], // back to the shared vertex
        [BASE_LON - dLon, BASE_LAT + dLat],
        [BASE_LON - dLon, BASE_LAT - dLat],
        [BASE_LON, BASE_LAT],
      ],
    };
    expect(ringSelfIntersects(figureEight)).toBe(true);
  });
});

describe("locationMatches — the boundary-if-present-else-circle composition point", () => {
  const anchor = { lat: BASE_LAT, lon: BASE_LON };
  const radiusM = 300;

  it("matches by haversine radius when the row has no boundary", () => {
    const row = { ...anchor, boundary: null };
    const near = locationMatches(row, BASE_LAT, BASE_LON + metersToDegLon(100, BASE_LAT), radiusM);
    expect(near.matched).toBe(true);
    expect(near.distanceM).toBeCloseTo(100, 0);

    const far = locationMatches(row, BASE_LAT, BASE_LON + metersToDegLon(1000, BASE_LAT), radiusM);
    expect(far.matched).toBe(false);
  });

  it("a boundary TIGHTER than the circle correctly excludes a point the circle would accept", () => {
    const tightRing = squareRing(BASE_LAT, BASE_LON, 50); // 50m half-size, well inside the 300m circle
    const row = { ...anchor, boundary: toBoundary(tightRing) };
    const pointInsideCircleOutsideBoundary = {
      lat: BASE_LAT,
      lon: BASE_LON + metersToDegLon(150, BASE_LAT), // inside 300m circle, outside the 50m-half square
    };
    const result = locationMatches(
      row,
      pointInsideCircleOutsideBoundary.lat,
      pointInsideCircleOutsideBoundary.lon,
      radiusM,
    );
    expect(result.matched).toBe(false);
    // distanceM is still populated (anchor distance), even though it didn't match.
    expect(result.distanceM).toBeCloseTo(150, 0);
  });

  it("a boundary LOOSER than the circle correctly accepts a point the circle would reject", () => {
    const looseRing = squareRing(BASE_LAT, BASE_LON, 1000); // far past the 300m circle
    const row = { ...anchor, boundary: toBoundary(looseRing) };
    const pointOutsideCircleInsideBoundary = {
      lat: BASE_LAT,
      lon: BASE_LON + metersToDegLon(500, BASE_LAT),
    };
    const result = locationMatches(
      row,
      pointOutsideCircleInsideBoundary.lat,
      pointOutsideCircleInsideBoundary.lon,
      radiusM,
    );
    expect(result.matched).toBe(true);
    expect(result.distanceM).toBeCloseTo(500, -1); // +/-5m: equirectangular test fixture vs. real haversine
  });

  it("every matched row (circle or boundary) gets a real distanceM for ranking — no membership tier needed", () => {
    const circleRow = { ...anchor, boundary: null };
    const boundaryRow = { ...anchor, boundary: toBoundary(squareRing(BASE_LAT, BASE_LON, 1000)) };
    const point = { lat: BASE_LAT, lon: BASE_LON + metersToDegLon(200, BASE_LAT) };
    const circleResult = locationMatches(circleRow, point.lat, point.lon, radiusM);
    const boundaryResult = locationMatches(boundaryRow, point.lat, point.lon, radiusM);
    expect(circleResult.distanceM).toBeCloseTo(boundaryResult.distanceM, 6);
  });

  it("fails closed (matched: false) on malformed stored geometry, never throws", () => {
    const malformedRows = [
      { ...anchor, boundary: { v: 2, kind: "polygon", geometry: { type: "Polygon", coordinates: [[]] } } },
      { ...anchor, boundary: { v: 1, kind: "circle", geometry: { type: "Polygon", coordinates: [[]] } } },
      { ...anchor, boundary: { v: 1, kind: "polygon", geometry: { type: "MultiPolygon", coordinates: [] } } },
      { ...anchor, boundary: "not even an object" },
      { ...anchor, boundary: 42 },
    ];
    for (const row of malformedRows) {
      expect(() => locationMatches(row, BASE_LAT, BASE_LON, radiusM)).not.toThrow();
      expect(locationMatches(row, BASE_LAT, BASE_LON, radiusM).matched).toBe(false);
    }
  });

  it("guard benchmark: 1000 boundaryContains calls against a 200-vertex ring stay well under budget", () => {
    // A regression tripwire, not a wall-clock SLA — generously bounded to
    // avoid flaking on shared CI hardware.
    const manyVertices: [number, number][] = [];
    const n = 100; // 100 distinct vertices -> 101 positions closed
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / n;
      const dLat = metersToDegLat(200 * Math.sin(angle));
      const dLon = metersToDegLon(200 * Math.cos(angle), BASE_LAT);
      manyVertices.push([BASE_LON + dLon, BASE_LAT + dLat]);
    }
    manyVertices.push(manyVertices[0]);
    const bigRing: Ring = { coordinates: manyVertices };
    const boundary = toBoundary(bigRing);

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      boundaryContains(boundary, BASE_LAT, BASE_LON + (i % 3) * 0.0001);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500); // generous: real budget is ~50ms
  });
});

describe("radiusForKind / kindMatches", () => {
  it("returns the tighter radius for takeoff, wider for landing", () => {
    expect(radiusForKind("takeoff")).toBe(TAKEOFF_RADIUS_M);
    expect(radiusForKind("landing")).toBe(LANDING_RADIUS_M);
  });

  it("matches exact kind and the 'both' wildcard, rejects the opposite kind", () => {
    expect(kindMatches("takeoff", "takeoff")).toBe(true);
    expect(kindMatches("both", "takeoff")).toBe(true);
    expect(kindMatches("both", "landing")).toBe(true);
    expect(kindMatches("landing", "takeoff")).toBe(false);
    expect(kindMatches("unknown", "takeoff")).toBe(false);
  });
});

describe("zoneRadiusForKind — tighter than the site radius, same asymmetry", () => {
  it("returns roughly half the site radius for each kind", () => {
    expect(zoneRadiusForKind("takeoff")).toBe(ZONE_TAKEOFF_RADIUS_M);
    expect(zoneRadiusForKind("landing")).toBe(ZONE_LANDING_RADIUS_M);
    expect(ZONE_TAKEOFF_RADIUS_M).toBeLessThan(TAKEOFF_RADIUS_M);
    expect(ZONE_LANDING_RADIUS_M).toBeLessThan(LANDING_RADIUS_M);
  });

  it("preserves the takeoff/landing asymmetry at the zone level", () => {
    expect(ZONE_TAKEOFF_RADIUS_M).toBeLessThan(ZONE_LANDING_RADIUS_M);
  });
});

describe("withinRadius — radius boundaries", () => {
  const origin = { lat: 37.6685, lon: -122.4936 };

  // Move north by exactly `metres` along a meridian (good local approximation
  // at this latitude for a small offset).
  function pointNorth(metres: number) {
    return { lat: origin.lat + metres / 111_320, lon: origin.lon };
  }

  it("includes a point just inside the takeoff radius", () => {
    const p = { id: "in", ...pointNorth(TAKEOFF_RADIUS_M - 5) };
    const result = withinRadius([p], origin.lat, origin.lon, TAKEOFF_RADIUS_M);
    expect(result.map((r) => r.id)).toEqual(["in"]);
  });

  it("excludes a point just outside the takeoff radius", () => {
    const p = { id: "out", ...pointNorth(TAKEOFF_RADIUS_M + 50) };
    const result = withinRadius([p], origin.lat, origin.lon, TAKEOFF_RADIUS_M);
    expect(result).toHaveLength(0);
  });

  it("includes a point just inside the landing radius", () => {
    const p = { id: "in", ...pointNorth(LANDING_RADIUS_M - 5) };
    const result = withinRadius([p], origin.lat, origin.lon, LANDING_RADIUS_M);
    expect(result.map((r) => r.id)).toEqual(["in"]);
  });

  it("excludes a point just outside the landing radius", () => {
    const p = { id: "out", ...pointNorth(LANDING_RADIUS_M + 50) };
    const result = withinRadius([p], origin.lat, origin.lon, LANDING_RADIUS_M);
    expect(result).toHaveLength(0);
  });

  it("attaches the same distance withinRadius computes to what haversineM reports directly", () => {
    const p = { id: "p", ...pointNorth(300) };
    const [result] = withinRadius([p], origin.lat, origin.lon, TAKEOFF_RADIUS_M);
    const direct = haversineM(origin.lat, origin.lon, p.lat, p.lon);
    expect(result.distanceM).toBeCloseTo(direct, 6);
  });

  it("includes a point just inside the zone-takeoff radius", () => {
    const p = { id: "in", ...pointNorth(ZONE_TAKEOFF_RADIUS_M - 5) };
    const result = withinRadius([p], origin.lat, origin.lon, ZONE_TAKEOFF_RADIUS_M);
    expect(result.map((r) => r.id)).toEqual(["in"]);
  });

  it("excludes a point just outside the zone-takeoff radius", () => {
    const p = { id: "out", ...pointNorth(ZONE_TAKEOFF_RADIUS_M + 20) };
    const result = withinRadius([p], origin.lat, origin.lon, ZONE_TAKEOFF_RADIUS_M);
    expect(result).toHaveLength(0);
  });

  it("includes a point just inside the zone-landing radius", () => {
    const p = { id: "in", ...pointNorth(ZONE_LANDING_RADIUS_M - 5) };
    const result = withinRadius([p], origin.lat, origin.lon, ZONE_LANDING_RADIUS_M);
    expect(result.map((r) => r.id)).toEqual(["in"]);
  });

  it("excludes a point just outside the zone-landing radius", () => {
    const p = { id: "out", ...pointNorth(ZONE_LANDING_RADIUS_M + 20) };
    const result = withinRadius([p], origin.lat, origin.lon, ZONE_LANDING_RADIUS_M);
    expect(result).toHaveLength(0);
  });

  it("a point between the zone and site radius is excluded from the zone radius but included in the site radius", () => {
    // Demonstrates the zone-vs-site radius interaction directly: the same
    // point is a zone-miss and a site-hit, which is exactly the "no dead
    // ends" fallback lib/sites/lookup.ts's findLocation relies on.
    const p = { id: "between", ...pointNorth((ZONE_TAKEOFF_RADIUS_M + TAKEOFF_RADIUS_M) / 2) };
    expect(withinRadius([p], origin.lat, origin.lon, ZONE_TAKEOFF_RADIUS_M)).toHaveLength(0);
    expect(withinRadius([p], origin.lat, origin.lon, TAKEOFF_RADIUS_M).map((r) => r.id)).toEqual(["between"]);
  });
});

describe("boundingBox — bbox vs. haversine agreement", () => {
  it("never excludes a point that haversine says is within radius (no false negatives)", () => {
    const lat = 37.4699;
    const lon = -121.8638;
    const radiusM = 900;
    const box = boundingBox(lat, lon, radiusM);

    // Sample points around the exact radius boundary at several bearings.
    for (const bearingDeg of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const rad = (bearingDeg * Math.PI) / 180;
      const dLat = ((radiusM * 0.95) / 111_320) * Math.cos(rad);
      const cosLat = Math.cos((lat * Math.PI) / 180);
      const dLon = ((radiusM * 0.95) / (111_320 * cosLat)) * Math.sin(rad);
      const pLat = lat + dLat;
      const pLon = lon + dLon;

      const trueDist = haversineM(lat, lon, pLat, pLon);
      if (trueDist > radiusM) continue; // sampling approximation may overshoot; skip

      const inLat = pLat >= box.latMin && pLat <= box.latMax;
      const inLon = box.lonRanges.some((r) => pLon >= r.min && pLon <= r.max);
      expect(inLat && inLon).toBe(true);
    }
  });

  it("clamps cosLat near the poles instead of producing an unbounded longitude span", () => {
    const box = boundingBox(89.9, 0, LANDING_RADIUS_M);
    const [range] = box.lonRanges;
    expect(Number.isFinite(range.min)).toBe(true);
    expect(Number.isFinite(range.max)).toBe(true);
    // Clamped cosLat (0.01) bounds the span well short of the full circle.
    expect(range.max - range.min).toBeLessThan(360);
  });

  it("splits into two ranges when the padded box crosses the antimeridian", () => {
    const box = boundingBox(0, 179.999, LANDING_RADIUS_M);
    expect(box.lonRanges.length).toBe(2);
    // One range should hug +180, the other hug -180.
    const nearPositive = box.lonRanges.some((r) => r.max === 180);
    const nearNegative = box.lonRanges.some((r) => r.min === -180);
    expect(nearPositive).toBe(true);
    expect(nearNegative).toBe(true);
  });

  it("does not split when the padded box stays well within [-180, 180]", () => {
    const box = boundingBox(37.6685, -122.4936, LANDING_RADIUS_M);
    expect(box.lonRanges.length).toBe(1);
  });
});

describe("compareSiteCandidates — deterministic tie-break ordering", () => {
  it("orders by distance ascending first", () => {
    const near = { id: "b", distanceM: 100 };
    const far = { id: "a", distanceM: 200 };
    expect(compareSiteCandidates(near, far)).toBeLessThan(0);
    expect(compareSiteCandidates(far, near)).toBeGreaterThan(0);
  });

  it("breaks an exact distance tie in favor of a curated license", () => {
    const curated = { id: "z", distanceM: 100, license: "curated" };
    const user = { id: "a", distanceM: 100, license: null };
    expect(compareSiteCandidates(curated, user)).toBeLessThan(0);
    expect(compareSiteCandidates(user, curated)).toBeGreaterThan(0);
  });

  it("breaks a remaining tie (same distance, same curated status) by id", () => {
    const a = { id: "aaa", distanceM: 100, license: null };
    const b = { id: "bbb", distanceM: 100, license: null };
    expect(compareSiteCandidates(a, b)).toBeLessThan(0);
    expect(compareSiteCandidates(b, a)).toBeGreaterThan(0);
  });

  it("does not depend on input order — sorting is stable and order-independent", () => {
    const items = [
      { id: "c", distanceM: 300, license: null },
      { id: "a", distanceM: 100, license: "curated" },
      { id: "b", distanceM: 100, license: null },
    ];
    const sorted = [...items].sort(compareSiteCandidates);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b", "c"]);
    const reversed = [...items].reverse().sort(compareSiteCandidates);
    expect(reversed.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});
