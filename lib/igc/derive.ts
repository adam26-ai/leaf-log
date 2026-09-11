import type { Fix, DerivedMetrics, ParsedIgc } from "./types";
import { haversineM } from "@/lib/geo/distance";
import { detectFlightWindow } from "./detect";
import { timezoneFromCoords, utcOffsetMinutes } from "@/lib/geo/timezone";
import { baroGpsOffset, playbackAltitude, recordAltitude } from "./altitude";
import { calculatedVario } from "./vario";

const GAIN_HALF_WINDOW_S = 3; // altitude smoothing for cumulative gain only
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

/** Centred altitude smoothing for cumulative gain, never for climb/sink rates. */
function smoothAltitudes(fixes: Fix[], src: "baro" | "gps", offset: number | null): number[] {
  const alt = fixes.map((f) => playbackAltitude(f, src, offset) ?? 0);
  const out = new Array(alt.length).fill(0);
  for (let i = 0; i < alt.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = i; j >= 0 && fixes[i].t - fixes[j].t <= GAIN_HALF_WINDOW_S; j--) {
      sum += alt[j];
      n++;
    }
    for (let j = i + 1; j < alt.length && fixes[j].t - fixes[i].t <= GAIN_HALF_WINDOW_S; j++) {
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
  const smoothAlt = smoothAltitudes(fixes, altSource, baroGpsOffset(window));

  // Max altitude over the flight window.
  let maxAltM = -Infinity;
  for (let i = takeoffIndex; i <= landingIndex; i++) {
    const a = recordAltitude(fixes[i]);
    if (a != null && a > maxAltM) maxAltM = a;
  }
  if (!Number.isFinite(maxAltM)) maxAltM = 0;

  // Cumulative gain from the smoothed series, with a noise threshold.
  let altGainM = 0;
  for (let i = takeoffIndex + 1; i <= landingIndex; i++) {
    const d = smoothAlt[i] - smoothAlt[i - 1];
    if (d > GAIN_NOISE_THRESHOLD_M) altGainM += d;
  }

  // Prefer the logger's recorded vario. Older files fall back to a calculated
  // single four-second altitude difference, shared with replay.
  let maxClimbMs = 0;
  let maxSinkMs = 0;
  const recordedVario = window
    .map((fix) => fix.varioMs)
    .filter((value): value is number => value != null);
  if (recordedVario.length > 0) {
    maxClimbMs = Math.max(0, ...recordedVario);
    maxSinkMs = Math.min(0, ...recordedVario);
  } else for (const vs of calculatedVario(window, altSource, baroGpsOffset(window))) {
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
