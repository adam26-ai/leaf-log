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
  /** Fix accuracy in metres from an optional FXA B-record extension. */
  fixAccuracyM: number | null;
  /** Ground speed in km/h from an optional GSP B-record extension. */
  groundSpeedKmh: number | null;
  /** GPS true track/course over ground in degrees from an optional TRT extension. */
  trueTrackDeg: number | null;
  /** Wind direction in degrees from an optional WDI B-record extension. */
  windDirectionDeg: number | null;
  /** Wind speed in km/h from an optional WSP B-record extension. */
  windSpeedKmh: number | null;
  /** Recorded vertical speed in m/s from an optional VAR B-record extension. */
  varioMs: number | null;
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
