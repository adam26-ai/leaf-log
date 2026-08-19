/** Human formatting for flight metrics — beginner-friendly, plain language. */

type DateInput = Date | string | null | undefined;

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

export function formatAltitude(m: number | null): string {
  return m == null ? "—" : `${m.toLocaleString()} m`;
}

export function formatDistance(m: number | null): string {
  if (m == null) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Degrees clockwise from north -> an 8-point compass abbreviation. */
export function formatBearing(deg: number): string {
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS_POINTS[index];
}

export function formatVario(ms: number | null): string {
  if (ms == null) return "—";
  const sign = ms > 0 ? "+" : "";
  return `${sign}${ms.toFixed(1)} m/s`;
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
