import { expect, it } from "vitest";
import { altitudeMeasurements } from "./repair-flight";
import { parseIgc } from "./parse";
import { deriveMetrics } from "./derive";
import { makeIgc, makeRealisticFlight } from "@/test/igc/make-igc";
import { METRICS_VERSION } from "../flights/analysis-state";
import { flightTrophies } from "../flights/trophies";

function startupRecording(accuracy = [800, 7, 7, 7, 7, 7]) {
  const base = makeIgc({ fixes: [0, 764, 752, 748, 744, 1074].map((gps, i) => ({
    tSec: 36000 + i, lat: 37.8 + i * 0.0001, lon: -122.5, baro: 655, gps,
  })) });
  let index = 0;
  return parseIgc("I013638FXA\n" + base.split("\n").map(line => line.startsWith("B")
    ? line + String(accuracy[index++]).padStart(3, "0") : line).join("\n"));
}

it("preserves a real zero altitude instead of treating sea level as missing", () => {
  const parsed = parseIgc(makeRealisticFlight().igc);
  const metrics = deriveMetrics(parsed)!;
  parsed.fixes[metrics.takeoffIndex] = { ...parsed.fixes[metrics.takeoffIndex], baroAlt: 0, gpsAlt: 0 };
  expect(altitudeMeasurements(parsed, metrics).launchAltM).toBe(0);
});
it("does not fabricate altitude trophies when the original file has no altitude", () => {
  const parsed = parseIgc(makeRealisticFlight().igc);
  parsed.fixes = parsed.fixes.map(fix => ({ ...fix, baroAlt: null, gpsAlt: null }));
  expect(altitudeMeasurements(parsed, deriveMetrics(parsed))).toEqual({ metricsVersion: METRICS_VERSION, launchAltM: null, maxAltM: null });
});
it("uses GPS at launch even when playback prefers baro", () => {
  const parsed = parseIgc(makeRealisticFlight().igc);
  const metrics = deriveMetrics(parsed)!;
  parsed.fixes[metrics.takeoffIndex] = { ...parsed.fixes[metrics.takeoffIndex], baroAlt: null, gpsAlt: 42 };
  expect(altitudeMeasurements(parsed, { ...metrics, altSource: "baro" }).launchAltM).toBe(42);
});

it("recovers the Naviter startup zero from the next usable GPS sample", () => {
  const parsed = startupRecording();
  const metrics = deriveMetrics(parsed)!;
  expect(metrics.takeoffIndex).toBe(0);
  const measurements = altitudeMeasurements(parsed, metrics);
  expect(measurements).toEqual({ metricsVersion: METRICS_VERSION, launchAltM: 764, maxAltM: 1074 });
  expect(flightTrophies([{ id: "startup", status: "ready", ...metrics, ...measurements, xcScore: null }])
    .startup.find(t => t.category === "launch-gain")?.value).toBe(310);
});

it("takes the next usable reading rather than a maximum that includes later climbs", () => {
  const parsed = startupRecording();
  parsed.fixes[1].gpsAlt = 725;
  parsed.fixes[2].gpsAlt = 730;
  expect(altitudeMeasurements(parsed, deriveMetrics(parsed)).launchAltM).toBe(725);
});

it.each([725, -2])("leaves a nonzero launch of %s m unchanged even with poor accuracy", altitude => {
  const parsed = startupRecording();
  parsed.fixes[0].gpsAlt = altitude;
  expect(altitudeMeasurements(parsed, deriveMetrics(parsed)).launchAltM).toBe(altitude);
});

it.each([null, 7, 100])("preserves zero at sea level when its accuracy is %s", accuracy => {
  const parsed = startupRecording();
  parsed.fixes[0].fixAccuracyM = accuracy;
  expect(altitudeMeasurements(parsed, deriveMetrics(parsed)).launchAltM).toBe(0);
});

it("skips poor or invalid replacements and accepts a reliable zero", () => {
  const parsed = startupRecording([800, 800, 7, 7, 7, 7]);
  parsed.fixes[2].valid = false;
  parsed.fixes[3].gpsAlt = 0;
  expect(altitudeMeasurements(parsed, deriveMetrics(parsed)).launchAltM).toBe(0);
});

it("can recover beyond the first five launch fixes", () => {
  const parsed = startupRecording([800, 800, 800, 800, 800, 7]);
  expect(altitudeMeasurements(parsed, deriveMetrics(parsed)).launchAltM).toBe(1074);
});

it("does not borrow an altitude more than fifteen seconds after launch", () => {
  const parsed = startupRecording();
  const metrics = deriveMetrics(parsed)!;
  parsed.fixes.slice(1).forEach(fix => { fix.t += 15; });
  expect(altitudeMeasurements(parsed, metrics).launchAltM).toBeNull();
});

it("includes a usable sample exactly fifteen seconds after launch", () => {
  const parsed = startupRecording([800, 800, 800, 800, 800, 7]);
  parsed.fixes.forEach((fix, index) => {
    fix.t += index * 2;
    fix.timeMs += index * 2000;
  });
  expect(altitudeMeasurements(parsed, deriveMetrics(parsed)).launchAltM).toBe(1074);
});

it("recovers from a long startup run without a sample-count limit", () => {
  const parsed = startupRecording();
  const metrics = deriveMetrics(parsed)!;
  const first = parsed.fixes[0];
  parsed.fixes = Array.from({ length: 61 }, (_, index) => ({
    ...first, t: first.t + index / 4, timeMs: first.timeMs + index * 250,
    gpsAlt: index === 60 ? 725 : 0, fixAccuracyM: index === 60 ? 7 : 800,
  }));
  expect(altitudeMeasurements(parsed, { ...metrics, landingIndex: 60 }).launchAltM).toBe(725);
});

it("uses the first acceptable sample from a sparse ten-second recording", () => {
  const parsed = startupRecording();
  const metrics = deriveMetrics(parsed)!;
  parsed.fixes.forEach((fix, index) => {
    fix.t += index * 9;
    fix.timeMs += index * 9000;
  });
  expect(altitudeMeasurements(parsed, metrics).launchAltM).toBe(764);
});

it("does not invent a launch altitude when the startup zero has no usable replacement", () => {
  const parsed = startupRecording([800, 800, 800, 800, 800, 800]);
  const metrics = deriveMetrics(parsed)!;
  const measurements = altitudeMeasurements(parsed, metrics);
  expect(measurements.launchAltM).toBeNull();
  expect(flightTrophies([{ id: "missing", status: "ready", ...metrics, ...measurements, xcScore: null }])
    .missing.some(t => t.category === "launch-gain")).toBe(false);
});

it("retains the existing missing-altitude behavior rather than replacing every bad start", () => {
  const parsed = startupRecording();
  parsed.fixes[0].gpsAlt = null;
  expect(altitudeMeasurements(parsed, deriveMetrics(parsed)).launchAltM).toBeNull();
});
