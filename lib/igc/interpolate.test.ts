import { describe, expect, it } from "vitest";
import { bearingDeg, headingAt, type Sample } from "./interpolate";

describe("bearingDeg", () => {
  it("returns an eastbound bearing near 90 degrees", () => {
    expect(bearingDeg(-122, 37, -121.99, 37)).toBeCloseTo(90, 0);
  });

  it("returns a northbound bearing near 0/360 degrees", () => {
    const bearing = bearingDeg(-122, 37, -122, 37.01);
    expect(Math.min(bearing, 360 - bearing)).toBeLessThan(1);
  });
});

describe("headingAt", () => {
  it("returns a damped eastbound track heading", () => {
    const samples: Sample[] = [
      [-122, 37, 100, 0],
      [-121.99, 37, 100, 10],
    ];

    expect(headingAt(samples, 5)).toBeCloseTo(90, 0);
  });

  it("returns a damped northbound track heading", () => {
    const samples: Sample[] = [
      [-122, 37, 100, 0],
      [-122, 37.01, 100, 10],
    ];

    const heading = headingAt(samples, 5);
    expect(heading).not.toBeNull();
    expect(Math.min(heading!, 360 - heading!)).toBeLessThan(1);
  });

  it("returns null for a tight circle with near-zero net displacement", () => {
    const samples: Sample[] = [
      [-122, 37, 100, 0],
      [-121.99999, 37, 100, 2],
      [-122, 37, 100, 4],
      [-122.00001, 37, 100, 6],
      [-122, 37, 100, 8],
    ];

    expect(headingAt(samples, 4, 8)).toBeNull();
  });
});
