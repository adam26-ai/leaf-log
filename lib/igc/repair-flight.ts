import { Prisma } from "@prisma/client";
import { METRICS_VERSION } from "../flights/analysis-state";
import type { DerivedMetrics, Fix, ParsedIgc } from "./types";
import { recordAltitude } from "./altitude";

/** Recover an uninitialized zero without changing ordinary launch readings. */
export function launchAltitude(fixes: Fix[]): number | null {
  const first = fixes[0];
  const altitude = first ? recordAltitude(first) : null;
  // Oudie recordings can mark the startup zero A while reporting FXA 800 m.
  // A real zero, missing altitude, and every nonzero reading keep their behavior.
  if (altitude !== 0 || first.fixAccuracyM == null || first.fixAccuracyM <= 100) return altitude;
  for (let index = 1; index < fixes.length; index++) {
    const fix = fixes[index];
    const dt = fix.t - first.t;
    if (dt <= 0 || dt > 15) continue;
    const candidate = recordAltitude(fix);
    if (candidate != null && (fix.fixAccuracyM == null || fix.fixAccuracyM <= 100)) return candidate;
  }
  return null;
}

export function altitudeMeasurements(parsed: ParsedIgc, metrics: DerivedMetrics | null) {
  const fixes = metrics ? parsed.fixes.slice(metrics.takeoffIndex, metrics.landingIndex + 1) : [];
  const launch = launchAltitude(fixes);
  return { metricsVersion: METRICS_VERSION, launchAltM: launch == null ? null : Math.round(launch),
    maxAltM: fixes.some(fix => recordAltitude(fix) != null) ? metrics!.maxAltM : null };
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
