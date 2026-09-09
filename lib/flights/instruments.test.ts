import { describe, it, expect } from "vitest";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { buildReplayPath } from "@/lib/igc/replay";
import { instrumentAt, smoothedSpeedKmh } from "./instruments";
import type { Sample } from "@/lib/igc/interpolate";
import { makeRealisticFlight } from "@/test/igc/make-igc";

function replayFromFixture() {
  const { igc } = makeRealisticFlight();
  const parsed = parseIgc(igc);
  const metrics = deriveMetrics(parsed)!;
  const path = buildReplayPath(parsed, metrics);
  return { ...path, takeoffMs: metrics.takeoffAtMs, offsetMin: metrics.localUtcOffsetMinutes ?? 0 };
}

describe("instrumentAt", () => {
  it("smooths alternating GPS segment speeds without shortcutting curved distance or gaps", () => {
    const replay = replayFromFixture();
    const samples: Sample[] = Array.from({ length: 21 }, (_, i) => [(i + (i % 2 ? 0.4 : 0)) * 0.0001, 0, 1000, i]);
    const smoothed = { ...replay, samples, durationS: 20 };
    expect(Math.abs(smoothedSpeedKmh(smoothed, 8) - smoothedSpeedKmh(smoothed, 9))).toBeLessThan(1);
    expect(smoothedSpeedKmh(smoothed, 10)).toBeCloseTo(40.03, 0);
    expect(smoothedSpeedKmh({ ...smoothed, samples: [[0, 0, 0, 0], [1, 0, 0, 100]], gapThresholdS: 30 }, 50)).toBe(0);
  });
  it("reads climbing values early and gliding values late", () => {
    const replay = replayFromFixture();
    const dur = replay.durationS;

    const early = instrumentAt(replay, dur * 0.25)!; // mid-climb
    const late = instrumentAt(replay, dur * 0.85)!; // mid-glide

    expect(early.varioMs).toBeGreaterThan(1); // climbing
    expect(late.varioMs).toBeLessThan(0); // sinking
    expect(late.altM).toBeLessThan(early.altM + 400); // glide lower than peak-ish
    expect(early.speedKmh).toBeGreaterThan(0);
    expect(early.timeMs).toBeGreaterThan(0);
  });

  it("clamps out-of-range times and returns null for empty", () => {
    const replay = replayFromFixture();
    const start = instrumentAt(replay, -100)!;
    const end = instrumentAt(replay, 1e9)!;
    expect(start.t).toBe(replay.samples[0][3]);
    expect(end.t).toBe(replay.samples[replay.samples.length - 1][3]);
    expect(
      instrumentAt({ ...replay, samples: [], vario: [] }, 0),
    ).toBeNull();
  });
});
