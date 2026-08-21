import type { Prisma, Site, Zone } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canSeeSite, canSeeZone, normalizeSiteVisibility, type SiteVisibility } from "./visibility";

export type SiteEndpoint = "takeoff" | "landing";

interface SiteForCacheRow {
  id: string;
  name: string;
  visibility: string;
  ownerId: string | null;
}

interface ZoneForCacheRow {
  id: string;
  name: string;
  visibility: string;
  ownerId: string | null;
  siteId: string;
}

/**
 * The narrow slice of a Prisma client (or interactive-transaction client)
 * this module needs. Deliberately a plain structural type, not
 * `Prisma.TransactionClient` — the app's client is extended (short-id
 * injection in lib/prisma.ts), and an extended client's interactive
 * transaction has a subtly different generated type than the base one, which
 * fights a `Prisma.TransactionClient` annotation. Both `prisma` and any `tx`
 * from `prisma.$transaction(...)` satisfy this structurally.
 */
export interface LocationCacheDb {
  site: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; visibility: true; ownerId: true };
    }): Promise<SiteForCacheRow | null>;
  };
  zone: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; visibility: true; ownerId: true; siteId: true };
    }): Promise<ZoneForCacheRow | null>;
  };
}

/**
 * The eight denormalized Flight columns this module is the sole writer of
 * (SPRINT-005 widens SPRINT-004's four to eight). Deliberately a plain type
 * (not a Prisma checked/unchecked variant) so it spreads cleanly into either
 * a `flight.create` or `flight.update` data object without fighting Prisma's
 * create/update type duality.
 */
export interface LocationFieldPatch {
  takeoffSiteId?: string | null;
  takeoffSiteName?: string | null;
  takeoffZoneId?: string | null;
  takeoffZoneName?: string | null;
  landingSiteId?: string | null;
  landingSiteName?: string | null;
  landingZoneId?: string | null;
  landingZoneName?: string | null;
}

/**
 * The ONLY thing in the app allowed to write the eight
 * Flight.{takeoff,landing}{Site,Zone}{Id,Name} columns — enforced by an
 * audited allowlist test. `zoneId` is cached UNCONDITIONALLY alongside its
 * own `siteId` (the invariant is structural: this function is the only
 * place a zone id and its parent site id are ever produced together, from
 * one already-resolved pair). Only the display NAMES are conditioned on
 * visibility — a site's name only when it's public; a zone's name only
 * when BOTH it and its parent are public (the write-time conjunction,
 * mirroring the read-time one in lib/flights/repo.ts so the cache and the
 * firewall always agree). Scoped to the given endpoint so a caller can
 * never accidentally cross-wire takeoff/landing fields.
 */
export function locationCachePatch(
  site: Pick<Site, "id" | "name" | "visibility">,
  zone: Pick<Zone, "id" | "name" | "visibility" | "siteId"> | null,
  endpoint: SiteEndpoint,
): LocationFieldPatch {
  const siteIsPublic = normalizeSiteVisibility(site.visibility) === "public";
  const siteName = siteIsPublic ? site.name : null;
  const zoneIsPublic = zone !== null && siteIsPublic && normalizeSiteVisibility(zone.visibility) === "public";
  const zoneName = zoneIsPublic ? (zone as Pick<Zone, "name">).name : null;

  return endpoint === "takeoff"
    ? {
        takeoffSiteId: site.id,
        takeoffSiteName: siteName,
        takeoffZoneId: zone?.id ?? null,
        takeoffZoneName: zoneName,
      }
    : {
        landingSiteId: site.id,
        landingSiteName: siteName,
        landingZoneId: zone?.id ?? null,
        landingZoneName: zoneName,
      };
}

function emptyPatch(endpoint: SiteEndpoint): LocationFieldPatch {
  return endpoint === "takeoff"
    ? { takeoffSiteId: null, takeoffSiteName: null, takeoffZoneId: null, takeoffZoneName: null }
    : { landingSiteId: null, landingSiteName: null, landingZoneId: null, landingZoneName: null };
}

/**
 * Re-reads a previously matched site (and, if any, zone) id and re-verifies
 * BOTH are still visible to `ownerId` before returning a cache patch — not
 * just "does it still exist," but "is it STILL something this owner may
 * name their flight with." Callers pass their transaction client (`tx`) so
 * this re-check happens inside the same transaction as the write that
 * depends on it — ingestFlight's create, most importantly — closing the
 * race where a demotion between an earlier match and the write would
 * otherwise cache a name the owner no longer has any claim to.
 *
 * Degrades gracefully in exactly the way the domain wants: a zone demoted,
 * deleted, or re-parented between match and write resolves to SITE-ONLY,
 * not to nothing. A site demoted or deleted resolves to nothing, taking any
 * zone with it (the zone's own claim is meaningless without its parent).
 */
export async function resolveLocationCache(
  db: LocationCacheDb,
  siteId: string | null,
  zoneId: string | null,
  endpoint: SiteEndpoint,
  ownerId: string,
): Promise<LocationFieldPatch> {
  if (!siteId) return emptyPatch(endpoint);

  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { id: true, name: true, visibility: true, ownerId: true },
  });
  if (!site) return emptyPatch(endpoint); // deleted concurrently

  const siteVisibility = normalizeSiteVisibility(site.visibility);
  if (!canSeeSite(siteVisibility, site.ownerId, ownerId)) return emptyPatch(endpoint);

  if (!zoneId) return locationCachePatch(site, null, endpoint);

  const zone = await db.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, name: true, visibility: true, ownerId: true, siteId: true },
  });
  if (!zone || zone.siteId !== siteId) return locationCachePatch(site, null, endpoint);

  const zoneVisibility = normalizeSiteVisibility(zone.visibility);
  const zoneVisible = canSeeZone(
    { visibility: zoneVisibility, ownerId: zone.ownerId, siteId: zone.siteId },
    { id: site.id, visibility: siteVisibility, ownerId: site.ownerId },
    ownerId,
  );
  if (!zoneVisible) return locationCachePatch(site, null, endpoint);

  return locationCachePatch(site, zone, endpoint);
}

/**
 * The narrow write-side slice `recomputeSiteAndZoneCaches` needs — same
 * structural-type reasoning as `LocationCacheDb` above: the app's extended
 * client's transaction type doesn't satisfy `Prisma.TransactionClient`
 * directly, so this module never names that type.
 */
interface LocationCacheWriteDb {
  flight: {
    updateMany(args: {
      where: Prisma.FlightWhereInput;
      data: LocationFieldPatch;
    }): Promise<unknown>;
  };
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

/**
 * Recompute the cached SITE name (unconditionally) and every ZONE name
 * under it (per-zone, via one correlated statement per endpoint) to match
 * the site's CURRENT visibility — called after the site row has already
 * been updated, from inside the same transaction. A zone's own `visibility`
 * column is never touched here; only its FLIGHT-side cached name is, which
 * is what lets a zone's own visibility survive a demote/re-promote cycle of
 * its parent unchanged (see docs/sprints/SPRINT-005.md's "Effective
 * visibility" section for why that's deliberate, not an oversight).
 */
async function recomputeSiteAndZoneCaches(
  tx: LocationCacheWriteDb,
  site: Pick<Site, "id" | "name" | "visibility">,
): Promise<void> {
  const cachedSiteName = normalizeSiteVisibility(site.visibility) === "public" ? site.name : null;
  await tx.flight.updateMany({
    where: { takeoffSiteId: site.id },
    data: { takeoffSiteName: cachedSiteName },
  });
  await tx.flight.updateMany({
    where: { landingSiteId: site.id },
    data: { landingSiteName: cachedSiteName },
  });

  await tx.$executeRaw`
    UPDATE "Flight" f
       SET "takeoffZoneName" = CASE
             WHEN z."visibility" = 'public' AND s."visibility" = 'public' THEN z."name"
             ELSE NULL END
      FROM "Zone" z JOIN "Site" s ON s."id" = z."siteId"
     WHERE f."takeoffZoneId" = z."id" AND s."id" = ${site.id}`;
  await tx.$executeRaw`
    UPDATE "Flight" f
       SET "landingZoneName" = CASE
             WHEN z."visibility" = 'public' AND s."visibility" = 'public' THEN z."name"
             ELSE NULL END
      FROM "Zone" z JOIN "Site" s ON s."id" = z."siteId"
     WHERE f."landingZoneId" = z."id" AND s."id" = ${site.id}`;
}

/**
 * Promote/demote a site the caller owns. The cached name on every flight
 * referencing it (either endpoint) follows the new visibility in the same
 * transaction — public gets the name, private gets NULL (the owner still
 * sees it via the viewer-scoped read-path resolver, not this cache) — and
 * so does every zone cache under it, recomputed against each zone's OWN
 * visibility (unaffected by this call).
 */
function notFoundOrNotOwned() {
  return new Error("Site not found or not owned by caller.");
}

export async function setSiteVisibility(
  siteId: string,
  ownerId: string,
  visibility: SiteVisibility,
): Promise<Site> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!existing) throw notFoundOrNotOwned();

    const updated = await tx.site.update({ where: { id: siteId }, data: { visibility } });
    await recomputeSiteAndZoneCaches(tx, updated);
    return updated;
  });
}

/**
 * Rename a site the caller owns. The cache follows for every referencing
 * flight when the site is public; a private site's cache stays NULL either
 * way (it was never populated). Zone caches are UNTOUCHED — a site rename
 * changes the parent's name, not any zone's own name.
 */
export async function renameSite(
  siteId: string,
  ownerId: string,
  name: string,
  normalizedName: string,
): Promise<Site> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!existing) throw notFoundOrNotOwned();

    const updated = await tx.site.update({
      where: { id: siteId },
      data: { name, normalizedName },
    });
    const cachedName = updated.visibility === "public" ? updated.name : null;
    await tx.flight.updateMany({
      where: { takeoffSiteId: siteId },
      data: { takeoffSiteName: cachedName },
    });
    await tx.flight.updateMany({
      where: { landingSiteId: siteId },
      data: { landingSiteName: cachedName },
    });
    return updated;
  });
}

function stillReferenced() {
  return new Error("Another pilot's flight depends on this site — it can no longer be changed this way.");
}

/**
 * True once no OTHER pilot's flight (either endpoint) references this site.
 * The creator's own flights don't count — this guards "does giving this up
 * surprise a stranger," not "is this site orphaned."
 */
async function referencedByOthers(
  tx: Pick<LocationCacheDb, "site"> & {
    flight: { count(args: { where: Prisma.FlightWhereInput }): Promise<number> };
  },
  siteId: string,
  ownerId: string,
): Promise<boolean> {
  const count = await tx.flight.count({
    where: {
      OR: [{ takeoffSiteId: siteId }, { landingSiteId: siteId }],
      ownerId: { not: ownerId },
    },
  });
  return count > 0;
}

/**
 * True once this site has a zone owned by a DIFFERENT pilot than `ownerId`
 * — the SPRINT-005 half of the guard: `Zone.siteId` cascades on site
 * delete, so without this a site owner could silently destroy another
 * pilot's contributed zone the instant it existed, flight-referenced or
 * not. An orphaned zone (`ownerId === null`) does not count — nobody's
 * contribution is being taken from them.
 */
async function siteHasOtherOwnedZone(
  tx: { zone: { count(args: { where: Prisma.ZoneWhereInput }): Promise<number> } },
  siteId: string,
  ownerId: string,
): Promise<boolean> {
  const count = await tx.zone.count({ where: { siteId, ownerId: { not: ownerId } } });
  return count > 0;
}

/**
 * Delete a site the caller owns. `onDelete: SetNull` on
 * Flight.takeoffSiteId/landingSiteId nulls the id on every referencing
 * flight automatically; the cached *SiteName columns are deliberately left
 * untouched — that's the historical fallback the read path relies on.
 *
 * The zone side is handled EXPLICITLY, not left to cascade. In principle
 * `Zone.siteId onDelete: Cascade` deleting each zone should itself fire
 * `Flight.takeoffZoneId onDelete: SetNull` — but when the SAME flight row
 * is also the target of the direct `Flight.takeoffSiteId` SET NULL from
 * this same site delete, Postgres's FK trigger ordering for two cascade
 * paths converging on one row is not guaranteed, and empirically raises
 * `Flight_takeoffZoneId_fkey` violations rather than silently reordering
 * correctly. So both the zone id AND its cached name are nulled here,
 * before the site (and its zones) are deleted — the zone cascade then has
 * nothing left to touch on any Flight row.
 * Raw `prisma.site.delete` is forbidden everywhere else in the app; this is
 * the one sanctioned path.
 *
 * Always guarded: once another pilot's flight depends on this site, OR
 * another pilot owns a zone under it (referenced by a flight or not), it's
 * community property and can no longer be deleted this way. The operator
 * remedy (scripts/admin-sites.ts merge) reassigns those references first —
 * once the site is naturally unreferenced and zone-free-of-others, this
 * same guard passes.
 */
export async function deleteSite(siteId: string, ownerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!existing) throw notFoundOrNotOwned();
    if (await referencedByOthers(tx, siteId, ownerId)) throw stillReferenced();
    if (await siteHasOtherOwnedZone(tx, siteId, ownerId)) throw stillReferenced();

    await tx.$executeRaw`
      UPDATE "Flight" f SET "takeoffZoneId" = NULL, "takeoffZoneName" = NULL
      FROM "Zone" z WHERE f."takeoffZoneId" = z."id" AND z."siteId" = ${siteId}`;
    await tx.$executeRaw`
      UPDATE "Flight" f SET "landingZoneId" = NULL, "landingZoneName" = NULL
      FROM "Zone" z WHERE f."landingZoneId" = z."id" AND z."siteId" = ${siteId}`;

    await tx.site.delete({ where: { id: siteId } });
  });
}

/**
 * Unpublish (demote to private) a site the caller owns, guarded the same
 * way as delete: once another pilot's flight depends on it, or another
 * pilot owns a zone under it, it's community property and the creator can
 * no longer take it back. This is the specific "creator undo" wrapper — the
 * general setSiteVisibility above stays unguarded for the operator's
 * force-private remedy, which by design overrides this exact guard.
 */
export async function unpublishOwnSite(siteId: string, ownerId: string): Promise<Site> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!existing) throw notFoundOrNotOwned();
    if (await referencedByOthers(tx, siteId, ownerId)) throw stillReferenced();
    if (await siteHasOtherOwnedZone(tx, siteId, ownerId)) throw stillReferenced();

    const updated = await tx.site.update({ where: { id: siteId }, data: { visibility: "private" } });
    await recomputeSiteAndZoneCaches(tx, updated);
    return updated;
  });
}

// ---------------------------------------------------------------------
// SPRINT-005: zone transition writers, one level down from the site ones
// above. PR2 gates every one of these by the ZONE's own ownerId only — the
// site owner's additional override (decision 4 in SPRINT-005.md) is a later
// PR's addition, not yet wired here.
// ---------------------------------------------------------------------

function zoneNotFoundOrNotOwned() {
  return new Error("Zone not found or not owned by caller.");
}

function zoneStillReferenced() {
  return new Error("Another pilot's flight depends on this zone — it can no longer be changed this way.");
}

/**
 * True once no OTHER pilot's flight (either endpoint) references this
 * zone — the zone-level mirror of `referencedByOthers`.
 */
async function zoneReferencedByOthers(
  tx: { flight: { count(args: { where: Prisma.FlightWhereInput }): Promise<number> } },
  zoneId: string,
  ownerId: string,
): Promise<boolean> {
  const count = await tx.flight.count({
    where: {
      OR: [{ takeoffZoneId: zoneId }, { landingZoneId: zoneId }],
      ownerId: { not: ownerId },
    },
  });
  return count > 0;
}

/**
 * Promote/demote a zone the caller owns. Recomputes the cached zone name
 * for every referencing flight against BOTH the new zone visibility and the
 * parent site's CURRENT visibility — the write-time conjunction, matching
 * `locationCachePatch`.
 */
export async function setZoneVisibility(
  zoneId: string,
  ownerId: string,
  visibility: SiteVisibility,
): Promise<Zone> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.zone.findFirst({ where: { id: zoneId, ownerId } });
    if (!existing) throw zoneNotFoundOrNotOwned();

    const updated = await tx.zone.update({ where: { id: zoneId }, data: { visibility } });
    const site = await tx.site.findUnique({
      where: { id: updated.siteId },
      select: { visibility: true },
    });
    const siteIsPublic = site ? normalizeSiteVisibility(site.visibility) === "public" : false;
    const cachedName = siteIsPublic && visibility === "public" ? updated.name : null;
    await tx.flight.updateMany({
      where: { takeoffZoneId: zoneId },
      data: { takeoffZoneName: cachedName },
    });
    await tx.flight.updateMany({
      where: { landingZoneId: zoneId },
      data: { landingZoneName: cachedName },
    });
    return updated;
  });
}

/**
 * Rename a zone the caller owns. The cache follows for every referencing
 * flight only when the zone is EFFECTIVELY public (itself public AND its
 * parent site currently public) — a private-either-way zone's cache stays
 * NULL, mirroring SPRINT-004's site-level rule.
 */
export async function renameZone(
  zoneId: string,
  ownerId: string,
  name: string,
  normalizedName: string,
): Promise<Zone> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.zone.findFirst({ where: { id: zoneId, ownerId } });
    if (!existing) throw zoneNotFoundOrNotOwned();

    const updated = await tx.zone.update({
      where: { id: zoneId },
      data: { name, normalizedName },
    });
    const site = await tx.site.findUnique({
      where: { id: updated.siteId },
      select: { visibility: true },
    });
    const siteIsPublic = site ? normalizeSiteVisibility(site.visibility) === "public" : false;
    const cachedName =
      siteIsPublic && normalizeSiteVisibility(updated.visibility) === "public" ? updated.name : null;
    await tx.flight.updateMany({
      where: { takeoffZoneId: zoneId },
      data: { takeoffZoneName: cachedName },
    });
    await tx.flight.updateMany({
      where: { landingZoneId: zoneId },
      data: { landingZoneName: cachedName },
    });
    return updated;
  });
}

/**
 * Delete a zone the caller owns. `onDelete: SetNull` on both Flight zone id
 * columns clears the id automatically; the cached *ZoneName is explicitly
 * nulled here FIRST (matching on the id about to disappear) — a deleted
 * zone's name is never kept as history, unlike a deleted site's. The
 * flight's SITE binding is untouched: falling back to "Mission Ridge" is
 * exactly what should happen when its "North Launch" is undone.
 *
 * Guarded the same way as `deleteSite`: once another pilot's flight depends
 * on this zone, it's community property and can no longer be deleted this
 * way.
 */
export async function deleteZone(zoneId: string, ownerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.zone.findFirst({ where: { id: zoneId, ownerId } });
    if (!existing) throw zoneNotFoundOrNotOwned();
    if (await zoneReferencedByOthers(tx, zoneId, ownerId)) throw zoneStillReferenced();

    await tx.flight.updateMany({ where: { takeoffZoneId: zoneId }, data: { takeoffZoneName: null } });
    await tx.flight.updateMany({ where: { landingZoneId: zoneId }, data: { landingZoneName: null } });
    await tx.zone.delete({ where: { id: zoneId } });
  });
}

/**
 * Unpublish (demote to private) a zone the caller owns, guarded the same
 * way as delete. The specific "creator undo" wrapper — `setZoneVisibility`
 * above stays unguarded for a future operator force-private remedy.
 */
export async function unpublishOwnZone(zoneId: string, ownerId: string): Promise<Zone> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.zone.findFirst({ where: { id: zoneId, ownerId } });
    if (!existing) throw zoneNotFoundOrNotOwned();
    if (await zoneReferencedByOthers(tx, zoneId, ownerId)) throw zoneStillReferenced();

    const updated = await tx.zone.update({ where: { id: zoneId }, data: { visibility: "private" } });
    await tx.flight.updateMany({ where: { takeoffZoneId: zoneId }, data: { takeoffZoneName: null } });
    await tx.flight.updateMany({ where: { landingZoneId: zoneId }, data: { landingZoneName: null } });
    return updated;
  });
}
