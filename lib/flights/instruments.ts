import type { ReplayResponse } from "@/lib/igc/replay";
import { haversineM } from "@/lib/geo/distance";
import { locateSample } from "@/lib/igc/interpolate";

export interface InstrumentReading {
  /** Seconds from takeoff. */
  t: number;
  altM: number;
  /** Vertical speed (m/s) — climb positive, sink negative. */
  varioMs: number;
  speedKmh: number;
  lat: number;
  lon: number;
  /** Absolute UTC instant (ms) of this point. */
  timeMs: number;
  offsetMin: number;
}

/**
 * Interpolate the instrument readings (altitude, vario, ground speed, time,
 * position) at a point in time from the replay path. Pure.
 */
export function instrumentAt(
  replay: ReplayResponse,
  t: number,
): InstrumentReading | null {
  const s = replay.samples;
  if (!s || s.length === 0) return null;

  const { i, f, tt } = locateSample(s, t);
  const a = s[i - 1];
  const b = s[i];
  const span = b[3] - a[3] || 1;

  const lon = a[0] + (b[0] - a[0]) * f;
  const lat = a[1] + (b[1] - a[1]) * f;
  const altM = Math.round(a[2] + (b[2] - a[2]) * f);

  const va = replay.vario[i - 1] ?? 0;
  const vb = replay.vario[i] ?? 0;
  const varioMs = Math.round((va + (vb - va) * f) * 10) / 10;

  // Ground speed across the bracketing segment.
  const dist = haversineM(a[1], a[0], b[1], b[0]);
  const speedKmh = Math.round((dist / span) * 3.6);

  return {
    t: tt,
    altM,
    varioMs,
    speedKmh,
    lat,
    lon,
    timeMs: replay.takeoffMs + tt * 1000,
    offsetMin: replay.offsetMin,
  };
}
