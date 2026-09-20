export interface LaunchAltitudeMeasurements {
  /** Highest altitude above mean sea level during the flight. */
  maxAltM?: number | null;
  /** Altitude above mean sea level at the detected or reported launch. */
  launchAltM?: number | null;
}

/**
 * Highest altitude reached relative to launch. This is a single net height,
 * unlike `altGainM`, which accumulates every climb during the flight.
 */
export function peakGainAboveLaunchM(flight: LaunchAltitudeMeasurements): number | null {
  const { maxAltM, launchAltM } = flight;
  if (maxAltM == null || launchAltM == null || !Number.isFinite(maxAltM) || !Number.isFinite(launchAltM)) return null;
  const gain = maxAltM - launchAltM;
  return gain >= 0 ? gain : null;
}
