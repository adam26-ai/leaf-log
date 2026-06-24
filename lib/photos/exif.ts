import exifr from "exifr";
import type { PhotoMeta } from "./types";
import { parseExifDateTime, parseExifOffset } from "./time";

/**
 * Extract the placement-relevant EXIF from photo bytes (JPEG/PNG/HEIC — exifr
 * reads all three). `DateTimeOriginal` is read as the raw string (reviveValues:
 * false) and parsed into naive components so the server's timezone never leaks
 * in; GPS is read as clean decimals via exifr's gps helper.
 */
export async function parsePhotoMeta(bytes: Buffer): Promise<PhotoMeta> {
  let dt: unknown;
  let off: unknown;
  let alt: unknown;
  try {
    const tags = await exifr.parse(bytes, {
      reviveValues: false,
      pick: ["DateTimeOriginal", "OffsetTimeOriginal", "GPSAltitude"],
    });
    dt = tags?.DateTimeOriginal;
    off = tags?.OffsetTimeOriginal;
    alt = tags?.GPSAltitude;
  } catch {
    /* no/invalid EXIF — leave as null */
  }

  let lat: number | undefined;
  let lon: number | undefined;
  try {
    const gps = await exifr.gps(bytes);
    lat = gps?.latitude;
    lon = gps?.longitude;
  } catch {
    /* no GPS */
  }

  const hasGps =
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon);

  return {
    takenAtLocal: parseExifDateTime(dt),
    exifOffsetMinutes: parseExifOffset(off),
    gps: hasGps ? { lat: lat as number, lon: lon as number, altM: parseAltitude(alt) } : null,
  };
}

function parseAltitude(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const frac = v.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (frac) {
      const a = Number(frac[1]);
      const b = Number(frac[2]);
      if (b) return Math.round(a / b);
    }
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}
