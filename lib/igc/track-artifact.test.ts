import { describe, it, expect } from "vitest";
import { parseIgc } from "./parse";
import { deriveMetrics } from "./derive";
import { buildTrackArtifact, TRACK_ARTIFACT_VERSION } from "./track-artifact";
import { makeIgc, makeRealisticFlight } from "@/test/igc/make-igc";

describe("buildTrackArtifact", () => {
  it("produces a versioned, bounded, simplified artifact", () => {
    const { igc } = makeRealisticFlight();
    const parsed = parseIgc(igc);
    const metrics = deriveMetrics(parsed)!;
    const art = buildTrackArtifact(parsed.fixes, metrics);

    expect(art.v).toBe(TRACK_ARTIFACT_VERSION);
    expect(art.altSource).toBe("baro");
    expect(art.line.length).toBeGreaterThan(1);
    expect(art.baro.length).toBeGreaterThan(1);
    // Each line point is [lon, lat].
    expect(art.line[0]).toHaveLength(2);
    // Barograph starts at t-offset 0.
    expect(art.baro[0][0]).toBe(0);
    expect(art.bounds).toHaveLength(4);
  });

  it("caps very dense tracks under the point limit", () => {
    // 10k fixes moving steadily — must downsample well under 2000 line points.
    const fixes = Array.from({ length: 10000 }, (_, i) => ({
      tSec: 36000 + i,
      lat: 37.8 + i * 0.00005,
      lon: -122.5 + i * 0.00005,
      baro: 500 + Math.round(50 * Math.sin(i / 50)),
    }));
    const parsed = parseIgc(makeIgc({ fixes }));
    const metrics = deriveMetrics(parsed)!;
    const art = buildTrackArtifact(parsed.fixes, metrics);
    expect(art.line.length).toBeLessThanOrEqual(2000);
    expect(art.baro.length).toBeLessThanOrEqual(2000);
  });
});
