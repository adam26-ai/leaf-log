/** Human formatting for flight metrics — beginner-friendly, plain language. */

import { resolveUnits, type UnitSystem } from "./units";
export type { UnitSystem } from "./units";

type DateInput = Date | string | null | undefined;

const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 1609.344;
const FPM_PER_MS = 196.850394;
const MPH_PER_KMH = 0.621371;
const METERS_PER_NAUTICAL_MILE = 1852;

function toMs(d: DateInput): number | null {
  if (d == null) return null;
  const ms = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isNaN(ms) ? null : ms;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

export function formatAltitude(m: number | null, system: UnitSystem = "metric"): string {
  if (m == null) return "—";
  if (resolveUnits(system).altitude === "ft") return `${Math.round(m / METERS_PER_FOOT).toLocaleString()} ft`;
  return `${m.toLocaleString()} m`;
}

export function formatDistance(m: number | null, system: UnitSystem = "metric"): string {
  if (m == null) return "—";
  const unit = resolveUnits(system).distance;
  if (unit === "nautical-miles") return `${(m / METERS_PER_NAUTICAL_MILE).toFixed(1)} nmi`;
  if (unit === "miles") {
    const feet = m / METERS_PER_FOOT;
    if (feet < 528) return `${Math.round(feet)} ft`; // under 0.1 mi
    return `${(m / METERS_PER_MILE).toFixed(1)} mi`;
  }
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Degrees clockwise from north -> an 8-point compass abbreviation. */
export function formatBearing(deg: number): string {
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS_POINTS[index];
}

export function formatVario(ms: number | null, system: UnitSystem = "metric"): string {
  if (ms == null) return "—";
  const sign = ms > 0 ? "+" : "";
  const unit = resolveUnits(system).vario;
  if (unit === "ft/min") return `${sign}${Math.round(ms * FPM_PER_MS).toLocaleString()} fpm`;
  if (unit === "knots") return `${sign}${(ms * 3600 / METERS_PER_NAUTICAL_MILE).toFixed(1)} kt`;
  return `${sign}${ms.toFixed(1)} m/s`;
}

export function formatSpeed(kmh: number | null, system: UnitSystem = "metric"): string {
  if (kmh == null) return "—";
  const unit = resolveUnits(system).speed;
  if (unit === "mph") return `${Math.round(kmh * MPH_PER_KMH).toLocaleString()} mph`;
  if (unit === "knots") return `${Math.round(kmh * 1000 / METERS_PER_NAUTICAL_MILE).toLocaleString()} kt`;
  return `${Math.round(kmh).toLocaleString()} km/h`;
}

/**
 * Local clock time for an instant, using the flight's stored UTC offset so it
 * reads the way the pilot experienced it — independent of the viewer's timezone.
 */
export function formatLocalTime(d: DateInput, offsetMinutes: number | null): string {
  const ms = toMs(d);
  if (ms == null) return "—";
  const shifted = new Date(ms + (offsetMinutes ?? 0) * 60_000);
  const hh = shifted.getUTCHours().toString().padStart(2, "0");
  const mm = shifted.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

export function formatLocalDate(d: DateInput, offsetMinutes: number | null): string {
  const ms = toMs(d);
  if (ms == null) return "—";
  const shifted = new Date(ms + (offsetMinutes ?? 0) * 60_000);
  return shifted.toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
