import { describe, expect, it } from "vitest";
import { baroGpsOffset, playbackAltitude } from "./altitude";
import { parseIgc } from "./parse";
import { deriveMetrics } from "./derive";
import { buildReplayPath } from "./replay";
import { buildTrackArtifact } from "./track-artifact";
import { altitudeMeasurements } from "./repair-flight";
import { buildReplayArtifact, readReplayArtifact } from "./replay-artifact";
import { profileSamples } from "../flights/group-replay";
import { makeIgc } from "@/test/igc/make-igc";

function flight() {
  return parseIgc(makeIgc({ fixes: Array.from({ length: 60 }, (_, i) => ({
    tSec: 36000 + i, lat: 37.8 + i * 0.0002, lon: -122.5,
    baro: 100 + i, gps: 150 + i,
  })) }));
}

describe("GPS-aligned barometric altitude", () => {
  it("takes the median, ignoring missing and invalid pairs without mutating fixes", () => {
    const parsed = flight();
    parsed.fixes[0].gpsAlt = 9000;
    parsed.fixes[1].gpsAlt = null;
    parsed.fixes[2].baroAlt = null;
    parsed.fixes[3].valid = false;
    parsed.fixes[3].gpsAlt = -9000;
    const before = structuredClone(parsed.fixes);
    expect(baroGpsOffset(parsed.fixes)).toBe(50);
    expect(parsed.fixes).toEqual(before);
  });

  it("handles even sample counts, negative offsets, and absent pairs", () => {
    const fixes = flight().fixes.slice(0, 2);
    fixes[0].gpsAlt = fixes[0].baroAlt! - 20;
    fixes[1].gpsAlt = fixes[1].baroAlt! - 10;
    expect(baroGpsOffset(fixes)).toBe(-15);
    fixes.forEach(fix => { fix.gpsAlt = null; });
    expect(baroGpsOffset(fixes)).toBeNull();
    expect(playbackAltitude(fixes[0], "baro", null)).toBe(100);
  });

  it("shares calibrated heights across replay and profiles, including zero and GPS fallback", () => {
    const parsed = flight();
    parsed.fixes[20].baroAlt = 0;
    parsed.fixes[20].gpsAlt = 50;
    parsed.fixes[21].baroAlt = null;
    const metrics = deriveMetrics(parsed)!;
    const replay = buildReplayPath(parsed, metrics);
    const track = buildTrackArtifact(parsed.fixes, metrics);
    expect(replay.baroOffsetM).toBe(50);
    expect(replay.samples[20][2]).toBe(50);
    expect(replay.samples[21][2]).toBe(171);
    expect(track.baro).toEqual(replay.samples.map(p => [p[3], p[2]]));
    expect(profileSamples({ ...replay, takeoffMs: metrics.takeoffAtMs, offsetMin: 0 }, metrics.takeoffAtMs)).toEqual(track.baro);
    expect(playbackAltitude(parsed.fixes[22], "gps", 50)).toBe(172);
    parsed.fixes[22].gpsAlt = null;
    expect(playbackAltitude(parsed.fixes[22], "gps", 50)).toBe(172);
  });

  it("uses GPS only for altitude records, regardless of baro offset or invalid GPS fixes", () => {
    const parsed = flight();
    parsed.fixes[20].baroAlt = 8000;
    parsed.fixes[30].valid = false;
    parsed.fixes[30].gpsAlt = 9000;
    const metrics = deriveMetrics(parsed)!;
    expect(metrics.maxAltM).toBe(209);
    expect(altitudeMeasurements(parsed, metrics)).toMatchObject({ launchAltM: 150, maxAltM: 209 });
    parsed.fixes[0].gpsAlt = null;
    expect(altitudeMeasurements(parsed, deriveMetrics(parsed)).launchAltM).toBeNull();
    parsed.fixes.forEach(fix => { fix.gpsAlt = null; });
    expect(altitudeMeasurements(parsed, deriveMetrics(parsed))).toMatchObject({ launchAltM: null, maxAltM: null });
  });

  it("rejects replay caches made before shared altitude calibration", () => {
    const parsed = flight();
    const artifact = buildReplayArtifact(parsed, deriveMetrics(parsed)!, "hash", "4");
    expect(readReplayArtifact(artifact, "hash", "4")).toBe(artifact);
    expect(readReplayArtifact({ ...artifact, version: 2 }, "hash", "4")).toBeNull();
  });
});
