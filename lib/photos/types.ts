/** Naive local date/time components from EXIF `DateTimeOriginal` (no timezone). */
export interface LocalDateTime {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}

/** Normalized metadata extracted from a photo's EXIF. */
export interface PhotoMeta {
  takenAtLocal: LocalDateTime | null;
  /** From EXIF `OffsetTimeOriginal` if present (minutes); diagnostic in v1. */
  exifOffsetMinutes: number | null;
  gps: { lat: number; lon: number; altM: number | null } | null;
}

export type PlacementSource = "exif_gps" | "interpolated_time" | "unpinned";

export type PlacementFailure =
  | "no_time"
  | "out_of_window"
  | "missing_flight_offset"
  | "bad_gps"
  | "no_track";

/** Result of placing a photo on a flight. */
export interface Placement {
  lat: number | null;
  lon: number | null;
  altM: number | null;
  /** Seconds from takeoff (links the pin to the replay timeline). */
  tSec: number | null;
  /** UTC instant of capture (ms), when a usable time exists. */
  takenAtMs: number | null;
  source: PlacementSource;
  failureReason: PlacementFailure | null;
}

/** The minimal flight context needed to place a photo (keeps placement pure). */
export interface FlightPlacementContext {
  /** Absolute UTC ms of takeoff (sample tOffset 0). */
  takeoffMs: number;
  durationS: number;
  /** [west, south, east, north]. */
  bounds: [number, number, number, number];
  localUtcOffsetMinutes: number | null;
}
