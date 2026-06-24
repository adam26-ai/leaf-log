/** A time-aligned track sample: [lon, lat, altMetres, tOffsetSeconds]. */
export type Sample = [number, number, number, number];

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
