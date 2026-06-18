import type { Fix } from "./types";
import { haversineM } from "@/lib/geo/distance";

/** Horizontal ground speed (m/s) entering each fix; speeds[0] = 0. */
export function groundSpeeds(fixes: Fix[]): number[] {
  const speeds = new Array(fixes.length).fill(0);
  for (let i = 1; i < fixes.length; i++) {
    const dt = fixes[i].t - fixes[i - 1].t;
    if (dt <= 0) continue;
    const d = haversineM(
      fixes[i - 1].lat,
      fixes[i - 1].lon,
      fixes[i].lat,
      fixes[i].lon,
    );
    speeds[i] = d / dt;
  }
  return speeds;
}

/** Centred moving average over a window of ±halfWin samples. */
function smooth(values: number[], halfWin: number): number[] {
  const out = new Array(values.length).fill(0);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - halfWin); j <= Math.min(values.length - 1, i + halfWin); j++) {
      sum += values[j];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

const MOVE_THRESHOLD_MS = 2.0; // sustained ground speed that counts as "flying"

/**
 * First/last sustained-movement fix — the flight window. Ignores slow pre-launch
 * walking and post-landing retrieve by thresholding a smoothed speed series.
 * Falls back to the full track when nothing clears the threshold.
 */
export function detectFlightWindow(fixes: Fix[]): {
  takeoffIndex: number;
  landingIndex: number;
} {
  if (fixes.length < 2) {
    return { takeoffIndex: 0, landingIndex: Math.max(0, fixes.length - 1) };
  }

  const smoothed = smooth(groundSpeeds(fixes), 2);

  let takeoffIndex = -1;
  let landingIndex = -1;
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] > MOVE_THRESHOLD_MS) {
      if (takeoffIndex === -1) takeoffIndex = i;
      landingIndex = i;
    }
  }

  if (takeoffIndex === -1) {
    // No sustained movement — treat the whole recording as the window.
    return { takeoffIndex: 0, landingIndex: fixes.length - 1 };
  }
  // Back the takeoff up one sample so the launch fix itself is included.
  takeoffIndex = Math.max(0, takeoffIndex - 1);
  landingIndex = Math.min(fixes.length - 1, landingIndex + 1);
  return { takeoffIndex, landingIndex };
}
