import { prisma } from "@/lib/prisma";
import { Prisma, type Site, type Zone } from "@prisma/client";
import { haversineM } from "@/lib/geo/distance";
import { bearingDeg } from "@/lib/igc/interpolate";
import {
  SUGGEST_RADIUS_M,
  radiusForKind,
  zoneRadiusForKind,
  boundingBox,
  compareSiteCandidates,
  boundaryPrefilterWhere,
  boundaryBoundingBox,
  locationMatches,
  isValidBoundaryShape,
  type MatchKind,
} from "./geo";
import { locationCachePatch, type SiteEndpoint, type LocationFieldPatch } from "./associate";
import { normalizeSiteVisibility, canSeeSite, canSeeZone, type SiteVisibility } from "./visibility";
import { validateSiteName } from "./name";
import { writeAuditEntry } from "./audit";

/**
 * App-layer privacy enforcement for sites AND zones, mirroring
 * lib/flights/repo.ts: read scoping lives exclusively here (`siteVisibleWhere`
 * / `zoneVisibleWhere` / callers of them), fail-closed. A private row is
 * visible only to its own owner; an orphaned private row (`ownerId === null`)
 * is visible to nobody.
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
/** Sites AND zones created by one owner in a day, combined — two levels
 * shouldn't double the blast radius of an abuse burst. */
export const DAILY_CREATE_CAP = 10;
export const REASSOCIATE_CAP = 200;

export interface SiteSuggestion {
  id: string;
  name: string;
  kind: string;
  visibility: SiteVisibility;
  distanceM: number;
  bearingDeg: number;
  zones: ZoneSuggestion[];
}

export interface ZoneSuggestion {
  id: string;
  name: string;
  kind: string;
  visibility: SiteVisibility;
  distanceM: number;
  bearingDeg: number;
}

function lonWhereFor(box: ReturnType<typeof boundingBox>) {
  return box.lonRanges.length === 1
    ? { lon: { gte: box.lonRanges[0].min, lte: box.lonRanges[0].max } }
    : { OR: box.lonRanges.map((r) => ({ lon: { gte: r.min, lte: r.max } })) };
}

/**
 * Nearby VISIBLE sites, each with their nested visible zones, for the "name
 * this site" dialog's reuse-first step. Deliberately kind-agnostic (only the
 * automatic matcher in lib/sites/lookup.ts filters by kind) — otherwise a
 * pilot who named their LZ `kind:'landing'` and later names the launch at
 * the same spot would see nothing and create the duplicate this dialog
 * exists to prevent. Wider than either match radius on purpose: this only
 * runs after findLocation already returned null there.
 *
 * A visible zone whose OWN parent site sits outside the search box still
 * surfaces that site — the union is by zone, not by site radius — so a
 * large site's nearest-known-spot can be found even when its own anchor
 * coordinate is far away. A site's own `distanceM` is `min(its own
 * distance, nearest visible zone's distance)`, so it ranks by whichever is
 * more relevant to the pilot doing the naming.
 */
export async function suggestNearbyLocations(
  lat: number,
  lon: number,
  viewerId: string | null,
  limit = SUGGESTION_LIMIT,
): Promise<SiteSuggestion[]> {
  const box = boundingBox(lat, lon, SUGGEST_RADIUS_M);
  const lonWhere = lonWhereFor(box);
  // SPRINT-006: a site/zone whose ANCHOR sits outside this bbox can still be
  // the right suggestion when its drawn BOUNDARY contains the point — the
  // boundary branch tests the row's own bbox columns directly, independent
  // of the query-point-centred box above. Without this, the reuse-first
  // dialog and the matcher (lib/sites/lookup.ts) would disagree about what's
  // nearby, and a pilot could create a duplicate of a site the boundary
  // feature was specifically drawn to reach.
  const locationOr = [
    { AND: [{ lat: { gte: box.latMin, lte: box.latMax } }, lonWhere] },
    boundaryPrefilterWhere(lat, lon),
  ];

  const [siteRows, zoneRows] = await Promise.all([
    prisma.site.findMany({
      where: { AND: [{ OR: locationOr }, siteVisibleWhere(viewerId)] },
      select: { id: true, name: true, lat: true, lon: true, kind: true, visibility: true, license: true },
    }),
    prisma.zone.findMany({
      where: { AND: [{ OR: locationOr }, zoneVisibleWhere(viewerId)] },
      select: {
        id: true,
        name: true,
        lat: true,
        lon: true,
        kind: true,
        visibility: true,
        siteId: true,
        boundary: true,
        site: { select: { id: true, name: true, lat: true, lon: true, kind: true, visibility: true, license: true } },
      },
    }),
  ]);

  const zoneRanked = zoneRows
    .flatMap((z) => {
      if (z.boundary != null && !isValidBoundaryShape(z.boundary)) {
        console.warn(`[sites] malformed stored boundary on Zone id=${z.id}; skipped from suggestions`);
        return [];
      }
      const { matched, distanceM } = locationMatches(z, lat, lon, SUGGEST_RADIUS_M);
      return matched ? [{ ...z, distanceM }] : [];
    })
    .sort(compareSiteCandidates);

  const siteById = new Map(siteRows.map((s) => [s.id, s]));
  for (const z of zoneRanked) {
    if (!siteById.has(z.site.id)) siteById.set(z.site.id, z.site);
  }

  const zonesBySite = new Map<string, ZoneSuggestion[]>();
  for (const z of zoneRanked) {
    const list = zonesBySite.get(z.siteId) ?? [];
    list.push({
      id: z.id,
      name: z.name,
      kind: z.kind,
      visibility: normalizeSiteVisibility(z.visibility),
      distanceM: z.distanceM,
      bearingDeg: bearingDeg(lon, lat, z.lon, z.lat),
    });
    zonesBySite.set(z.siteId, list);
  }

  const merged: SiteSuggestion[] = [];
  for (const site of siteById.values()) {
    const zones = zonesBySite.get(site.id) ?? [];
    const ownDistanceM = haversineM(lat, lon, site.lat, site.lon);
    const nearestZoneDistanceM = zones.length > 0 ? Math.min(...zones.map((z) => z.distanceM)) : Infinity;
    merged.push({
      id: site.id,
      name: site.name,
      kind: site.kind,
      visibility: normalizeSiteVisibility(site.visibility),
      distanceM: Math.min(ownDistanceM, nearestZoneDistanceM),
      bearingDeg: bearingDeg(lon, lat, site.lon, site.lat),
      zones: zones.sort((a, b) => a.distanceM - b.distanceM),
    });
  }

  return merged.sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
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
 * Retroactively re-associates the CREATOR's own other ready flights within
 * the match radius — never other pilots' history, and never at request time
 * for anyone but the creator. Bbox-prefiltered, owner-scoped, capped, and
 * the cap is always logged (never silently) when it truncates.
 *
 * Two modes, selected by whether `zone` is passed:
 * - Creating/reusing-into a SITE only: candidates are the creator's own
 *   ready flights with a null site id for this endpoint, within the SITE
 *   radius — unchanged from SPRINT-004.
 * - Creating/reusing-into a ZONE: candidates are the creator's own ready
 *   flights within the ZONE radius that either have a null site id, OR are
 *   ALREADY bound to this same site with a null zone id. That second clause
 *   is load-bearing — it's what upgrades a pilot's own already-site-bound
 *   back-catalog (e.g. months of "Mission Ridge" flights) to the new zone,
 *   not only the ones that were previously unmatched. Without it, naming a
 *   zone at an already-flown site would split the pilot's own logbook
 *   between the old flat name and the new precise one forever.
 */
export async function reassociateOwnFlights(
  ownerId: string,
  site: Pick<Site, "id" | "name" | "visibility" | "lat" | "lon" | "boundary">,
  endpoint: SiteEndpoint,
  zone?: Pick<Zone, "id" | "name" | "visibility" | "siteId" | "lat" | "lon" | "boundary"> | null,
): Promise<{ updated: number; truncated: boolean }> {
  const matchKind: MatchKind = endpoint;
  const anchor = zone ?? site;
  const radius = zone ? zoneRadiusForKind(matchKind) : radiusForKind(matchKind);
  // SPRINT-006: scan by the boundary's own bbox (not the radius box) when
  // the anchor row has one — a widened boundary can reach flights well past
  // the old radius, and this is what lets "trace the ridge" pick up the
  // pilot's own already-flown endpoints from both ends. Malformed stored
  // geometry falls back to the radius box (a scan-scope decision, not a
  // match decision — locationMatches below is still the actual authority
  // and fails closed on the same malformed value).
  const boundaryBox =
    anchor.boundary != null && isValidBoundaryShape(anchor.boundary) ? boundaryBoundingBox(anchor.boundary) : null;
  const box = boundaryBox
    ? { latMin: boundaryBox.minLat, latMax: boundaryBox.maxLat, lonRanges: [{ min: boundaryBox.minLon, max: boundaryBox.maxLon }] }
    : boundingBox(anchor.lat, anchor.lon, radius);

  const latField = endpoint === "takeoff" ? "takeoffLat" : "landingLat";
  const siteIdField = endpoint === "takeoff" ? "takeoffSiteId" : "landingSiteId";
  const zoneIdField = endpoint === "takeoff" ? "takeoffZoneId" : "landingZoneId";

  const lonRangeWhere = (range: { min: number; max: number }): Prisma.FlightWhereInput =>
    endpoint === "takeoff"
      ? { takeoffLon: { gte: range.min, lte: range.max } }
      : { landingLon: { gte: range.min, lte: range.max } };

  const where: Prisma.FlightWhereInput = {
    ownerId,
    status: "ready",
    ...(zone
      ? { OR: [{ [siteIdField]: null }, { [siteIdField]: zone.siteId, [zoneIdField]: null }] }
      : { [siteIdField]: null }),
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
    if (coord === null) return false;
    return locationMatches(anchor, coord.lat, coord.lon, radius).matched;
  });

  const truncated = withinExact.length > REASSOCIATE_CAP;
  const toUpdate = withinExact.slice(0, REASSOCIATE_CAP);
  if (toUpdate.length === 0) return { updated: 0, truncated: false };

  const patch = locationCachePatch(site, zone ?? null, endpoint);
  await prisma.flight.updateMany({
    where: { id: { in: toUpdate.map((f) => f.id) } },
    data: patch,
  });

  if (truncated) {
    console.warn(
      `[sites] reassociateOwnFlights capped at ${REASSOCIATE_CAP} for site=${site.id}${zone ? ` zone=${zone.id}` : ""} owner=${ownerId} endpoint=${endpoint}; ${withinExact.length - REASSOCIATE_CAP} flight(s) not re-associated this pass`,
    );
  }

  return { updated: toUpdate.length, truncated };
}

export type SiteChoice =
  | { mode: "reuse"; id: string }
  | { mode: "create"; name: string; visibility: SiteVisibility };

export type ZoneChoice =
  | { mode: "reuse"; id: string }
  | { mode: "create"; name: string; visibility: SiteVisibility };

export interface CreateOrAttachInput {
  flightId: string;
  ownerId: string;
  endpoint: SiteEndpoint;
  site: SiteChoice;
  /** OMITTED = bind the bare site only (today's SPRINT-004 behaviour). */
  zone?: ZoneChoice;
}

export interface CreateOrAttachResult {
  site: Site;
  zone: Zone | null;
  createdSite: boolean;
  createdZone: boolean;
  reassociated: { updated: number; truncated: boolean };
}

function hiddenOrMissingSite() {
  // Deliberately the same message as "doesn't exist" — hidden and
  // nonexistent sites must be indistinguishable in responses.
  return new Error("Site not found.");
}

function hiddenOrMissingZone() {
  return new Error("Zone not found.");
}

function isUniqueConstraintViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

interface DailyCreateCountDb {
  site: { count(args: { where: Prisma.SiteWhereInput }): Promise<number> };
  zone: { count(args: { where: Prisma.ZoneWhereInput }): Promise<number> };
}

async function dailyCreateCount(
  tx: DailyCreateCountDb,
  ownerId: string,
  startOfDayUtc: Date,
): Promise<number> {
  const [sites, zones] = await Promise.all([
    tx.site.count({ where: { ownerId, createdAt: { gte: startOfDayUtc } } }),
    tx.zone.count({ where: { ownerId, createdAt: { gte: startOfDayUtc } } }),
  ]);
  return sites + zones;
}

/**
 * The core of "name this site": reuse an existing visible site, or create a
 * new one, then OPTIONALLY do the same one level down for a zone under that
 * site, and bind the result to the given flight endpoint. Owner-guarded by
 * the caller (a server action); this function trusts `ownerId` as already
 * authenticated and re-derives the coordinate from the flight row, never
 * from the client.
 */
export async function createOrAttachSiteFromFlight(
  input: CreateOrAttachInput,
): Promise<CreateOrAttachResult> {
  const { flightId, ownerId, endpoint } = input;

  const flight = await prisma.flight.findFirst({ where: { id: flightId, ownerId } });
  if (!flight) throw new Error("Flight not found or not owned by caller.");
  const coord = endpointCoord(flight, endpoint);
  if (!coord) throw new Error(`Flight has no ${endpoint} coordinate.`);
  const { lat, lon } = coord;
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const { site, zone, createdSite, createdZone } = await prisma.$transaction(async (tx) => {
    let site: Site;
    let createdSite = false;

    if (input.site.mode === "reuse") {
      const existing = await tx.site.findUnique({ where: { id: input.site.id } });
      if (!existing) throw hiddenOrMissingSite();
      const visibility = normalizeSiteVisibility(existing.visibility);
      if (!canSeeSite(visibility, existing.ownerId, ownerId)) throw hiddenOrMissingSite();

      // Widen kind to "both" on opposite-endpoint reuse; never narrow.
      site =
        existing.kind === "both" || existing.kind === endpoint
          ? existing
          : await tx.site.update({ where: { id: existing.id }, data: { kind: "both" } });
    } else {
      const validated = validateSiteName(input.site.name);
      if (!validated.ok) throw new Error(`Invalid site name (${validated.error}).`);
      const visibility = normalizeSiteVisibility(input.site.visibility);

      const createdToday = await dailyCreateCount(tx, ownerId, startOfDayUtc);
      if (createdToday >= DAILY_CREATE_CAP) {
        throw new Error("Daily create limit reached. Try again tomorrow.");
      }

      // Re-run the visible-candidate probe INSIDE the transaction — guards
      // two pilots creating the same site concurrently, and rejects a
      // proximity-scoped normalizedName conflict against a VISIBLE site
      // with a steer to reuse instead. SPRINT-006: the OR'd boundary branch
      // means a site whose ANCHOR sits outside the suggest radius but whose
      // drawn BOUNDARY contains this point still blocks a duplicate — the
      // exact case decision 5's picker exists to make reachable in the
      // first place.
      const box = boundingBox(lat, lon, SUGGEST_RADIUS_M);
      const lonWhere = lonWhereFor(box);
      const nearbyRows = await tx.site.findMany({
        where: {
          AND: [
            { OR: [{ AND: [{ lat: { gte: box.latMin, lte: box.latMax } }, lonWhere] }, boundaryPrefilterWhere(lat, lon)] },
            siteVisibleWhere(ownerId),
          ],
        },
        select: { id: true, name: true, normalizedName: true, lat: true, lon: true, boundary: true },
      });
      const nearby = nearbyRows.filter((s) => {
        if (s.boundary != null && !isValidBoundaryShape(s.boundary)) return false;
        return locationMatches(s, lat, lon, SUGGEST_RADIUS_M).matched;
      });
      const conflict = nearby.find((s) => s.normalizedName === validated.normalizedName);
      if (conflict) {
        throw new Error(`"${conflict.name}" already exists nearby — reuse it instead of creating a duplicate.`);
      }

      // Rounded to ~11 m: not launch-coordinate obfuscation (the flight's
      // own lat/lon stay full-precision and travel with the track) — this
      // just keeps the public site row from being a byte-exact fingerprint
      // of one private flight's takeoff fix.
      const roundedLat = Math.round(lat * 10_000) / 10_000;
      const roundedLon = Math.round(lon * 10_000) / 10_000;

      site = await tx.site.create({
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
      createdSite = true;
      await writeAuditEntry(tx, { siteId: site.id }, ownerId, "create", visibility, { name: site.name });
    }

    let zone: Zone | null = null;
    let createdZone = false;

    if (input.zone) {
      if (input.zone.mode === "reuse") {
        const existingZone = await tx.zone.findUnique({ where: { id: input.zone.id } });
        if (!existingZone || existingZone.siteId !== site.id) throw hiddenOrMissingZone();
        const zVisibility = normalizeSiteVisibility(existingZone.visibility);
        const sVisibility = normalizeSiteVisibility(site.visibility);
        const visible = canSeeZone(
          { visibility: zVisibility, ownerId: existingZone.ownerId, siteId: existingZone.siteId },
          { id: site.id, visibility: sVisibility, ownerId: site.ownerId },
          ownerId,
        );
        if (!visible) throw hiddenOrMissingZone();

        // Widen kind to "both" on opposite-endpoint reuse; never narrow —
        // the identical rule SPRINT-004 already applies at the site level.
        zone =
          existingZone.kind === "both" || existingZone.kind === endpoint
            ? existingZone
            : await tx.zone.update({ where: { id: existingZone.id }, data: { kind: "both" } });
      } else {
        const validated = validateSiteName(input.zone.name);
        if (!validated.ok) throw new Error(`Invalid zone name (${validated.error}).`);
        const zoneVisibility = normalizeSiteVisibility(input.zone.visibility);
        const siteVisibility = normalizeSiteVisibility(site.visibility);

        // Refused at the create boundary, never a DB constraint — see
        // docs/sprints/SPRINT-005.md's "Effective visibility" section for
        // why this must not become a cross-table CHECK.
        if (zoneVisibility === "public" && siteVisibility !== "public") {
          throw new Error("Publish the site first, or keep this spot private.");
        }

        const createdToday = await dailyCreateCount(tx, ownerId, startOfDayUtc);
        if (createdToday >= DAILY_CREATE_CAP) {
          throw new Error("Daily create limit reached. Try again tomorrow.");
        }

        // Pre-probe against sibling zones VISIBLE to this owner under this
        // site — catches the common case before touching the DB unique
        // index at all, and gives a helpful steer-to-reuse message. ownerId
        // is always a real, authenticated caller here (never anonymous).
        const siblings = await tx.zone.findMany({
          where: {
            siteId: site.id,
            OR: [{ visibility: "public" }, { visibility: "private", ownerId }],
          },
          select: { id: true, name: true, normalizedName: true },
        });
        const conflict = siblings.find((z) => z.normalizedName === validated.normalizedName);
        if (conflict) {
          throw new Error(`"${conflict.name}" already exists here — reuse it instead of creating a duplicate.`);
        }

        const roundedLat = Math.round(lat * 10_000) / 10_000;
        const roundedLon = Math.round(lon * 10_000) / 10_000;

        try {
          zone = await tx.zone.create({
            data: {
              siteId: site.id,
              name: validated.name,
              normalizedName: validated.normalizedName,
              kind: endpoint,
              lat: roundedLat,
              lon: roundedLon,
              ownerId,
              visibility: zoneVisibility,
            },
          });
          createdZone = true;
          await writeAuditEntry(tx, { zoneId: zone.id }, ownerId, "create", zoneVisibility, { name: zone.name });
        } catch (e) {
          if (!isUniqueConstraintViolation(e)) throw e;
          // The public-only partial index conflict: two pilots (or two
          // requests) named the same public sibling concurrently — the
          // pre-probe above can't see an uncommitted row from a still-open
          // transaction. Re-read the winner and reuse it instead of
          // surfacing a raw DB error.
          const winner = await tx.zone.findFirst({
            where: { siteId: site.id, normalizedName: validated.normalizedName, visibility: "public" },
          });
          if (!winner) throw e;
          zone = winner;
          createdZone = false;
        }

        // Widen the PARENT site's kind when the new zone's kind differs —
        // never narrow, the same rule as opposite-endpoint site reuse.
        if (site.kind !== "both" && site.kind !== zone.kind) {
          site = await tx.site.update({ where: { id: site.id }, data: { kind: "both" } });
        }
      }
    }

    return { site, zone, createdSite, createdZone };
  });

  // Link the CURRENT flight; the cache is written only through locationCachePatch.
  await prisma.flight.update({
    where: { id: flightId },
    data: locationCachePatch(site, zone, endpoint) as LocationFieldPatch,
  });

  // Retroactively fill in the creator's own other flights — upgrading
  // already-site-bound ones to the new zone when one was created/reused-into.
  const reassociated = await reassociateOwnFlights(ownerId, site, endpoint, zone);

  console.log(
    `[sites] ${createdSite ? "create" : "bind"}-site=${site.id}${
      input.zone ? ` ${createdZone ? "create" : "bind"}-zone=${zone?.id}` : ""
    } owner=${ownerId} endpoint=${endpoint} siteVisibility=${site.visibility}${
      zone ? ` zoneVisibility=${zone.visibility}` : ""
    } reassociated=${reassociated.updated}${reassociated.truncated ? "(capped)" : ""}`,
  );

  return { site, zone, createdSite, createdZone, reassociated };
}
