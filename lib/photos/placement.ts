import type {
  FlightPlacementContext,
  Placement,
  PhotoMeta,
} from "./types";
import { localToUtcMs } from "./time";
import { positionAt, type Sample } from "@/lib/igc/interpolate";

/** Inflate the flight bbox (degrees) when sanity-checking EXIF GPS. */
const GPS_BOUNDS_PAD_DEG = 0.5;

function unpinned(
  failureReason: Placement["failureReason"],
  takenAtMs: number | null = null,
): Placement {
  return {
    lat: null,
    lon: null,
    altM: null,
    tSec: null,
    takenAtMs,
    source: "unpinned",
    failureReason,
  };
}

function utcFromMeta(
  meta: PhotoMeta,
  ctx: FlightPlacementContext,
): { ms: number | null; reason: "no_time" | "missing_flight_offset" | null } {
  if (!meta.takenAtLocal) return { ms: null, reason: "no_time" };
  // v1 bridges via the flight's derived offset (EXIF offset kept only as a
  // diagnostic) — the flight context is more reliable than camera offsets.
  if (ctx.localUtcOffsetMinutes == null) {
    return { ms: null, reason: "missing_flight_offset" };
  }
  return { ms: localToUtcMs(meta.takenAtLocal, ctx.localUtcOffsetMinutes), reason: null };
}

function gpsInBounds(
  gps: { lat: number; lon: number },
  bounds: [number, number, number, number],
): boolean {
  if (gps.lat < -90 || gps.lat > 90 || gps.lon < -180 || gps.lon > 180) return false;
  const [w, s, e, n] = bounds;
  const p = GPS_BOUNDS_PAD_DEG;
  return gps.lon >= w - p && gps.lon <= e + p && gps.lat >= s - p && gps.lat <= n + p;
}

/**
 * Place a photo on a flight. GPS (sanity-checked) wins; otherwise interpolate
 * the position from the capture time bridged to UTC via the flight offset.
 * Out-of-window / no-time / null-offset / bad-GPS all leave the photo unpinned
 * (never clamped to an endpoint, never a confident wrong pin).
 */
export function placePhoto(
  meta: PhotoMeta,
  ctx: FlightPlacementContext,
  samples: Sample[],
): Placement {
  const time = utcFromMeta(meta, ctx);
  const tSec = time.ms != null ? (time.ms - ctx.takeoffMs) / 1000 : null;
  const inWindow = tSec != null && tSec >= 0 && tSec <= ctx.durationS;

  // 1) GPS override, when present and plausible.
  if (meta.gps && gpsInBounds(meta.gps, ctx.bounds)) {
    return {
      lat: meta.gps.lat,
      lon: meta.gps.lon,
      altM: meta.gps.altM,
      tSec: inWindow ? tSec : null,
      takenAtMs: time.ms,
      source: "exif_gps",
      failureReason: null,
    };
  }

  // 2) Timestamp interpolation.
  if (time.ms == null) {
    if (time.reason === "missing_flight_offset") return unpinned("missing_flight_offset");
    if (meta.gps) return unpinned("bad_gps"); // had GPS but it was implausible, no time fallback
    return unpinned("no_time");
  }
  if (!inWindow) return unpinned("out_of_window", time.ms);

  const p = positionAt(samples, tSec as number);
  return {
    lat: p.lat,
    lon: p.lon,
    altM: p.altM,
    tSec: tSec as number,
    takenAtMs: time.ms,
    source: "interpolated_time",
    failureReason: null,
  };
}
