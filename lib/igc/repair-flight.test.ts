import { expect, it } from "vitest";
import { altitudeMeasurements } from "./repair-flight";
import { parseIgc } from "./parse";
import { deriveMetrics } from "./derive";
import { makeRealisticFlight } from "@/test/igc/make-igc";
import { METRICS_VERSION } from "../flights/analysis-state";

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
