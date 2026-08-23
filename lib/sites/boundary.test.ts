import { describe, it, expect } from "vitest";
import {
  validateBoundary,
  normalizeBoundary,
  boundaryColumns,
  MIN_BOUNDARY_VERTICES,
  MAX_BOUNDARY_VERTICES,
  MAX_SITE_BOUNDARY_AREA_M2,
  MAX_ZONE_BOUNDARY_AREA_M2,
  type BoundaryError,
} from "./boundary";
import type { Boundary } from "./geo";

const BASE_LAT = 10;
const BASE_LON = 20;
const M_PER_DEG_LAT = 111_320;

function metersToDegLat(m: number): number {
  return m / M_PER_DEG_LAT;
}
function metersToDegLon(m: number, atLat: number): number {
  return m / (M_PER_DEG_LAT * Math.cos((atLat * Math.PI) / 180));
}

function squareCoords(
  centerLat: number,
  centerLon: number,
  halfSizeM: number,
  opts: { closed?: boolean; clockwise?: boolean } = {},
): [number, number][] {
  const dLat = metersToDegLat(halfSizeM);
  const dLon = metersToDegLon(halfSizeM, centerLat);
  let corners: [number, number][] = [
    [centerLon - dLon, centerLat - dLat],
    [centerLon + dLon, centerLat - dLat],
    [centerLon + dLon, centerLat + dLat],
    [centerLon - dLon, centerLat + dLat],
  ];
  if (opts.clockwise) corners = [...corners].reverse();
  return opts.closed === false ? corners : [...corners, corners[0]];
}

function polygonRaw(coords: [number, number][]): unknown {
  return { type: "Polygon", coordinates: [coords] };
}

const ANCHOR = { lat: BASE_LAT, lon: BASE_LON };

function signedShoelace(coords: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

describe("validateBoundary — happy paths", () => {
  it("accepts a well-formed square containing its anchor", () => {
    const result = validateBoundary(polygonRaw(squareCoords(BASE_LAT, BASE_LON, 100)), "site", ANCHOR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.boundary.v).toBe(1);
      expect(result.boundary.kind).toBe("polygon");
      expect(result.boundary.geometry.type).toBe("Polygon");
    }
  });

  it("closes an unclosed ring the client omitted the final repeated vertex on", () => {
    const open = squareCoords(BASE_LAT, BASE_LON, 100, { closed: false });
    const result = validateBoundary(polygonRaw(open), "site", ANCHOR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ring = result.boundary.geometry.coordinates[0];
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  it("dedupes a double-tapped (consecutive-identical) vertex before counting", () => {
    const coords = squareCoords(BASE_LAT, BASE_LON, 100, { closed: false });
    const withDupeTap = [coords[0], coords[0], coords[1], coords[2], coords[3]];
    const result = validateBoundary(polygonRaw(withDupeTap), "site", ANCHOR);
    expect(result.ok).toBe(true);
  });

  it("normalizes a clockwise input ring to counter-clockwise", () => {
    const cw = squareCoords(BASE_LAT, BASE_LON, 100, { clockwise: true });
    expect(signedShoelace(cw)).toBeLessThan(0); // sanity: input really is CW
    const result = validateBoundary(polygonRaw(cw), "site", ANCHOR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(signedShoelace(result.boundary.geometry.coordinates[0])).toBeGreaterThan(0);
    }
  });

  it("rounds coordinates to 6 decimals", () => {
    const overPrecise: [number, number][] = squareCoords(BASE_LAT, BASE_LON, 100, { closed: false }).map(
      ([lon, lat]) => [lon + 0.0000001234, lat],
    );
    const result = validateBoundary(polygonRaw(overPrecise), "site", ANCHOR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const [lon] of result.boundary.geometry.coordinates[0]) {
        expect(Number(lon.toFixed(6))).toBe(lon);
      }
    }
  });

  it("accepts both a bare geometry and a full v1 envelope", () => {
    const coords = squareCoords(BASE_LAT, BASE_LON, 100);
    const bare = validateBoundary(polygonRaw(coords), "site", ANCHOR);
    const enveloped = validateBoundary(
      { v: 1, kind: "polygon", geometry: { type: "Polygon", coordinates: [coords] } },
      "site",
      ANCHOR,
    );
    expect(bare.ok).toBe(true);
    expect(enveloped.ok).toBe(true);
  });

  it("checks anchor containment AFTER normalization, not against raw client input", () => {
    // An anchor that sits just outside the raw (over-precise) input but
    // inside the rounded/normalized ring must still be accepted.
    const coords = squareCoords(BASE_LAT, BASE_LON, 100);
    const result = validateBoundary(polygonRaw(coords), "site", { lat: BASE_LAT, lon: BASE_LON });
    expect(result.ok).toBe(true);
  });
});

describe("validateBoundary — rejections, each with its own error code", () => {
  function expectError(raw: unknown, level: "site" | "zone", anchor: { lat: number; lon: number }, error: BoundaryError) {
    const result = validateBoundary(raw, level, anchor);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(error);
  }

  it("too_few_vertices — fewer than 3 distinct points", () => {
    expectError(polygonRaw([[0, 0], [1, 1], [0, 0]]), "site", { lat: 0, lon: 0 }, "too_few_vertices");
  });

  it("too_many_vertices — more than the 200-vertex cap", () => {
    const coords: [number, number][] = [];
    for (let i = 0; i < 205; i++) {
      const angle = (2 * Math.PI * i) / 205;
      coords.push([BASE_LON + Math.cos(angle) * 0.01, BASE_LAT + Math.sin(angle) * 0.01]);
    }
    coords.push(coords[0]);
    expectError(polygonRaw(coords), "site", ANCHOR, "too_many_vertices");
  });

  it("coordinate_out_of_range — a non-finite or out-of-range coordinate", () => {
    const coords = squareCoords(BASE_LAT, BASE_LON, 100, { closed: false });
    expectError(polygonRaw([...coords, [200, 0]]), "site", ANCHOR, "coordinate_out_of_range");
    expectError(polygonRaw([...coords, [NaN, 0]]), "site", ANCHOR, "coordinate_out_of_range");
  });

  it("crosses_antimeridian — a ring spanning >= 180 degrees of longitude", () => {
    const coords: [number, number][] = [
      [179, 0],
      [-179, 0],
      [-179, 1],
      [179, 1],
      [179, 0],
    ];
    expectError(polygonRaw(coords), "site", { lat: 0.5, lon: 179.5 }, "crosses_antimeridian");
  });

  it("self_intersecting — a bow-tie ring", () => {
    const dLat = metersToDegLat(100);
    const dLon = metersToDegLon(100, BASE_LAT);
    const bowtie: [number, number][] = [
      [BASE_LON - dLon, BASE_LAT - dLat],
      [BASE_LON + dLon, BASE_LAT + dLat],
      [BASE_LON + dLon, BASE_LAT - dLat],
      [BASE_LON - dLon, BASE_LAT + dLat],
      [BASE_LON - dLon, BASE_LAT - dLat],
    ];
    expectError(polygonRaw(bowtie), "site", ANCHOR, "self_intersecting");
  });

  it("degenerate — area below the 100 m^2 floor", () => {
    const coords = squareCoords(BASE_LAT, BASE_LON, 1); // 2m x 2m = 4 m^2
    expectError(polygonRaw(coords), "site", ANCHOR, "degenerate");
  });

  it("too_large — area above the level's cap", () => {
    // A square well past the site cap of 50 km^2 (half-size 100km -> 200km x 200km = 40,000 km^2).
    const coords = squareCoords(BASE_LAT, BASE_LON, 100_000);
    expectError(polygonRaw(coords), "site", ANCHOR, "too_large");
  });

  it("too_large uses the tighter zone cap for level: zone", () => {
    // Between the zone cap (20 km^2) and the site cap (50 km^2): half-size
    // ~2600m gives ~5200m x 5200m ~= 27 km^2 - over zone cap, under site cap.
    const coords = squareCoords(BASE_LAT, BASE_LON, 2600);
    const siteResult = validateBoundary(polygonRaw(coords), "site", ANCHOR);
    const zoneResult = validateBoundary(polygonRaw(coords), "zone", ANCHOR);
    expect(siteResult.ok).toBe(true);
    expect(zoneResult.ok).toBe(false);
    if (!zoneResult.ok) expect(zoneResult.error).toBe("too_large");
  });

  it("excludes_anchor — a boundary that doesn't contain the row's own anchor", () => {
    const coords = squareCoords(BASE_LAT, BASE_LON, 100);
    expectError(polygonRaw(coords), "site", { lat: BASE_LAT + 1, lon: BASE_LON + 1 }, "excludes_anchor");
  });

  it("malformed — not an object, or missing/invalid geometry", () => {
    expectError("not an object", "site", ANCHOR, "malformed");
    expectError({}, "site", ANCHOR, "malformed");
    expectError({ type: "Point", coordinates: [0, 0] }, "site", ANCHOR, "malformed");
    expectError({ type: "Polygon", coordinates: [] }, "site", ANCHOR, "malformed");
  });

  it("unsupported_version — a v other than 1", () => {
    const coords = squareCoords(BASE_LAT, BASE_LON, 100);
    expectError(
      { v: 2, kind: "polygon", geometry: { type: "Polygon", coordinates: [coords] } },
      "site",
      ANCHOR,
      "unsupported_version",
    );
  });
});

describe("normalizeBoundary", () => {
  it("is idempotent on an already-canonical boundary", () => {
    const result = validateBoundary(polygonRaw(squareCoords(BASE_LAT, BASE_LON, 100)), "site", ANCHOR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const renormalized = normalizeBoundary(result.boundary);
      expect(renormalized).toEqual(result.boundary);
    }
  });
});

describe("boundaryColumns — the single writer of the five mutable columns", () => {
  it("derives all four bbox columns together from a boundary, plus attribution", () => {
    const result = validateBoundary(polygonRaw(squareCoords(BASE_LAT, BASE_LON, 100)), "site", ANCHOR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cols = boundaryColumns(result.boundary, "profile-123");
      expect(cols.boundary).toEqual(result.boundary);
      expect(cols.boundaryMinLat).not.toBeNull();
      expect(cols.boundaryMaxLat).not.toBeNull();
      expect(cols.boundaryMinLon).not.toBeNull();
      expect(cols.boundaryMaxLon).not.toBeNull();
      expect(cols.boundaryUpdatedById).toBe("profile-123");
    }
  });

  it("returns all five as null when clearing (boundary = null), still attributing the clear", () => {
    const cols = boundaryColumns(null, "profile-456");
    expect(cols.boundary).toBeNull();
    expect(cols.boundaryMinLat).toBeNull();
    expect(cols.boundaryMaxLat).toBeNull();
    expect(cols.boundaryMinLon).toBeNull();
    expect(cols.boundaryMaxLon).toBeNull();
    expect(cols.boundaryUpdatedById).toBe("profile-456");
  });
});

describe("caps are sane relative to the existing circle defaults", () => {
  it("vertex bounds", () => {
    expect(MIN_BOUNDARY_VERTICES).toBe(3);
    expect(MAX_BOUNDARY_VERTICES).toBe(200);
  });

  it("zone area cap is smaller than the site area cap, but both are generous", () => {
    expect(MAX_ZONE_BOUNDARY_AREA_M2).toBeLessThan(MAX_SITE_BOUNDARY_AREA_M2);
  });
});

// A type-level sanity check that Boundary round-trips through JSON the way
// a jsonb column would — no class instances, no undefined, no NaN.
describe("Boundary is JSON-safe", () => {
  it("round-trips through JSON.stringify/parse unchanged", () => {
    const result = validateBoundary(polygonRaw(squareCoords(BASE_LAT, BASE_LON, 100)), "site", ANCHOR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const roundTripped = JSON.parse(JSON.stringify(result.boundary)) as Boundary;
      expect(roundTripped).toEqual(result.boundary);
    }
  });
});
