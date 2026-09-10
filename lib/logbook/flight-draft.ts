import type { Flight } from "@prisma/client";
import { emptyEntry } from "./entry";

export function flightToEntryDraft(flight: Flight) {
  const s = (value: number | null) => value == null ? "" : String(value);
  const local = flight.takeoffAt ? new Date(flight.takeoffAt.getTime() + (flight.localUtcOffsetMinutes ?? 0) * 60000).toISOString() : null;
  return { ...emptyEntry(), date: local?.slice(0, 10) ?? flight.flightDate?.toISOString().slice(0, 10) ?? "",
    durationMinutes: flight.durationS == null ? "" : String(flight.durationS / 60), glider: flight.glider ?? "",
    takeoffSiteId: flight.takeoffSiteId ?? "", takeoffSiteName: flight.takeoffSiteName ?? "", landingSiteId: flight.landingSiteId ?? "", landingSiteName: flight.landingSiteName ?? "",
    takeoffTime: local?.slice(11, 19) ?? "", timeZone: local ? `${(flight.localUtcOffsetMinutes ?? 0) < 0 ? "-" : "+"}${String(Math.floor(Math.abs(flight.localUtcOffsetMinutes ?? 0) / 60)).padStart(2, "0")}:${String(Math.abs(flight.localUtcOffsetMinutes ?? 0) % 60).padStart(2, "0")}` : flight.localTz ?? "",
    maxAltitude: s(flight.maxAltM), launchAltitude: s(flight.launchAltM), heightGained: s(flight.altGainM), maxClimb: s(flight.maxClimbMs), maxSink: s(flight.maxSinkMs),
    xcDistance: flight.reportedXcDistanceM == null ? "" : String(flight.reportedXcDistanceM / 1000), xcType: flight.reportedXcType ?? "",
    takeoffLat: s(flight.takeoffLat), takeoffLon: s(flight.takeoffLon), landingLat: s(flight.landingLat), landingLon: s(flight.landingLon),
    notes: flight.notes ?? "", occupancy: flight.occupancy ?? "",
  };
}
