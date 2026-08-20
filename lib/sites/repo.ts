import { prisma } from "@/lib/prisma";
import type { Prisma, Site, Zone } from "@prisma/client";
import { haversineM } from "@/lib/geo/distance";
import { bearingDeg } from "@/lib/igc/interpolate";
import {
  SUGGEST_RADIUS_M,
  radiusForKind,
  boundingBox,
  withinRadius,
  compareSiteCandidates,
  type MatchKind,
} from "./geo";
import { siteCachePatch, type SiteEndpoint, type SiteFieldPatch } from "./associate";
import { normalizeSiteVisibility, canSeeSite, type SiteVisibility } from "./visibility";
import { validateSiteName } from "./name";

/**
 * App-layer privacy enforcement for sites, mirroring lib/flights/repo.ts:
 * site read scoping lives exclusively here (`siteVisibleWhere` / callers of
 * it), fail-closed. A private site is visible only to its own owner; an
 * orphaned private site (`ownerId === null`) is visible to nobody.
 */

/** A Prisma WHERE fragment: public sites, plus the viewer's own private ones. */
export function siteVisibleWhere(viewerId: string | null): Prisma.SiteWhereInput {
  if (viewerId === null) return { visibility: "public" };
  return {
    OR: [{ visibility: "public" }, { visibility: "private", ownerId: viewerId }],
  };
}

/** A single site, only if the viewer may see it. */
export async function getSiteForViewer(
  siteId: string,
  viewerId: string | null,
): Promise<Site | null> {
  return prisma.site.findFirst({
    where: { id: siteId, ...siteVisibleWhere(viewerId) },
  });
}

/** Every site owned by `ownerId` — for the owner's own management views only. */
export function listOwnSites(ownerId: string): Promise<Site[]> {
  return prisma.site.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * SPRINT-005: a Prisma WHERE fragment for Zone — public zones, plus the
 * viewer's own private ones, AND (always) the parent site's own visibility.
 * The conjunction lives here, not just in `canSeeZone`, so every Zone query
 * in this module applies it uniformly rather than re-deriving it per call
 * site.
 */
export function zoneVisibleWhere(viewerId: string | null): Prisma.ZoneWhereInput {
  return {
    AND: [
      viewerId === null
        ? { visibility: "public" }
        : { OR: [{ visibility: "public" }, { visibility: "private", ownerId: viewerId }] },
      { site: siteVisibleWhere(viewerId) },
    ],
  };
}

/** A single zone, only if the viewer may see it (and its parent site). */
export async function getZoneForViewer(zoneId: string, viewerId: string | null): Promise<Zone | null> {
  return prisma.zone.findFirst({ where: { id: zoneId, ...zoneVisibleWhere(viewerId) } });
}

/** Every zone under a site that the viewer may see, oldest first. */
export function listZonesForSite(siteId: string, viewerId: string | null): Promise<Zone[]> {
  return prisma.zone.findMany({
    where: { siteId, ...zoneVisibleWhere(viewerId) },
    orderBy: { createdAt: "asc" },
  });
}

const SUGGESTION_LIMIT = 5;
export const DAILY_CREATE_CAP = 10;
export const REASSOCIATE_CAP = 200;

export interface SiteSuggestion {
  id: string;
  name: string;
  kind: string;
  visibility: SiteVisibility;
  distanceM: number;
  bearingDeg: number;
}

/**
 * Nearby VISIBLE sites for the "name this site" dialog's reuse-first step.
 * Deliberately kind-agnostic (only the automatic matcher in lib/sites/lookup.ts
 * filters by kind) — otherwise a pilot who named their LZ `kind:'landing'` and
 * later names the launch at the same spot would see nothing and create the
 * duplicate this dialog exists to prevent. Wider than the match radius on
 * purpose: this only runs after findSite already returned null there.
 */
export async function suggestNearbySites(
  lat: number,
  lon: number,
  viewerId: string | null,
  limit = SUGGESTION_LIMIT,
): Promise<SiteSuggestion[]> {
  const box = boundingBox(lat, lon, SUGGEST_RADIUS_M);
  const lonWhere: Prisma.SiteWhereInput =
    box.lonRanges.length === 1
      ? { lon: { gte: box.lonRanges[0].min, lte: box.lonRanges[0].max } }
      : { OR: box.lonRanges.map((r) => ({ lon: { gte: r.min, lte: r.max } })) };

  const candidates = await prisma.site.findMany({
    where: {
      AND: [
        { lat: { gte: box.latMin, lte: box.latMax } },
        lonWhere,
        siteVisibleWhere(viewerId),
      ],
    },
    select: { id: true, name: true, lat: true, lon: true, kind: true, visibility: true, license: true },
  });

  const ranked = withinRadius(candidates, lat, lon, SUGGEST_RADIUS_M).sort(compareSiteCandidates);

  return ranked.slice(0, limit).map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    visibility: normalizeSiteVisibility(s.visibility),
    distanceM: s.distanceM,
    bearingDeg: bearingDeg(lon, lat, s.lon, s.lat),
  }));
}

function endpointCoord(
  flight: { takeoffLat: number | null; takeoffLon: number | null; landingLat: number | null; landingLon: number | null },
  endpoint: SiteEndpoint,
): { lat: number; lon: number } | null {
  const lat = endpoint === "takeoff" ? flight.takeoffLat : flight.landingLat;
  const lon = endpoint === "takeoff" ? flight.takeoffLon : flight.landingLon;
  if (lat == null || lon == null) return null;
  return { lat, lon };
}

/**
 * Retroactively re-associates the CREATOR's own other ready flights that are
 * missing this endpoint's site and fall within the match radius — never
 * other pilots' history, and never at request time for anyone but the
 * creator. Bbox-prefiltered, owner-scoped, capped, and the cap is always
 * logged (never silently) when it truncates.
 */
export async function reassociateOwnFlights(
  ownerId: string,
  site: Pick<Site, "id" | "name" | "visibility" | "lat" | "lon">,
  endpoint: SiteEndpoint,
): Promise<{ updated: number; truncated: boolean }> {
  const matchKind: MatchKind = endpoint;
  const radius = radiusForKind(matchKind);
  const box = boundingBox(site.lat, site.lon, radius);

  const latField = endpoint === "takeoff" ? "takeoffLat" : "landingLat";
  const siteIdField = endpoint === "takeoff" ? "takeoffSiteId" : "landingSiteId";

  const lonRangeWhere = (range: { min: number; max: number }): Prisma.FlightWhereInput =>
    endpoint === "takeoff"
      ? { takeoffLon: { gte: range.min, lte: range.max } }
      : { landingLon: { gte: range.min, lte: range.max } };

  const where: Prisma.FlightWhereInput = {
    ownerId,
    status: "ready",
    [siteIdField]: null,
    [latField]: { gte: box.latMin, lte: box.latMax },
    ...(box.lonRanges.length === 1
      ? lonRangeWhere(box.lonRanges[0])
      : { OR: box.lonRanges.map(lonRangeWhere) }),
  };

  const candidates = await prisma.flight.findMany({
    where,
    select: { id: true, takeoffLat: true, takeoffLon: true, landingLat: true, landingLon: true },
  });

  const withinExact = candidates.filter((f) => {
    const coord = endpointCoord(f, endpoint);
    return coord !== null && haversineM(site.lat, site.lon, coord.lat, coord.lon) <= radius;
  });

  const truncated = withinExact.length > REASSOCIATE_CAP;
  const toUpdate = withinExact.slice(0, REASSOCIATE_CAP);
  if (toUpdate.length === 0) return { updated: 0, truncated: false };

  const patch = siteCachePatch(site, endpoint);
  await prisma.flight.updateMany({
    where: { id: { in: toUpdate.map((f) => f.id) } },
    data: patch,
  });

  if (truncated) {
    console.warn(
      `[sites] reassociateOwnFlights capped at ${REASSOCIATE_CAP} for site=${site.id} owner=${ownerId} endpoint=${endpoint}; ${withinExact.length - REASSOCIATE_CAP} flight(s) not re-associated this pass`,
    );
  }

  return { updated: toUpdate.length, truncated };
}

export interface CreateOrAttachInput {
  flightId: string;
  ownerId: string;
  endpoint: SiteEndpoint;
  mode: "reuse" | "create";
  existingSiteId?: string;
  name?: string;
  visibility?: SiteVisibility;
}

export interface CreateOrAttachResult {
  site: Site;
  created: boolean;
  reassociated: { updated: number; truncated: boolean };
}

function hiddenOrMissingSite() {
  // Deliberately the same message as "doesn't exist" — hidden and
  // nonexistent sites must be indistinguishable in responses.
  return new Error("Site not found.");
}

/**
 * The core of "name this site": reuse an existing visible site, or create a
 * new one, and bind it to the given flight endpoint. Owner-guarded by the
 * caller (a server action); this function trusts `ownerId` as already
 * authenticated and re-derives the coordinate from the flight row, never
 * from the client.
 */
export async function createOrAttachSiteFromFlight(
  input: CreateOrAttachInput,
): Promise<CreateOrAttachResult> {
  const { flightId, ownerId, endpoint, mode } = input;

  const flight = await prisma.flight.findFirst({ where: { id: flightId, ownerId } });
  if (!flight) throw new Error("Flight not found or not owned by caller.");
  const coord = endpointCoord(flight, endpoint);
  if (!coord) throw new Error(`Flight has no ${endpoint} coordinate.`);
  const { lat, lon } = coord;

  const { site, created } = await prisma.$transaction(async (tx) => {
    if (mode === "reuse") {
      if (!input.existingSiteId) throw new Error("existingSiteId is required to reuse a site.");
      const existing = await tx.site.findUnique({ where: { id: input.existingSiteId } });
      if (!existing) throw hiddenOrMissingSite();
      const visibility = normalizeSiteVisibility(existing.visibility);
      if (!canSeeSite(visibility, existing.ownerId, ownerId)) throw hiddenOrMissingSite();

      // Widen kind to "both" on opposite-endpoint reuse; never narrow.
      const site =
        existing.kind === "both" || existing.kind === endpoint
          ? existing
          : await tx.site.update({ where: { id: existing.id }, data: { kind: "both" } });
      return { site, created: false };
    }

    // mode === "create"
    if (!input.name) throw new Error("A name is required to create a site.");
    const validated = validateSiteName(input.name);
    if (!validated.ok) throw new Error(`Invalid site name (${validated.error}).`);
    const visibility = normalizeSiteVisibility(input.visibility ?? "public");

    const startOfDayUtc = new Date();
    startOfDayUtc.setUTCHours(0, 0, 0, 0);
    const createdToday = await tx.site.count({
      where: { ownerId, createdAt: { gte: startOfDayUtc } },
    });
    if (createdToday >= DAILY_CREATE_CAP) {
      throw new Error("Daily site creation limit reached. Try again tomorrow.");
    }

    // Re-run the visible-candidate probe INSIDE the transaction — guards two
    // pilots creating the same site concurrently, and rejects a
    // proximity-scoped normalizedName conflict against a VISIBLE site with a
    // steer to reuse instead.
    const box = boundingBox(lat, lon, SUGGEST_RADIUS_M);
    const lonWhere: Prisma.SiteWhereInput =
      box.lonRanges.length === 1
        ? { lon: { gte: box.lonRanges[0].min, lte: box.lonRanges[0].max } }
        : { OR: box.lonRanges.map((r) => ({ lon: { gte: r.min, lte: r.max } })) };
    const nearbyRows = await tx.site.findMany({
      where: { AND: [{ lat: { gte: box.latMin, lte: box.latMax } }, lonWhere, siteVisibleWhere(ownerId)] },
      select: { id: true, name: true, normalizedName: true, lat: true, lon: true },
    });
    const nearby = withinRadius(nearbyRows, lat, lon, SUGGEST_RADIUS_M);
    const conflict = nearby.find((s) => s.normalizedName === validated.normalizedName);
    if (conflict) {
      throw new Error(`"${conflict.name}" already exists nearby — reuse it instead of creating a duplicate.`);
    }

    // Rounded to ~11 m: not launch-coordinate obfuscation (the flight's own
    // lat/lon stay full-precision and travel with the track) — this just
    // keeps the public site row from being a byte-exact fingerprint of one
    // private flight's takeoff fix.
    const roundedLat = Math.round(lat * 10_000) / 10_000;
    const roundedLon = Math.round(lon * 10_000) / 10_000;

    const site = await tx.site.create({
      data: {
        name: validated.name,
        normalizedName: validated.normalizedName,
        kind: endpoint,
        lat: roundedLat,
        lon: roundedLon,
        source: "user",
        ownerId,
        visibility,
      },
    });
    return { site, created: true };
  });

  // Link the CURRENT flight; the cache is written only through siteCachePatch.
  await prisma.flight.update({
    where: { id: flightId },
    data: siteCachePatch(site, endpoint) as SiteFieldPatch,
  });

  // Retroactively fill in the creator's own other unmatched flights.
  const reassociated = await reassociateOwnFlights(ownerId, site, endpoint);

  console.log(
    `[sites] ${created ? "create" : "bind"} site=${site.id} owner=${ownerId} endpoint=${endpoint} visibility=${site.visibility} reassociated=${reassociated.updated}${reassociated.truncated ? "(capped)" : ""}`,
  );

  return { site, created, reassociated };
}
