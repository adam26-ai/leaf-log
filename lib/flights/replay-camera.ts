import { bearingDeg, locateSample, positionAt, type Sample } from "@/lib/igc/interpolate";
import { haversineM } from "@/lib/geo/distance";

/** Require meaningful progress, not distance travelled around a thermal. */
export function chaseCourse(samples: Sample[], t: number, gapS = 30): number | null {
  if (samples.length < 2) return null;
  const p = positionAt(samples, t);
  const { i } = locateSample(samples, t);
  for (let j = i - 1; j >= 0; j--) {
    if (samples[j + 1][3] - samples[j][3] > gapS || t - samples[j][3] > 120) break;
    const a = samples[j];
    if (haversineM(a[1], a[0], p.lat, p.lon) >= 500) return bearingDeg(a[0], a[1], p.lon, p.lat);
  }
  return null;
}

/** Place the anchor between badge/readout clearance and 12% above the bottom. */
export function altitudeAnchorY(alt: number, min: number, max: number, height: number, badgeHeight: number, mobile: boolean) {
  const bottom = height * 0.88;
  const top = Math.min(bottom - 30, (mobile ? 76 : 88) + badgeHeight);
  const fraction = max > min ? Math.max(0, Math.min(1, (alt - min) / (max - min))) : 0.5;
  return bottom + (top - bottom) * fraction;
}
