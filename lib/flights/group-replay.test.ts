// @vitest-environment node
import { describe, expect, it } from "vitest";
import { groupReplayFixtures } from "@/test/igc/group-fixtures";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { buildReplayArtifact, readReplayArtifact } from "@/lib/igc/replay-artifact";
import { flightForPilot, groupTimeBounds, replayPositionAt, replayStateAt, splitReplaySamples } from "./group-replay";
import { routeProximityIndex } from "./route-proximity";

const artifacts = groupReplayFixtures().map((bytes) => {
  const parsed = parseIgc(bytes);
  return buildReplayArtifact(parsed, deriveMetrics(parsed)!, "test-hash", "2");
});

describe("group replay with the supplied flights", () => {
  it("aligns the dates while retaining distinct launch times and nearby routes", () => {
    const [a, b] = artifacts;
    expect(new Date(a.replay.takeoffMs).toISOString().slice(0, 10)).toBe("2026-06-11");
    expect(new Date(b.replay.takeoffMs).toISOString().slice(0, 10)).toBe("2026-06-11");
    expect(a.replay.takeoffMs).not.toBe(b.replay.takeoffMs);
    const distance = routeProximityIndex(a.matchingPaths)(b.matchingPaths);
    expect(distance).not.toBeNull();
    expect(distance!).toBeLessThan(5000);
    const common = Math.max(a.replay.takeoffMs, b.replay.takeoffMs) + 60_000;
    for (const { replay } of artifacts) expect(replayStateAt(replay, (common - replay.takeoffMs) / 1000)).toBe("Flying");
  });
  it("uses the group interval and reports inactive flights without extrapolation", () => {
    const flights = artifacts.map(({ replay }) => ({ takeoffMs: replay.takeoffMs, landingMs: replay.takeoffMs + replay.durationS * 1000 }));
    const bounds = groupTimeBounds(flights);
    expect(bounds.startMs).toBe(Math.min(...flights.map((f) => f.takeoffMs)));
    expect(bounds.endMs).toBe(Math.max(...flights.map((f) => f.landingMs)));
    const r = artifacts[0].replay;
    expect(replayStateAt(r, -1)).toBe("On Launch");
    expect(replayStateAt(r, r.durationS)).toBe("Landed");
    expect(replayPositionAt(r, -100)).toEqual(r.samples[0].slice(0, 3));
  });
  it("splits recording gaps and holds the previous fix inside them", () => {
    const r = { ...artifacts[0].replay, gapThresholdS: 30, durationS: 100, samples: [[0, 0, 100, 0], [1, 1, 200, 1], [2, 2, 300, 99], [3, 3, 400, 100]] as [number, number, number, number][] };
    expect(replayStateAt(r, 50)).toBe("Recording gap");
    expect(replayPositionAt(r, 50)).toEqual([1, 1, 200]);
    expect(splitReplaySamples(r).map((p) => p.length)).toEqual([2, 2]);
  });
  it("switches between a pilot's flights with an explicit overlap preference", () => {
    const owner = { id: "p", displayName: "Pilot", handle: "pilot", avatarUpdatedAt: null };
    const flights = [{ id: "a", takeoffMs: 0, landingMs: 100, owner, xcScore: null }, { id: "b", takeoffMs: 90, landingMs: 200, owner, xcScore: null }];
    expect(flightForPilot(flights, 95, "b").id).toBe("b");
    expect(flightForPilot(flights, 150, "a").id).toBe("b");
  });
  it("rejects stale artifacts after source or derivation changes", () => {
    expect(readReplayArtifact(artifacts[0], "test-hash", "2")).toBe(artifacts[0]);
    expect(readReplayArtifact(artifacts[0], "changed", "2")).toBeNull();
    expect(readReplayArtifact({ ...artifacts[0], version: -1 }, "test-hash", "2")).toBeNull();
  });
});

describe("route proximity", () => {
  it("detects crossing routes far from their endpoints", () => {
    expect(routeProximityIndex([[[-0.2, 0], [0.2, 0]]])([[[0, -0.2], [0, 0.2]]])).toBeCloseTo(0);
    expect(routeProximityIndex([[[0, 0], [0.01, 0]]])([[[1, 1], [1.01, 1]]])).toBeNull();
  });
  it("handles the antimeridian and the inclusive distance boundary", () => {
    expect(routeProximityIndex([[[179.999, 0]]])([[[-179.999, 0]]])).toBeLessThan(300);
    const lat = 5000 / 6_371_000 * 180 / Math.PI;
    expect(routeProximityIndex([[[0, 0]]])([[[0, lat]]])).toBeCloseTo(5000, 3);
    expect(routeProximityIndex([[[0, 0]]])([[[0, lat + 0.00001]]])).toBeNull();
  });
});
