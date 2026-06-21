import type { ParsedIgc, DerivedMetrics } from "./types";

const MAX_SAMPLES = 1500;

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
  maxSamples = MAX_SAMPLES,
): ReplayPath {
  const window = parsed.fixes.slice(
    metrics.takeoffIndex,
    metrics.landingIndex + 1,
  );
  const src = metrics.altSource;
  const altOf = (f: (typeof window)[number]) =>
    (src === "baro" ? (f.baroAlt ?? f.gpsAlt) : (f.gpsAlt ?? f.baroAlt)) ?? 0;

  const stride = Math.max(1, Math.ceil(window.length / maxSamples));
  const picked = window.filter((_, i) => i % stride === 0);
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

  // Centred vertical speed per sample (m/s).
  const vario = samples.map((s, i) => {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const dt = next[3] - prev[3];
    return dt > 0 ? (next[2] - prev[2]) / dt : 0;
  });

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
