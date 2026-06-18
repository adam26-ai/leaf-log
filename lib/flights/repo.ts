import { prisma } from "@/lib/prisma";
import type { Flight } from "@prisma/client";

/**
 * App-layer privacy enforcement (this app has no DB RLS). EVERY flight read goes
 * through here with an explicit viewer id, and the visibility predicate is always
 * applied. A private flight is only ever returned to its owner.
 */

const LIST_SELECT = {
  id: true,
  flightDate: true,
  takeoffAt: true,
  takeoffSiteName: true,
  takeoffSiteId: true,
  durationS: true,
  maxAltM: true,
  visibility: true,
  status: true,
  localUtcOffsetMinutes: true,
} as const;

export type FlightListItem = Pick<Flight, keyof typeof LIST_SELECT>;

/** A single flight, only if the viewer may see it (owner or public). */
export async function getFlightForViewer(
  flightId: string,
  viewerId: string | null,
): Promise<Flight | null> {
  const flight = await prisma.flight.findUnique({ where: { id: flightId } });
  if (!flight) return null;
  if (flight.visibility === "public") return flight;
  if (viewerId && flight.ownerId === viewerId) return flight;
  return null;
}

/** The owner's own logbook — all of their flights. */
export function listOwnFlights(ownerId: string): Promise<FlightListItem[]> {
  return prisma.flight.findMany({
    where: { ownerId },
    orderBy: [{ flightDate: "desc" }, { takeoffAt: "desc" }],
    select: LIST_SELECT,
  });
}

/** A pilot's PUBLIC, ready flights — for their public profile. */
export function listPublicFlights(ownerId: string): Promise<FlightListItem[]> {
  return prisma.flight.findMany({
    where: { ownerId, visibility: "public", status: "ready" },
    orderBy: [{ flightDate: "desc" }, { takeoffAt: "desc" }],
    select: LIST_SELECT,
  });
}

export interface FlightStats {
  totalSeconds: number;
  flightCount: number;
  siteCount: number;
}

export function statsFrom(flights: FlightListItem[]): FlightStats {
  const ready = flights.filter((f) => f.status === "ready");
  return {
    totalSeconds: ready.reduce((s, f) => s + (f.durationS ?? 0), 0),
    flightCount: ready.length,
    siteCount: new Set(ready.map((f) => f.takeoffSiteId).filter(Boolean)).size,
  };
}
