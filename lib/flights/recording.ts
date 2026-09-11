import { readXcScore, type XcShape } from "@/lib/igc/xc-types";

export const XC_TYPE_LABELS = { open: "Open distance", "fai-triangle": "FAI triangle", "free-triangle": "Free triangle" } as const;
export interface RecordingFields {
  recordingKind?: string;
  reportedXcDistanceM?: number | null;
  reportedXcType?: string | null;
}
export const isLogbookEntry = (flight: RecordingFields) => flight.recordingKind === "logbook";

export function reportedXc(flight: RecordingFields) {
  const shape = flight.reportedXcType;
  return shape && Object.hasOwn(XC_TYPE_LABELS, shape) && flight.reportedXcDistanceM != null && Number.isFinite(flight.reportedXcDistanceM) && flight.reportedXcDistanceM > 0
    ? { shape: shape as XcShape, name: XC_TYPE_LABELS[shape as XcShape], distanceM: flight.reportedXcDistanceM, reported: true, approximate: false }
    : null;
}

/** Reported distances rank alongside recorded distances, without inventing route geometry or points. */
export function flightXcResults(flight: RecordingFields & { xcScore: unknown }) {
  const routes = (readXcScore(flight.xcScore)?.candidates ?? []).map(route => ({
    shape: route.shape, name: route.name, distanceM: route.distanceM, approximate: !route.optimal, reported: false,
  }));
  const reported = reportedXc(flight);
  if (reported) routes.push(reported);
  return routes.filter(route => Number.isFinite(route.distanceM) && route.distanceM > 0).sort((a, b) => b.distanceM - a.distanceM || Number(a.reported) - Number(b.reported));
}
