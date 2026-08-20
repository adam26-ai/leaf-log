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
} from "./geo";

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
