import type { ParsedIgc, DerivedMetrics } from "./types";
import { baroGpsOffset, playbackAltitude } from "./altitude";
import { calculatedVario } from "./vario";

// Preserve the recorder's typical one-fix-per-second detail regardless of
// flight duration. The high ceiling still bounds unusually dense/long files.
const TARGET_SAMPLE_INTERVAL_S = 1;
const MAX_REPLAY_SAMPLES = 24_000;

/** The /api/flights/[id]/replay response (the replay path + timing context). */
export interface ReplayResponse extends ReplayPath {
  gapThresholdS?: number;
  takeoffMs: number;
  offsetMin: number;
}

export interface ReplayPath {
  /** Time-aligned samples: [lon, lat, altMetres, tOffsetSeconds]. */
  samples: [number, number, number, number][];
  /** Per-sample vertical speed (m/s) for climb/sink coloring. */
  vario: number[];
  bounds: [number, number, number, number];
  durationS: number;
  altSource: "baro" | "gps";
  /** Static GPS-minus-baro median in metres; null if no valid pairs exist. */
  baroOffsetM?: number | null;
}

/**
 * Build a single time-aligned 3D path for the animated replay. Unlike the 2D
 * track artifact (which stores the map line and barograph as separate,
 * unaligned downsampled series), this keeps lon/lat/alt/time together so the 3D
 * view can interpolate a glider position at any moment.
 */
export function buildReplayPath(
  parsed: ParsedIgc,
  metrics: DerivedMetrics,
  maxSamples = MAX_REPLAY_SAMPLES,
): ReplayPath {
  const window = parsed.fixes.slice(
    metrics.takeoffIndex,
    metrics.landingIndex + 1,
  );
  const src = metrics.altSource;
  const baroOffsetM = baroGpsOffset(window);
  const altOf = (f: (typeof window)[number]) =>
    playbackAltitude(f, src, baroOffsetM) ?? 0;

  const firstTime = window[0]?.t ?? 0;
  const lastTime = window[window.length - 1]?.t ?? firstTime;
  const duration = Math.max(0, lastTime - firstTime);
  const limit = Math.max(2, Math.floor(maxSamples));
  const interval = Math.max(TARGET_SAMPLE_INTERVAL_S, duration / Math.max(1, limit - 1));
  const picked = window.length > 0 ? [window[0]] : [];
  let nextTime = firstTime + interval;
  for (let index = 1; index < window.length - 1 && picked.length < limit - 1; index++) {
    const fix = window[index];
    if (fix.t < nextTime) continue;
    picked.push(fix);
    while (nextTime <= fix.t) nextTime += interval;
  }
  // Always include the final fix so the track ends at the landing.
  if (picked[picked.length - 1] !== window[window.length - 1]) {
    picked.push(window[window.length - 1]);
  }

  const t0 = window[0]?.t ?? 0;
  const samples = picked.map(
    (f) =>
      [f.lon, f.lat, Math.round(altOf(f)), Math.round(f.t - t0)] as [
        number,
        number,
        number,
        number,
      ],
  );

  // Calculate on original fixes so replay decimation cannot widen the window.
  const rates = calculatedVario(window, src, baroOffsetM);
  const rateByFix = new Map(window.map((fix, index) => [fix, fix.varioMs ?? rates[index]]));
  const vario = picked.map(fix => rateByFix.get(fix) ?? 0);

  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lon, lat] of samples) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  return {
    samples,
    vario,
    bounds: [west, south, east, north],
    durationS: metrics.durationS,
    altSource: src,
    baroOffsetM,
  };
}
