import type { Fix, DerivedMetrics, ParsedIgc } from "./types";
import { haversineM } from "@/lib/geo/distance";
import { detectFlightWindow } from "./detect";
import { timezoneFromCoords, utcOffsetMinutes } from "@/lib/geo/timezone";

const CLIMB_WINDOW_S = 3; // smoothing window for vario (raw 1s deltas are noise)
const GAIN_NOISE_THRESHOLD_M = 1.0; // ignore sub-metre jitter in cumulative gain

/** Choose the altitude source: prefer baro when present on a usable fraction of fixes. */
function chooseAltSource(fixes: Fix[]): "baro" | "gps" {
  let baro = 0;
  let gps = 0;
  for (const f of fixes) {
    if (f.baroAlt != null) baro++;
    if (f.gpsAlt != null) gps++;
  }
  if (baro >= Math.max(1, fixes.length * 0.5)) return "baro";
  if (gps > baro) return "gps";
  return baro > 0 ? "baro" : "gps";
}

const altOf = (f: Fix, src: "baro" | "gps"): number | null =>
  src === "baro" ? (f.baroAlt ?? f.gpsAlt) : (f.gpsAlt ?? f.baroAlt);

/** Centred moving average of altitude (metres) over ~CLIMB_WINDOW_S seconds. */
function smoothAltitudes(fixes: Fix[], src: "baro" | "gps"): number[] {
  const alt = fixes.map((f) => altOf(f, src) ?? 0);
  const out = new Array(alt.length).fill(0);
  for (let i = 0; i < alt.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && fixes[i].t - fixes[j].t <= CLIMB_WINDOW_S; j--) {
      sum += alt[j];
      n++;
    }
    for (let j = i + 1; j < alt.length && fixes[j].t - fixes[i].t <= CLIMB_WINDOW_S; j++) {
      sum += alt[j];
      n++;
    }
    out[i] = n ? sum / n : alt[i];
  }
  return out;
}

/**
 * Derive all M1 flight metrics from a parsed IGC. Returns null when there are no
 * usable fixes (caller marks the flight failed). Pure; never throws on good input.
 */
export function deriveMetrics(parsed: ParsedIgc): DerivedMetrics | null {
  const { fixes } = parsed;
  if (fixes.length < 2) return null;

  const { takeoffIndex, landingIndex } = detectFlightWindow(fixes);
  const window = fixes.slice(takeoffIndex, landingIndex + 1);
  if (window.length < 2) return null;

  const altSource = chooseAltSource(fixes);
  const smoothAlt = smoothAltitudes(fixes, altSource);

  // Max altitude over the flight window.
  let maxAltM = -Infinity;
  for (let i = takeoffIndex; i <= landingIndex; i++) {
    const a = altOf(fixes[i], altSource);
    if (a != null && a > maxAltM) maxAltM = a;
  }
  if (!Number.isFinite(maxAltM)) maxAltM = 0;

  // Cumulative gain from the smoothed series, with a noise threshold.
  let altGainM = 0;
  for (let i = takeoffIndex + 1; i <= landingIndex; i++) {
    const d = smoothAlt[i] - smoothAlt[i - 1];
    if (d > GAIN_NOISE_THRESHOLD_M) altGainM += d;
  }

  // Max climb / sink over a ~CLIMB_WINDOW_S vario window (smoothed altitude).
  let maxClimbMs = 0;
  let maxSinkMs = 0;
  for (let i = takeoffIndex; i <= landingIndex; i++) {
    let j = i;
    while (j < landingIndex && fixes[j].t - fixes[i].t < CLIMB_WINDOW_S) j++;
    const dt = fixes[j].t - fixes[i].t;
    if (dt <= 0) continue;
    const vs = (smoothAlt[j] - smoothAlt[i]) / dt;
    if (vs > maxClimbMs) maxClimbMs = vs;
    if (vs < maxSinkMs) maxSinkMs = vs;
  }

  // Distances + bounds.
  let trackDistM = 0;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (let i = takeoffIndex; i <= landingIndex; i++) {
    const f = fixes[i];
    if (f.lon < west) west = f.lon;
    if (f.lon > east) east = f.lon;
    if (f.lat < south) south = f.lat;
    if (f.lat > north) north = f.lat;
    if (i > takeoffIndex) {
      trackDistM += haversineM(
        fixes[i - 1].lat,
        fixes[i - 1].lon,
        f.lat,
        f.lon,
      );
    }
  }

  const takeoff = fixes[takeoffIndex];
  const landing = fixes[landingIndex];
  const straightDistM = haversineM(
    takeoff.lat,
    takeoff.lon,
    landing.lat,
    landing.lon,
  );

  const durationS = Math.max(0, Math.round(landing.t - takeoff.t));

  const localTz = timezoneFromCoords(takeoff.lat, takeoff.lon);
  const localUtcOffsetMinutes = localTz
    ? utcOffsetMinutes(localTz, takeoff.timeMs)
    : null;

  return {
    takeoffIndex,
    landingIndex,
    takeoffAtMs: takeoff.timeMs,
    landingAtMs: landing.timeMs,
    durationS,
    maxAltM: Math.round(maxAltM),
    altGainM: Math.round(altGainM),
    maxClimbMs: Math.round(maxClimbMs * 10) / 10,
    maxSinkMs: Math.round(maxSinkMs * 10) / 10,
    trackDistM: Math.round(trackDistM),
    straightDistM: Math.round(straightDistM),
    altSource,
    takeoff: { lat: takeoff.lat, lon: takeoff.lon },
    landing: { lat: landing.lat, lon: landing.lon },
    bounds: [west, south, east, north],
    localTz,
    localUtcOffsetMinutes,
  };
}
