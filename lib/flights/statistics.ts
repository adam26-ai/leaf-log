import type { Flight } from "@prisma/client";

/** Only the measurements and calculation state displayed in the replay strip. */
export type FlightStatistics = Pick<Flight, "id" | "glider" | "durationS" | "maxAltM" | "altGainM"
  | "maxClimbMs" | "maxSinkMs" | "status" | "xcStatus" | "xcError" | "xcScore" | "metricsVersion">
  & Partial<Pick<Flight, "recordingKind" | "reportedXcDistanceM" | "reportedXcType">>;

export function flightStatistics(flight: FlightStatistics): FlightStatistics {
  const { id, glider, durationS, maxAltM, altGainM, maxClimbMs, maxSinkMs,
    status, xcStatus, xcError, xcScore, metricsVersion, recordingKind, reportedXcDistanceM, reportedXcType } = flight;
  return { id, glider, durationS, maxAltM, altGainM, maxClimbMs, maxSinkMs,
    status, xcStatus, xcError, xcScore, metricsVersion, recordingKind, reportedXcDistanceM, reportedXcType };
}
