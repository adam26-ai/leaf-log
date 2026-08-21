import { prisma } from "@/lib/prisma";
import { Prisma, type Flight } from "@prisma/client";
import {
  normalizeVisibility,
  type FlightVisibility,
} from "@/lib/flights/visibility";
import { canSeeSite, canSeeZone, normalizeSiteVisibility } from "@/lib/sites/visibility";
import { kudoCountsFor } from "@/lib/social/kudos";

/**
 * App-layer privacy enforcement (this app has no DB RLS). EVERY flight read goes
 * through here with an explicit viewer id, and the visibility predicate is always
 * applied. Friends-only visibility resolves here, not in pages/routes/actions.
 *
 * Site AND zone names get the same treatment (SPRINT-004, extended by SPRINT-005):
 * Flight.{takeoff,landing}{Site,Zone}Name are public-name CACHES, not the source
 * of truth. Every row returned from here has had resolveLocationFields()
 * re-verify each non-null site id AND zone id against the live rows for THIS
 * viewer — the live row wins when visible, and both id and name are stripped
 * when it isn't. A readable zone with an unreadable parent is impossible by
 * construction: stripping the site always strips its zone too (the conjunction,
 * applied as a single early return). Never return a raw Prisma Flight/site/zone
 * read to a caller without going through this.
 */

const LIST_SELECT = {
  id: true,
  flightDate: true,
  takeoffAt: true,
  takeoffSiteName: true,
  takeoffSiteId: true,
  takeoffZoneName: true,
  takeoffZoneId: true,
  landingSiteName: true,
  landingSiteId: true,
  landingZoneName: true,
  landingZoneId: true,
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

interface LocationFieldRow {
  takeoffSiteId: string | null;
  takeoffSiteName: string | null;
  takeoffZoneId: string | null;
  takeoffZoneName: string | null;
  landingSiteId: string | null;
  landingSiteName: string | null;
  landingZoneId: string | null;
  landingZoneName: string | null;
}

interface VisibleSiteRow {
  id: string;
  name: string;
  visibility: string;
  ownerId: string | null;
}

interface VisibleZoneRow {
  id: string;
  name: string;
  visibility: string;
  ownerId: string | null;
  siteId: string;
}

interface ResolvedEndpoint {
  siteId: string | null;
  siteName: string | null;
  zoneId: string | null;
  zoneName: string | null;
}

const STRIPPED_ENDPOINT: ResolvedEndpoint = { siteId: null, siteName: null, zoneId: null, zoneName: null };

/**
 * Resolves one endpoint (takeoff or landing) against the live Site/Zone rows
 * for `viewerId`. Stripping the parent always strips the child — there is no
 * code path in which a zone name survives a hidden site, because the
 * conjunction is a single early return here, not a condition repeated per
 * caller. The cached `*ZoneName` is NEVER read as a historical fallback —
 * unlike a deleted SITE (whose cached name survives so old flights don't
 * lose all context), a deleted ZONE's cached name is explicitly nulled by
 * `lib/sites/associate.ts`'s deleteZone at delete time, so there is nothing
 * to fall back to.
 */
function resolveEndpoint(
  siteId: string | null,
  cachedSiteName: string | null,
  zoneId: string | null,
  sites: Map<string, VisibleSiteRow>,
  zones: Map<string, VisibleZoneRow>,
  viewerId: string | null,
): ResolvedEndpoint {
  if (siteId === null) {
    // Historical fallback for a deleted SITE — cache-only, and deliberately
    // site-name-only (see the doc comment above for why the zone name never
    // takes this path).
    return { siteId: null, siteName: cachedSiteName, zoneId: null, zoneName: null };
  }

  const site = sites.get(siteId);
  if (!site || !canSeeSite(normalizeSiteVisibility(site.visibility), site.ownerId, viewerId)) {
    return STRIPPED_ENDPOINT; // not visible (or deleted concurrently): nothing leaves, zone included
  }

  const resolvedSite: ResolvedEndpoint = { siteId, siteName: site.name, zoneId: null, zoneName: null };
  if (zoneId === null) return resolvedSite;

  const zone = zones.get(zoneId);
  const zoneVisible =
    zone !== undefined &&
    canSeeZone(
      { visibility: normalizeSiteVisibility(zone.visibility), ownerId: zone.ownerId, siteId: zone.siteId },
      { id: site.id, visibility: normalizeSiteVisibility(site.visibility), ownerId: site.ownerId },
      viewerId,
    );
  if (!zoneVisible) return resolvedSite; // site alone survives; the zone doesn't

  return { ...resolvedSite, zoneId, zoneName: zone!.name };
}

/**
 * The read-path firewall for site AND zone names. Re-verifies EVERY non-null
 * site id and zone id on the page against the live rows — not just rows
 * whose cached name is null — so a stale or hand-written row can never leak
 * a private site's or zone's identity through the denormalized cache
 * columns. Returns viewer-safe DTOs; the four id/name pairs may be nulled
 * relative to the DB row.
 */
async function resolveLocationFields<T extends LocationFieldRow>(
  rows: T[],
  viewerId: string | null,
): Promise<T[]> {
  const zoneIds = new Set<string>();
  const siteIds = new Set<string>();
  for (const row of rows) {
    if (row.takeoffSiteId) siteIds.add(row.takeoffSiteId);
    if (row.landingSiteId) siteIds.add(row.landingSiteId);
    if (row.takeoffZoneId) zoneIds.add(row.takeoffZoneId);
    if (row.landingZoneId) zoneIds.add(row.landingZoneId);
  }
  if (siteIds.size === 0 && zoneIds.size === 0) return rows;

  const zoneRows =
    zoneIds.size === 0
      ? []
      : await prisma.zone.findMany({
          where: { id: { in: Array.from(zoneIds) } },
          select: { id: true, name: true, visibility: true, ownerId: true, siteId: true },
        });
  // A zone id can appear on a row whose site id was already stripped
  // upstream in a bad row — union the zones' own parent ids into the site
  // fetch so canSeeZone's parent gate always has a live row to compare
  // against, even when the flight's cached siteId disagrees with it.
  for (const z of zoneRows) siteIds.add(z.siteId);

  const siteRows =
    siteIds.size === 0
      ? []
      : await prisma.site.findMany({
          where: { id: { in: Array.from(siteIds) } },
          select: { id: true, name: true, visibility: true, ownerId: true },
        });

  const sites = new Map(siteRows.map((s) => [s.id, s]));
  const zones = new Map(zoneRows.map((z) => [z.id, z]));

  return rows.map((row) => {
    const takeoff = resolveEndpoint(
      row.takeoffSiteId,
      row.takeoffSiteName,
      row.takeoffZoneId,
      sites,
      zones,
      viewerId,
    );
    const landing = resolveEndpoint(
      row.landingSiteId,
      row.landingSiteName,
      row.landingZoneId,
      sites,
      zones,
      viewerId,
    );
    return {
      ...row,
      takeoffSiteId: takeoff.siteId,
      takeoffSiteName: takeoff.siteName,
      takeoffZoneId: takeoff.zoneId,
      takeoffZoneName: takeoff.zoneName,
      landingSiteId: landing.siteId,
      landingSiteName: landing.siteName,
      landingZoneId: landing.zoneId,
      landingZoneName: landing.zoneName,
    };
  });
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

  const isOwner = viewerId !== null && flight.ownerId === viewerId;
  const visibility = normalizeVisibility(flight.visibility);
  const isPublic = visibility === "public";
  const isFriendVisible =
    !isOwner &&
    visibility === "friends" &&
    viewerId !== null &&
    (await areFriends(viewerId, flight.ownerId));

  if (!isOwner && !isPublic && !isFriendVisible) return null;

  const [resolved] = await resolveLocationFields([flight], viewerId);
  return resolved;
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
  const rows = await prisma.flight.findMany({
    where: { ownerId, status: "ready", visibility: { in: visibility } },
    orderBy: [{ flightDate: "desc" }, { takeoffAt: "desc" }, { id: "desc" }],
    select: LIST_SELECT,
  });
  return resolveLocationFields(rows, viewerId);
}

/** The owner's own logbook — all of their flights. */
export async function listOwnFlights(ownerId: string): Promise<FlightListItem[]> {
  const rows = await prisma.flight.findMany({
    where: { ownerId },
    orderBy: [{ flightDate: "desc" }, { takeoffAt: "desc" }],
    select: LIST_SELECT,
  });
  return resolveLocationFields(rows, ownerId);
}

/**
 * Owner-scoped flight summaries for references stored outside the flight
 * model (e.g. a device token's "last flight"). Routed through the same
 * resolver as every other list — SPRINT-004 left this one returning raw
 * `LIST_SELECT` rows directly; owner-scoped made it harmless in practice
 * (an owner can always see their own flights' current site), but SPRINT-005
 * widens `LIST_SELECT` to carry zone data too, and "every display read is
 * resolved" should have no unstated exceptions.
 */
export async function listOwnFlightsByIds(
  ownerId: string,
  flightIds: string[],
): Promise<FlightListItem[]> {
  if (flightIds.length === 0) return [];
  const rows = await prisma.flight.findMany({
    where: { id: { in: flightIds }, ownerId },
    select: LIST_SELECT,
  });
  return resolveLocationFields(rows, ownerId);
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

  const visible = await resolveLocationFields(page.slice(0, limit), viewerId);
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
