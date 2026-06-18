/** A single parsed B-record fix. */
export interface Fix {
  /** Seconds since the flight's UTC epoch start (monotonic; midnight-rollover corrected). */
  t: number;
  /** Absolute UTC time (ms epoch). */
  timeMs: number;
  lat: number;
  lon: number;
  /** Barometric (pressure) altitude in metres, or null if absent/invalid. */
  baroAlt: number | null;
  /** GPS altitude in metres, or null if absent/invalid. */
  gpsAlt: number | null;
  /** IGC fix validity flag: 'A' = 3D valid, 'V' = 2D/invalid. */
  valid: boolean;
}

export interface IgcHeaders {
  /** Flight date (UTC midnight) from HFDTE, ms epoch, or null if missing. */
  dateMs: number | null;
  pilot: string | null;
  glider: string | null;
  /** A-record manufacturer/recorder id (e.g. Leaf vs. other logger). */
  recorder: string | null;
}

export interface ParsedIgc {
  headers: IgcHeaders;
  fixes: Fix[];
  /** Non-fatal issues encountered while parsing (surfaced to the pilot). */
  warnings: string[];
}

export interface DerivedMetrics {
  takeoffIndex: number;
  landingIndex: number;
  takeoffAtMs: number;
  landingAtMs: number;
  durationS: number;
  maxAltM: number;
  altGainM: number;
  maxClimbMs: number;
  maxSinkMs: number;
  trackDistM: number;
  straightDistM: number;
  altSource: "baro" | "gps";
  takeoff: { lat: number; lon: number };
  landing: { lat: number; lon: number };
  bounds: [number, number, number, number]; // [west, south, east, north]
  localTz: string | null;
  localUtcOffsetMinutes: number | null;
}
