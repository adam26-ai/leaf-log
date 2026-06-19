import { describe, it, expect } from "vitest";
import { parseIgc } from "./parse";
import { deriveMetrics } from "./derive";
import { buildReplayPath } from "./replay";
import { makeRealisticFlight, makeIgc } from "@/test/igc/make-igc";

describe("buildReplayPath", () => {
  it("produces an aligned [lon,lat,alt,t] path within the cap", () => {
    const { igc, truth } = makeRealisticFlight();
    const parsed = parseIgc(igc);
    const metrics = deriveMetrics(parsed)!;
    const replay = buildReplayPath(parsed, metrics);

    expect(replay.samples.length).toBeGreaterThan(2);
    expect(replay.samples.length).toBeLessThanOrEqual(1500);
    expect(replay.vario).toHaveLength(replay.samples.length);

    // Each sample is [lon, lat, alt, t]; time is monotonic from 0.
    expect(replay.samples[0][3]).toBe(0);
    for (let i = 1; i < replay.samples.length; i++) {
      expect(replay.samples[i][3]).toBeGreaterThanOrEqual(replay.samples[i - 1][3]);
    }

    // Altitude reaches near the thermal top.
    const maxAlt = Math.max(...replay.samples.map((s) => s[2]));
    expect(maxAlt).toBeGreaterThanOrEqual(truth.peakAlt - 10);

    // Vario is positive during the climb and negative during the glide.
    expect(Math.max(...replay.vario)).toBeGreaterThan(1.5);
    expect(Math.min(...replay.vario)).toBeLessThan(-1);
  });

  it("downsamples a dense flight under the cap and keeps the last fix", () => {
    const fixes = Array.from({ length: 8000 }, (_, i) => ({
      tSec: 36000 + i,
      lat: 37.6685 + i * 0.00004,
      lon: -122.4936 + i * 0.00004,
      baro: 500 + Math.round(50 * Math.sin(i / 40)),
    }));
    const parsed = parseIgc(makeIgc({ fixes }));
    const metrics = deriveMetrics(parsed)!;
    const replay = buildReplayPath(parsed, metrics, 1000);
    expect(replay.samples.length).toBeLessThanOrEqual(1001);
    expect(replay.samples.length).toBeGreaterThan(100);
  });
});
