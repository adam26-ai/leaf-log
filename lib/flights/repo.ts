import { prisma } from "@/lib/prisma";
import type { Flight } from "@prisma/client";
import {
  normalizeVisibility,
  type FlightVisibility,
} from "@/lib/flights/visibility";

/**
 * App-layer privacy enforcement (this app has no DB RLS). EVERY flight read goes
 * through here with an explicit viewer id, and the visibility predicate is always
 * applied. Friends-only visibility resolves here, not in pages/routes/actions.
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

/** Accepted friendship in either direction. The only read-authz friend resolver. */
export async function areFriends(aId: string, bId: string): Promise<boolean> {
  if (aId === bId) return false;
  const count = await prisma.friendship.count({
    where: {
      status: "accepted",
      OR: [
        { requesterId: aId, addresseeId: bId },
        { requesterId: bId, addresseeId: aId },
      ],
    },
  });
  return count > 0;
}

/** A single flight, only if the viewer may see it. Owner sees every status. */
export async function getFlightForViewer(
  flightId: string,
  viewerId: string | null,
): Promise<Flight | null> {
  const flight = await prisma.flight.findUnique({ where: { id: flightId } });
  if (!flight) return null;
  if (viewerId && flight.ownerId === viewerId) return flight;

  const visibility = normalizeVisibility(flight.visibility);
  if (visibility === "public") return flight;
  if (
    visibility === "friends" &&
    viewerId &&
    (await areFriends(viewerId, flight.ownerId))
  ) {
    return flight;
  }

  return null;
}

export async function visibleVisibilitiesFor(
  ownerId: string,
  viewerId: string | null,
): Promise<FlightVisibility[]> {
  if (viewerId && viewerId === ownerId) return ["public", "friends", "private"];

  const allowed: FlightVisibility[] = ["public"];
  if (viewerId && (await areFriends(viewerId, ownerId))) {
    allowed.push("friends");
  }
  return allowed;
}

export async function listProfileFlightsForViewer(
  ownerId: string,
  viewerId: string | null,
): Promise<FlightListItem[]> {
  const visibility = await visibleVisibilitiesFor(ownerId, viewerId);
  return prisma.flight.findMany({
    where: { ownerId, status: "ready", visibility: { in: visibility } },
    orderBy: [{ flightDate: "desc" }, { takeoffAt: "desc" }, { id: "desc" }],
    select: LIST_SELECT,
  });
}

/** The owner's own logbook — all of their flights. */
export function listOwnFlights(ownerId: string): Promise<FlightListItem[]> {
  return prisma.flight.findMany({
    where: { ownerId },
    orderBy: [{ flightDate: "desc" }, { takeoffAt: "desc" }],
    select: LIST_SELECT,
  });
}

/** A pilot's public ready flights. */
export function listPublicFlights(ownerId: string): Promise<FlightListItem[]> {
  return listProfileFlightsForViewer(ownerId, null);
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
