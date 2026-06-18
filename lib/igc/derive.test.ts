import { describe, it, expect } from "vitest";
import { parseIgc } from "./parse";
import { deriveMetrics } from "./derive";
import { makeIgc, makeRealisticFlight } from "@/test/igc/make-igc";

describe("deriveMetrics", () => {
  it("derives sensible metrics from a realistic flight", () => {
    const { igc, truth } = makeRealisticFlight();
    const parsed = parseIgc(igc);
    const m = deriveMetrics(parsed)!;
    expect(m).not.toBeNull();

    // Pre-launch + post-landing idle excluded → ~240s of flight (±15s).
    expect(m.durationS).toBeGreaterThan(225);
    expect(m.durationS).toBeLessThan(255);

    // Peak altitude near the top of the thermal.
    expect(m.maxAltM).toBeGreaterThanOrEqual(truth.peakAlt - 5);
    expect(m.maxAltM).toBeLessThanOrEqual(truth.peakAlt + 5);

    // Climb +3 m/s, sink -2 m/s (smoothed → within tolerance).
    expect(m.maxClimbMs).toBeGreaterThan(2.5);
    expect(m.maxClimbMs).toBeLessThan(3.5);
    expect(m.maxSinkMs).toBeLessThan(-1.5);
    expect(m.maxSinkMs).toBeGreaterThan(-2.5);

    // Cumulative gain ≈ the 360 m climbed.
    expect(m.altGainM).toBeGreaterThan(330);
    expect(m.altGainM).toBeLessThan(390);

    // Prefers baro; track longer than straight line.
    expect(m.altSource).toBe("baro");
    expect(m.trackDistM).toBeGreaterThan(m.straightDistM);

    // Local timezone resolved from takeoff coords (California).
    expect(m.localTz).toBe("America/Los_Angeles");
    expect(m.localUtcOffsetMinutes).toBe(-420); // PDT in July
  });

  it("falls back to GPS altitude when baro is absent", () => {
    const fixes = Array.from({ length: 60 }, (_, i) => ({
      tSec: 36000 + i,
      lat: 37.8 + i * 0.0002,
      lon: -122.5 + i * 0.0002,
      baro: 0,
      gps: 500 + i,
    }));
    const m = deriveMetrics(parseIgc(makeIgc({ fixes })))!;
    expect(m.altSource).toBe("gps");
    expect(m.maxAltM).toBeGreaterThan(540);
  });

  it("returns null when there are too few fixes", () => {
    const m = deriveMetrics(parseIgc(makeIgc({ fixes: [] })));
    expect(m).toBeNull();
  });

  it("does not crash on a zero-movement recording", () => {
    const fixes = Array.from({ length: 60 }, (_, i) => ({
      tSec: 36000 + i,
      lat: 37.8,
      lon: -122.5,
      baro: 500,
    }));
    const m = deriveMetrics(parseIgc(makeIgc({ fixes })))!;
    expect(m).not.toBeNull();
    expect(m.trackDistM).toBeLessThan(5);
    expect(m.maxClimbMs).toBeCloseTo(0, 0);
  });
});
