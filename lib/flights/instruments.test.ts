import { describe, it, expect } from "vitest";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { buildReplayPath } from "@/lib/igc/replay";
import { instrumentAt } from "./instruments";
import { makeRealisticFlight } from "@/test/igc/make-igc";

function replayFromFixture() {
  const { igc } = makeRealisticFlight();
  const parsed = parseIgc(igc);
  const metrics = deriveMetrics(parsed)!;
  const path = buildReplayPath(parsed, metrics);
  return { ...path, takeoffMs: metrics.takeoffAtMs, offsetMin: metrics.localUtcOffsetMinutes ?? 0 };
}

describe("instrumentAt", () => {
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
