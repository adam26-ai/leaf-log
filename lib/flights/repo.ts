import { prisma } from "@/lib/prisma";
import { Prisma, type Flight } from "@prisma/client";
import {
  normalizeVisibility,
  type FlightVisibility,
} from "@/lib/flights/visibility";
import { kudoCountsFor } from "@/lib/social/kudos";

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

const FEED_SELECT = {
  ...LIST_SELECT,
  ownerId: true,
  owner: {
    select: {
      handle: true,
      displayName: true,
      avatarUpdatedAt: true,
    },
  },
} as const;

export type FeedFlightListItem = Prisma.FlightGetPayload<{
  select: typeof FEED_SELECT;
}> & { kudoCount: number };

export interface FeedPageResult {
  rows: FeedFlightListItem[];
  nextCursor: string | null;
}

interface FeedCursor {
  flightDate: Date | null;
  takeoffAt: Date | null;
  id: string;
}

function encodeFeedCursor(row: FeedFlightListItem): string {
  return Buffer.from(
    JSON.stringify({
      flightDate: row.flightDate?.toISOString() ?? null,
      takeoffAt: row.takeoffAt?.toISOString() ?? null,
      id: row.id,
    }),
  ).toString("base64url");
}

function decodeFeedCursor(cursor: string | null | undefined): FeedCursor | null {
  if (!cursor) return null;

  try {
    const raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      flightDate?: unknown;
      takeoffAt?: unknown;
      id?: unknown;
    };
    if (typeof raw.id !== "string" || raw.id.length === 0) return null;

    const flightDate =
      typeof raw.flightDate === "string" ? new Date(raw.flightDate) : null;
    const takeoffAt =
      typeof raw.takeoffAt === "string" ? new Date(raw.takeoffAt) : null;

    if (flightDate && Number.isNaN(flightDate.getTime())) return null;
    if (takeoffAt && Number.isNaN(takeoffAt.getTime())) return null;

    return { flightDate, takeoffAt, id: raw.id };
  } catch {
    return null;
  }
}

function nullableDateAfter(
  field: "flightDate" | "takeoffAt",
  value: Date | null,
): Prisma.FlightWhereInput | null {
  if (!value) return null;
  return {
    OR: [{ [field]: { lt: value } }, { [field]: null }],
  } as Prisma.FlightWhereInput;
}

function nullableDateEqual(
  field: "flightDate" | "takeoffAt",
  value: Date | null,
): Prisma.FlightWhereInput {
  return { [field]: value ? { equals: value } : null } as Prisma.FlightWhereInput;
}

function feedCursorWhere(cursor: FeedCursor | null): Prisma.FlightWhereInput {
  if (!cursor) return {};

  const flightDateAfter = nullableDateAfter("flightDate", cursor.flightDate);
  const takeoffAfter = nullableDateAfter("takeoffAt", cursor.takeoffAt);
  const flightDateEqual = nullableDateEqual("flightDate", cursor.flightDate);
  const takeoffEqual = nullableDateEqual("takeoffAt", cursor.takeoffAt);

  return {
    OR: [
      ...(flightDateAfter ? [flightDateAfter] : []),
      ...(takeoffAfter ? [{ AND: [flightDateEqual, takeoffAfter] }] : []),
      { AND: [flightDateEqual, takeoffEqual, { id: { lt: cursor.id } }] },
    ],
  };
}

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

/** Owner-scoped flight summaries for references stored outside the flight model. */
export function listOwnFlightsByIds(
  ownerId: string,
  flightIds: string[],
): Promise<FlightListItem[]> {
  if (flightIds.length === 0) return Promise.resolve([]);
  return prisma.flight.findMany({
    where: { id: { in: flightIds }, ownerId },
    select: LIST_SELECT,
  });
}

/** A pilot's public ready flights. */
export function listPublicFlights(ownerId: string): Promise<FlightListItem[]> {
  return listProfileFlightsForViewer(ownerId, null);
}

export async function listFeedForViewer(
  viewerId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<FeedPageResult> {
  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 20)), 50);
  const cursor = decodeFeedCursor(options.cursor);

  const friendships = await prisma.friendship.findMany({
    where: {
      status: "accepted",
      OR: [{ requesterId: viewerId }, { addresseeId: viewerId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  const friendIds = friendships.map((row) =>
    row.requesterId === viewerId ? row.addresseeId : row.requesterId,
  );

  if (friendIds.length === 0) return { rows: [], nextCursor: null };

  const page = await prisma.flight.findMany({
    where: {
      // Friendships are bounded by mutual acceptance, so an IN list is fine for
      // now; a raw-SQL join is a future optimization if this access path grows.
      ownerId: { in: friendIds, not: viewerId },
      status: "ready",
      visibility: { in: ["public", "friends"] },
      ...feedCursorWhere(cursor),
    },
    orderBy: [
      { flightDate: { sort: "desc", nulls: "last" } },
      { takeoffAt: { sort: "desc", nulls: "last" } },
      { id: "desc" },
    ],
    take: limit + 1,
    select: FEED_SELECT,
  });

  const visible = page.slice(0, limit);
  const counts = await kudoCountsFor(visible.map((flight) => flight.id));
  const rows = visible.map((flight) => ({
    ...flight,
    kudoCount: counts.get(flight.id) ?? 0,
  }));

  return {
    rows,
    nextCursor: page.length > limit ? encodeFeedCursor(rows[rows.length - 1]) : null,
  };
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
