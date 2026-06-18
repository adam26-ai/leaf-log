import type { Fix, IgcHeaders, ParsedIgc } from "./types";

const DAY_MS = 86_400_000;

/** Parse "DDMMmmm" (lat, 7 digits) or "DDDMMmmm" (lon, 8 digits) into signed degrees. */
function parseCoord(
  digits: string,
  degLen: number,
  hemi: string,
): number | null {
  if (!/^\d+$/.test(digits) || digits.length !== degLen + 5) return null;
  const deg = parseInt(digits.slice(0, degLen), 10);
  const minWhole = parseInt(digits.slice(degLen, degLen + 2), 10);
  const minFrac = parseInt(digits.slice(degLen + 2), 10); // thousandths of a minute
  const minutes = minWhole + minFrac / 1000;
  let value = deg + minutes / 60;
  if (hemi === "S" || hemi === "W") value = -value;
  if (Number.isNaN(value)) return null;
  return value;
}

function parseAltField(s: string): number | null {
  const v = parseInt(s, 10);
  return Number.isNaN(v) ? null : v;
}

/** Parse the HFDTE header (DDMMYY, with optional `DATE:` and trailing `,NN`). */
function parseDate(line: string): number | null {
  const m = line.match(/^HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yy = parseInt(m[3], 10);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  // Two-digit year: free-flight IGC files are post-2000.
  const year = 2000 + yy;
  return Date.UTC(year, mm - 1, dd);
}

function headerValue(line: string): string | null {
  // H records carry a free-text value after a colon (e.g. "HFPLTPILOTINCHARGE:Jane").
  const idx = line.indexOf(":");
  const v = idx >= 0 ? line.slice(idx + 1) : line.slice(5);
  const trimmed = v.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Tolerant IGC parser. NEVER throws — malformed input yields warnings and is skipped.
 * Returns the headers, the corrected fix stream, and any warnings.
 */
export function parseIgc(input: string | Uint8Array): ParsedIgc {
  const text =
    typeof input === "string" ? input : new TextDecoder().decode(input);

  const headers: IgcHeaders = {
    dateMs: null,
    pilot: null,
    glider: null,
    recorder: null,
  };
  const fixes: Fix[] = [];
  const warnings: string[] = [];

  const lines = text.split(/\r?\n/);
  let badBRecords = 0;

  // First pass: headers (need the date before we can timestamp B-records).
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    const type = line[0];
    if (type === "A" && !headers.recorder) {
      headers.recorder = line.slice(1).trim() || null;
    } else if (type === "H") {
      const tag = line.slice(0, 5).toUpperCase();
      if (tag === "HFDTE") headers.dateMs = parseDate(line);
      else if (tag.startsWith("HFPLT")) headers.pilot = headerValue(line);
      else if (tag.startsWith("HFGTY") || tag.startsWith("HFGID")) {
        headers.glider = headers.glider ?? headerValue(line);
      }
    }
  }

  if (headers.dateMs == null) {
    warnings.push("Missing or invalid flight date (HFDTE) — times are relative.");
  }
  const baseDate = headers.dateMs ?? 0;

  // Second pass: B-records, with UTC midnight-rollover correction.
  let dayOffset = 0;
  let prevSecOfDay = -1;

  for (const raw of lines) {
    if (raw[0] !== "B") continue;
    const line = raw.trimEnd();
    if (line.length < 35) {
      badBRecords++;
      continue;
    }

    const hh = +line.slice(1, 3);
    const mm = +line.slice(3, 5);
    const ss = +line.slice(5, 7);
    if (Number.isNaN(hh) || Number.isNaN(mm) || Number.isNaN(ss)) {
      badBRecords++;
      continue;
    }
    const secOfDay = hh * 3600 + mm * 60 + ss;

    const lat = parseCoord(line.slice(7, 14), 2, line[14]);
    const lon = parseCoord(line.slice(15, 23), 3, line[23]);
    if (lat == null || lon == null) {
      badBRecords++;
      continue;
    }
    // Drop null-island / out-of-range coordinates.
    if (
      (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      badBRecords++;
      continue;
    }

    const validFlag = line[24];
    const baroAlt = parseAltField(line.slice(25, 30));
    const gpsAlt = parseAltField(line.slice(30, 35));

    if (prevSecOfDay >= 0 && secOfDay < prevSecOfDay - 60) {
      // Time went backwards by more than a minute → crossed UTC midnight.
      dayOffset += 1;
    }
    prevSecOfDay = secOfDay;

    const timeMs = baseDate + dayOffset * DAY_MS + secOfDay * 1000;

    fixes.push({
      t: dayOffset * DAY_MS / 1000 + secOfDay,
      timeMs,
      lat,
      lon,
      // Treat a stuck/zero baro as "absent" so derivation can fall back to GPS.
      baroAlt: baroAlt && baroAlt !== 0 ? baroAlt : null,
      gpsAlt: gpsAlt && gpsAlt !== 0 ? gpsAlt : null,
      valid: validFlag === "A",
    });
  }

  if (badBRecords > 0) {
    warnings.push(`Skipped ${badBRecords} malformed or invalid fix record(s).`);
  }
  if (fixes.length === 0) {
    warnings.push("No valid GPS fixes found in this file.");
  }

  return { headers, fixes, warnings };
}
