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
  if (!s || s.length < 2) return null;

  const { i, f, tt } = locateSample(s, t);
  const a = s[i - 1];
  const b = s[i];

  const lon = a[0] + (b[0] - a[0]) * f;
  const lat = a[1] + (b[1] - a[1]) * f;
  const altM = Math.round(a[2] + (b[2] - a[2]) * f);

  const va = replay.vario[i - 1] ?? 0;
  const vb = replay.vario[i] ?? 0;
  const varioMs = Math.round((va + (vb - va) * f) * 10) / 10;

  const speedKmh = Math.round(smoothedSpeedKmh(replay, tt));

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

/** Time-weighted distance over ten seconds; never bridge recorder gaps. */
export function smoothedSpeedKmh(replay: ReplayResponse, t: number): number {
  const samples = replay.samples;
  if (samples.length < 2) return 0;
  const { i, tt } = locateSample(samples, t);
  const gap = replay.gapThresholdS ?? 30;
  let start = i - 1, end = i;
  while (start > 0 && samples[start][3] > tt - 5 && samples[start][3] - samples[start - 1][3] <= gap) start--;
  while (end < samples.length - 1 && samples[end][3] < tt + 5 && samples[end + 1][3] - samples[end][3] <= gap) end++;
  let distance = 0, duration = 0;
  for (let j = start + 1; j <= end; j++) {
    const a = samples[j - 1], b = samples[j], dt = b[3] - a[3];
    if (dt <= 0 || dt > gap) continue;
    const overlap = Math.max(0, Math.min(b[3], tt + 5) - Math.max(a[3], tt - 5));
    distance += haversineM(a[1], a[0], b[1], b[0]) * overlap / dt;
    duration += overlap;
  }
  return duration ? distance / duration * 3.6 : 0;
}
