import { Prisma } from "@prisma/client";
import { METRICS_VERSION } from "../flights/analysis-state";
import type { DerivedMetrics, ParsedIgc } from "./types";

export function altitudeMeasurements(parsed: ParsedIgc, metrics: DerivedMetrics | null) {
  const fixes = metrics ? parsed.fixes.slice(metrics.takeoffIndex, metrics.landingIndex + 1) : [];
  const alt = (fix: typeof fixes[number]) => metrics?.altSource === "baro" ? fix.baroAlt ?? fix.gpsAlt : fix.gpsAlt ?? fix.baroAlt;
  const launch = fixes[0] ? alt(fixes[0]) : null;
  return { metricsVersion: METRICS_VERSION, launchAltM: launch == null ? null : Math.round(launch),
    maxAltM: fixes.some(fix => alt(fix) != null) ? metrics!.maxAltM : null };
}

/** Rebuild derived fields only; preserve the pilot's names, sites and other edits. */
export function repairedMeasurements(parsed: ParsedIgc, metrics: DerivedMetrics | null) {
  return {
    ...altitudeMeasurements(parsed, metrics),
    parseWarnings: parsed.warnings, status: metrics ? "ready" : "failed",
    failureReason: metrics ? null : "No usable GPS fixes in file",
    altGainM: metrics?.altGainM ?? null, maxClimbMs: metrics?.maxClimbMs ?? null,
    maxSinkMs: metrics?.maxSinkMs ?? null, altSource: metrics?.altSource ?? null,
    trackDistM: metrics?.trackDistM ?? null, straightDistM: metrics?.straightDistM ?? null,
    takeoffAt: metrics ? new Date(metrics.takeoffAtMs) : null,
    landingAt: metrics ? new Date(metrics.landingAtMs) : null, durationS: metrics?.durationS ?? null,
    takeoffLat: metrics?.takeoff.lat ?? null, takeoffLon: metrics?.takeoff.lon ?? null,
    landingLat: metrics?.landing.lat ?? null, landingLon: metrics?.landing.lon ?? null,
    bounds: metrics?.bounds ?? Prisma.JsonNull, localTz: metrics?.localTz ?? null,
    localUtcOffsetMinutes: metrics?.localUtcOffsetMinutes ?? null,
  };
}
