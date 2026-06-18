import tzlookup from "tz-lookup";

/** IANA timezone name for a coordinate, or null if lookup fails. */
export function timezoneFromCoords(lat: number, lon: number): string | null {
  try {
    return tzlookup(lat, lon);
  } catch {
    return null;
  }
}

/**
 * UTC offset (minutes) for a given instant in an IANA timezone.
 * Positive = east of UTC. Uses the ICU tz database via Intl.
 */
export function utcOffsetMinutes(tz: string, atMs: number): number | null {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    });
    const part = dtf
      .formatToParts(new Date(atMs))
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part) return null;
    // e.g. "GMT-7", "GMT+5:30", "GMT" (UTC)
    const m = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return part === "GMT" ? 0 : null;
    const sign = m[1] === "-" ? -1 : 1;
    const hours = parseInt(m[2], 10);
    const mins = m[3] ? parseInt(m[3], 10) : 0;
    return sign * (hours * 60 + mins);
  } catch {
    return null;
  }
}
