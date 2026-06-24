import type { LocalDateTime } from "./types";

/**
 * Convert naive local date/time components to a UTC instant (ms), given the
 * local offset in minutes (e.g. -420 for UTC-7). Uses `Date.UTC` on the
 * components — never `new Date(string)` — so the server's own timezone can't
 * leak into the result.
 */
export function localToUtcMs(c: LocalDateTime, offsetMinutes: number): number {
  return Date.UTC(c.y, c.mo - 1, c.d, c.h, c.mi, c.s) - offsetMinutes * 60_000;
}

/**
 * Parse an EXIF `DateTimeOriginal` string ("YYYY:MM:DD HH:MM:SS", optionally
 * with sub-seconds) into naive components. Returns null if it doesn't match.
 */
export function parseExifDateTime(value: unknown): LocalDateTime | null {
  if (typeof value !== "string") return null;
  const m = value
    .trim()
    .match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) {
    return null;
  }
  return { y, mo, d, h, mi, s };
}

/**
 * Parse an EXIF `OffsetTimeOriginal` string ("+07:00", "-08:00", "Z") into
 * minutes. Returns null if absent/unparseable.
 */
export function parseExifOffset(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v === "Z") return 0;
  const m = v.match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}
