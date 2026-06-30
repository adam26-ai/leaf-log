/** A time-aligned track sample: [lon, lat, altMetres, tOffsetSeconds]. */
export type Sample = [number, number, number, number];

const EARTH_RADIUS_M = 6371000;
const MIN_HEADING_DISPLACEMENT_M = 5;

/**
 * Locate the bracketing sample index and interpolation fraction for time `t`
 * (seconds from takeoff), clamped to the sample range. Shared by the instrument
 * readout, the map cursor, and photo placement so they all agree.
 */
export function locateSample(
  samples: Sample[],
  t: number,
): { i: number; f: number; tt: number } {
  const tt = Math.max(samples[0][3], Math.min(samples[samples.length - 1][3], t));
  let i = 1;
  while (i < samples.length && samples[i][3] < tt) i++;
  if (i >= samples.length) i = samples.length - 1;
  const a = samples[i - 1];
  const b = samples[i];
  const f = (tt - a[3]) / (b[3] - a[3] || 1);
  return { i, f, tt };
}

/** Interpolated position at time `t`. `altM` is rounded to the metre. */
export function positionAt(
  samples: Sample[],
  t: number,
): { lon: number; lat: number; altM: number } {
  const { i, f } = locateSample(samples, t);
  const a = samples[i - 1];
  const b = samples[i];
  return {
    lon: a[0] + (b[0] - a[0]) * f,
    lat: a[1] + (b[1] - a[1]) * f,
    altM: Math.round(a[2] + (b[2] - a[2]) * f),
  };
}

/** Initial great-circle bearing from a to b, degrees clockwise from north. */
export function bearingDeg(
  aLon: number,
  aLat: number,
  bLon: number,
  bLat: number,
): number {
  const phi1 = (aLat * Math.PI) / 180;
  const phi2 = (bLat * Math.PI) / 180;
  const dLambda = ((bLon - aLon) * Math.PI) / 180;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function distanceMeters(aLon: number, aLat: number, bLon: number, bLat: number) {
  const phi1 = (aLat * Math.PI) / 180;
  const phi2 = (bLat * Math.PI) / 180;
  const dPhi = ((bLat - aLat) * Math.PI) / 180;
  const dLambda = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Damped heading at time `t`, measured across a centred time window. Returns
 * null when the net horizontal displacement is too small to be a stable heading.
 */
export function headingAt(
  samples: Sample[],
  t: number,
  windowS = 8,
): number | null {
  if (samples.length < 2) return null;
  const half = windowS / 2;
  const a = positionAt(samples, t - half);
  const b = positionAt(samples, t + half);
  if (distanceMeters(a.lon, a.lat, b.lon, b.lat) < MIN_HEADING_DISPLACEMENT_M) {
    return null;
  }
  return bearingDeg(a.lon, a.lat, b.lon, b.lat);
}
