import type { Fix, DerivedMetrics } from "./types";

export const TRACK_ARTIFACT_VERSION = 1;
const MAX_LINE_POINTS = 2000;
const MAX_BARO_POINTS = 2000;

export interface TrackArtifact {
  v: number;
  altSource: "baro" | "gps";
  units: { alt: "m"; t: "s" };
  /** Simplified [lon, lat] polyline. */
  line: [number, number][];
  /** Downsampled [tOffsetSeconds, altMetres] series for the barograph. */
  baro: [number, number][];
  bounds: [number, number, number, number];
  downsample: { method: "rdp+stride"; maxLinePoints: number };
}

/** Perpendicular distance (degrees) of point p from segment a→b. */
function perpDist(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ramer–Douglas–Peucker simplification (iterative, stack-based). */
function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDist(points[i], points[start], points[end]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx !== -1) {
      keep[idx] = true;
      stack.push([start, idx], [idx, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Build the render artifact: simplified track line + downsampled barograph. */
export function buildTrackArtifact(
  fixes: Fix[],
  metrics: DerivedMetrics,
): TrackArtifact {
  const window = fixes.slice(metrics.takeoffIndex, metrics.landingIndex + 1);

  // Simplify the line; tighten epsilon until under the point cap.
  const raw: [number, number][] = window.map((f) => [f.lon, f.lat]);
  let epsilon = 0.00005; // ~5 m
  let line = rdp(raw, epsilon);
  while (line.length > MAX_LINE_POINTS && epsilon < 0.01) {
    epsilon *= 2;
    line = rdp(raw, epsilon);
  }
  if (line.length > MAX_LINE_POINTS) {
    const stride = Math.ceil(line.length / MAX_LINE_POINTS);
    line = line.filter((_, i) => i % stride === 0);
  }

  // Downsample the barograph series by striding.
  const src = metrics.altSource;
  const t0 = window[0]?.t ?? 0;
  const baroAll: [number, number][] = window.map((f) => {
    const a = src === "baro" ? (f.baroAlt ?? f.gpsAlt) : (f.gpsAlt ?? f.baroAlt);
    return [Math.round(f.t - t0), Math.round(a ?? 0)];
  });
  const stride = Math.max(1, Math.ceil(baroAll.length / MAX_BARO_POINTS));
  const baro = baroAll.filter((_, i) => i % stride === 0);

  return {
    v: TRACK_ARTIFACT_VERSION,
    altSource: src,
    units: { alt: "m", t: "s" },
    line,
    baro,
    bounds: metrics.bounds,
    downsample: { method: "rdp+stride", maxLinePoints: MAX_LINE_POINTS },
  };
}
