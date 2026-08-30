import { describe, expect, it } from "vitest";
import { RATING_CRITERIA, criteriaForLevel } from "./criteria";
import type { RatingStats } from "./stats";

const stats: RatingStats = {
  flightCount: 137,
  flyingDayCount: 42,
  totalAirtimeSeconds: 61 * 3600, // 61h
  soloAirtimeSeconds: 55 * 3600, // 55h
  soloAirtimeIsExact: true,
  siteCount: 7,
  gliderCount: 3,
};

describe("RATING_CRITERIA auto getValue", () => {
  it("p2_flight_count reads flightCount", () => {
    const c = RATING_CRITERIA.find((c) => c.id === "p2_flight_count")!;
    expect(c.getValue!(stats)).toBe(137);
  });

  it("p3_flying_days_count reads flyingDayCount", () => {
    const c = RATING_CRITERIA.find((c) => c.id === "p3_flying_days_count")!;
    expect(c.getValue!(stats)).toBe(42);
  });

  it("p3_flight_count reads flightCount", () => {
    const c = RATING_CRITERIA.find((c) => c.id === "p3_flight_count")!;
    expect(c.getValue!(stats)).toBe(137);
  });

  it("p3_solo_airtime_hours reads soloAirtimeSeconds converted to hours", () => {
    const c = RATING_CRITERIA.find((c) => c.id === "p3_solo_airtime_hours")!;
    expect(c.getValue!(stats)).toBe(55);
  });

  it("p4_flight_count reads flightCount", () => {
    const c = RATING_CRITERIA.find((c) => c.id === "p4_flight_count")!;
    expect(c.getValue!(stats)).toBe(137);
  });

  it("p4_flying_days_count reads flyingDayCount", () => {
    const c = RATING_CRITERIA.find((c) => c.id === "p4_flying_days_count")!;
    expect(c.getValue!(stats)).toBe(42);
  });

  it("p4_total_airtime_hours reads totalAirtimeSeconds converted to hours", () => {
    const c = RATING_CRITERIA.find((c) => c.id === "p4_total_airtime_hours")!;
    expect(c.getValue!(stats)).toBe(61);
  });

  it("p4_site_count reads siteCount", () => {
    const c = RATING_CRITERIA.find((c) => c.id === "p4_site_count")!;
    expect(c.getValue!(stats)).toBe(7);
  });

  it("p4_glider_count reads gliderCount", () => {
    const c = RATING_CRITERIA.find((c) => c.id === "p4_glider_count")!;
    expect(c.getValue!(stats)).toBe(3);
  });
});

describe("RATING_CRITERIA catalog shape", () => {
  it("gives every entry a stable, non-empty id", () => {
    const seen = new Set<string>();
    for (const c of RATING_CRITERIA) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(seen.has(c.id)).toBe(false);
      seen.add(c.id);
    }
  });

  it("omits getValue for every non-auto entry", () => {
    for (const c of RATING_CRITERIA) {
      if (c.kind !== "auto") {
        expect(c.getValue).toBeUndefined();
      }
    }
  });
});

describe("criteriaForLevel", () => {
  it("returns only that level's rows", () => {
    for (const level of ["P2", "P3", "P4"] as const) {
      const rows = criteriaForLevel(level);
      expect(rows.length).toBeGreaterThan(0);
      for (const c of rows) {
        expect(c.level).toBe(level);
      }
    }

    const total = criteriaForLevel("P2").length +
      criteriaForLevel("P3").length +
      criteriaForLevel("P4").length;
    expect(total).toBe(RATING_CRITERIA.length);
  });
});
