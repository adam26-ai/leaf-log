export type TerrainProfilePoint = [timeS: number, elevationM: number];

/** Linear terrain height at a barograph timestamp. */
export function terrainElevationAt(
  profile: TerrainProfilePoint[],
  timeS: number,
): number | undefined {
  if (profile.length === 0 || timeS < profile[0][0] || timeS > profile[profile.length - 1][0]) {
    return undefined;
  }

  let low = 0;
  let high = profile.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (profile[middle][0] < timeS) low = middle + 1;
    else high = middle;
  }

  const next = profile[low];
  if (next[0] === timeS || low === 0) return next[1];
  const previous = profile[low - 1];
  const fraction = (timeS - previous[0]) / (next[0] - previous[0]);
  return previous[1] + (next[1] - previous[1]) * fraction;
}
