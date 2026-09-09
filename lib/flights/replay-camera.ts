import { bearingDeg, locateSample, positionAt, type Sample } from "@/lib/igc/interpolate";
import { haversineM } from "@/lib/geo/distance";

/** Recognize a straight thermal exit quickly, retaining a wider fallback course. */
export function chaseCourse(samples: Sample[], t: number, gapS = 30): number | null {
  if (samples.length < 2) return null;
  const { i, tt } = locateSample(samples, t);
  t = tt;
  const p = positionAt(samples, t);
  const recentStart = Math.max(samples[0][3], t - 12);
  let travelled = 0;
  let end = p;
  // A nearly straight 12-second segment is enough; circling fails the
  // displacement / travelled-distance check even at the same airspeed.
  for (let j = i - 1; j >= 0; j--) {
    if (samples[j + 1][3] - samples[j][3] > gapS) break;
    const at = Math.max(samples[j][3], recentStart);
    const start = positionAt(samples, at);
    travelled += haversineM(start.lat, start.lon, end.lat, end.lon);
    end = start;
    if (at <= recentStart) {
      const net = haversineM(start.lat, start.lon, p.lat, p.lon);
      if (t - at >= 6 && net >= 60 && net / travelled >= 0.97) {
        return bearingDeg(start.lon, start.lat, p.lon, p.lat);
      }
      break;
    }
  }
  for (let j = i - 1; j >= 0; j--) {
    if (samples[j + 1][3] - samples[j][3] > gapS || t - samples[j][3] > 60) break;
    const a = samples[j];
    if (haversineM(a[1], a[0], p.lat, p.lon) >= 300) return bearingDeg(a[0], a[1], p.lon, p.lat);
  }
  return null;
}

/** Exact critically damped spring step, retaining velocity between frames. */
export function cameraSpring(position: number, velocity: number, target: number, dt: number, frequency: number): [number, number] {
  const offset = position - target;
  const impulse = velocity + frequency * offset;
  const decay = Math.exp(-frequency * dt);
  return [target + (offset + impulse * dt) * decay, (velocity - frequency * impulse * dt) * decay];
}

/** Catch up more forcefully as drift grows, in screen pixels rather than metres. */
export function trackingFrequency(errorPixels: number): number {
  return 8 + 16 * Math.min(1, Math.max(0, errorPixels) / 160);
}

/** Place the anchor between badge/readout clearance and 12% above the bottom. */
export function altitudeAnchorY(alt: number, min: number, max: number, height: number, badgeHeight: number, mobile: boolean) {
  const bottom = height * 0.88;
  const top = Math.min(bottom - 30, (mobile ? 76 : 88) + badgeHeight);
  const fraction = max > min ? Math.max(0, Math.min(1, (alt - min) / (max - min))) : 0.5;
  return bottom + (top - bottom) * fraction;
}
