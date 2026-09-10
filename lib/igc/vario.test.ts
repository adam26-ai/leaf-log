import { expect, it } from "vitest";
import { calculatedVario } from "./vario";
import { parseIgc } from "./parse";
import { deriveMetrics } from "./derive";
import { buildReplayPath } from "./replay";
import { makeIgc } from "@/test/igc/make-igc";

function pulseFlight() {
  return parseIgc(makeIgc({ fixes: Array.from({ length: 65 }, (_, i) => ({
    tSec: 36000 + i, lat: 37.8 + i * 0.0002, lon: -122.5,
    baro: 500 + Math.max(0, Math.min(4, i - 20)) * 6 - Math.max(0, Math.min(4, i - 40)) * 5,
  })) }));
}

it("preserves four-second climb and sink peaks in both statistics and replay", () => {
  const parsed = pulseFlight();
  const metrics = deriveMetrics(parsed)!;
  const replay = buildReplayPath(parsed, metrics);
  expect(metrics.maxClimbMs).toBe(6);
  expect(metrics.maxSinkMs).toBe(-5);
  expect(Math.max(...replay.vario)).toBe(6);
  expect(Math.min(...replay.vario)).toBe(-5);
  expect(replay.vario[22]).toBe(6);
  expect(replay.vario[42]).toBe(-5);
});

it("calculates before downsampling so a lower replay point cap cannot broaden averaging", () => {
  const parsed = pulseFlight();
  const metrics = deriveMetrics(parsed)!;
  const full = buildReplayPath(parsed, metrics);
  const reduced = buildReplayPath(parsed, metrics, 9);
  reduced.samples.forEach((point, index) => {
    const originalIndex = full.samples.findIndex(original => original[3] === point[3]);
    expect(reduced.vario[index]).toBe(full.vario[originalIndex]);
  });
});

it("uses elapsed seconds with irregular and subsecond fixes", () => {
  const fixes = pulseFlight().fixes.slice(0, 6);
  [0, 0.5, 1.7, 3.1, 4.8, 6].forEach((t, index) => {
    Object.assign(fixes[index], { t, baroAlt: 100 + t * 3, gpsAlt: null });
  });
  calculatedVario(fixes, "baro", 50).forEach(rate => expect(rate).toBeCloseTo(3));
});

it("does not bridge recording gaps or missing altitude readings", () => {
  const fixes = pulseFlight().fixes.slice(0, 6);
  [0, 1, 2, 20, 21, 22].forEach((t, index) => {
    Object.assign(fixes[index], { t, baroAlt: index < 3 ? 100 : 1000, gpsAlt: null });
  });
  expect(calculatedVario(fixes, "baro", 0)).toEqual([0, 0, 0, 0, 0, 0]);
  fixes.forEach((fix, index) => { fix.t = index; });
  fixes[2].baroAlt = null;
  expect(calculatedVario(fixes, "baro", 0)).toEqual([0, 0, 0, 0, 0, 0]);
});

it("retains usable climb rates for files recorded less often than every four seconds", () => {
  const fixes = pulseFlight().fixes.slice(0, 6);
  fixes.forEach((fix, index) => { Object.assign(fix, { t: index * 5, baroAlt: 100 + index * 15 }); });
  calculatedVario(fixes, "baro", 0).forEach(rate => expect(rate).toBeCloseTo(3));
});

it("preserves recorded VAR including zero, with fallback only where VAR is missing", () => {
  const parsed = pulseFlight();
  parsed.fixes[22].varioMs = 0;
  parsed.fixes[42].varioMs = -7.3;
  const metrics = deriveMetrics(parsed)!;
  const replay = buildReplayPath(parsed, metrics);
  expect(replay.vario[22]).toBe(0);
  expect(replay.vario[42]).toBe(-7.3);
  expect(replay.vario[21]).toBe(4.5);
  expect(metrics.maxClimbMs).toBe(0);
  expect(metrics.maxSinkMs).toBe(-7.3);
});
