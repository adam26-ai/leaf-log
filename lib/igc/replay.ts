import type { ParsedIgc, DerivedMetrics } from "./types";

// Preserve the recorder's typical one-fix-per-second detail regardless of
// flight duration. The high ceiling still bounds unusually dense/long files.
const TARGET_SAMPLE_INTERVAL_S = 1;
const MAX_REPLAY_SAMPLES = 24_000;
const VARIO_HALF_WINDOW_S = 4;

/** The /api/flights/[id]/replay response (the replay path + timing context). */
export interface ReplayResponse extends ReplayPath {
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
  const altOf = (f: (typeof window)[number]) =>
    (src === "baro" ? (f.baroAlt ?? f.gpsAlt) : (f.gpsAlt ?? f.baroAlt)) ?? 0;

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

  // Centred, time-based vertical speed. A fixed time window keeps the color
  // response consistent whether fixes arrive once or several times a second.
  const calculatedVario = samples.map((s, i) => {
    let previousIndex = i;
    let nextIndex = i;
    while (
      previousIndex > 0 &&
      s[3] - samples[previousIndex][3] < VARIO_HALF_WINDOW_S
    ) {
      previousIndex--;
    }
    while (
      nextIndex < samples.length - 1 &&
      samples[nextIndex][3] - s[3] < VARIO_HALF_WINDOW_S
    ) {
      nextIndex++;
    }
    const prev = samples[previousIndex];
    const next = samples[nextIndex];
    const dt = next[3] - prev[3];
    return dt > 0 ? (next[2] - prev[2]) / dt : 0;
  });
  const vario = picked.map((fix, index) => fix.varioMs ?? calculatedVario[index]);

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
  };
}
