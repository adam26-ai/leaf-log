import { Prisma, type Site, type Zone } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canSeeSite, canSeeZone, normalizeSiteVisibility, type SiteVisibility } from "./visibility";
import { validateBoundary, boundaryColumns, type BoundaryColumns } from "./boundary";
import { writeAuditEntry, type AuditAction } from "./audit";

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

// ---------------------------------------------------------------------
// SPRINT-007: community edit-control. Rename and boundary set/clear on a
// PUBLIC site/zone are now open to any signed-in, ONBOARDED pilot (decision
// 1 in docs/sprints/SPRINT-007.md) — not just the owner. Publish/unpublish
// and delete stay owner-only; delete additionally gains a
// hasCommunityFootprint guard below. Private-row behavior is completely
// unchanged: only the owner may touch it, exactly as SPRINT-004/005/006.
// ---------------------------------------------------------------------

interface CommunityEditDb {
  profile: { findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null> };
}

/** "Onboarded" == has a Profile row (created during onboarding, distinct
 *  from merely being an authenticated User — see lib/profile.ts's
 *  requireProfile). Checked explicitly here rather than assumed, since the
 *  community-edit path (unlike every existing owner-gated path) can be
 *  reached by a caller whose id has never otherwise touched Site/Zone. */
async function isOnboardedCaller(tx: CommunityEditDb, callerId: string): Promise<boolean> {
  const profile = await tx.profile.findUnique({ where: { id: callerId }, select: { id: true } });
  return profile !== null;
}

/** True once `callerId` may rename or boundary-edit this SITE: its owner
 *  (any visibility), or — for a PUBLIC site only — any onboarded pilot. */
async function canCommunityEditSite(
  tx: CommunityEditDb,
  site: { visibility: string; ownerId: string | null },
  callerId: string,
): Promise<boolean> {
  if (site.ownerId === callerId) return true;
  if (normalizeSiteVisibility(site.visibility) !== "public") return false;
  return isOnboardedCaller(tx, callerId);
}

/** Same shape for a ZONE: its own owner, the parent site's owner
 *  (SPRINT-005 decision 4, unchanged), or — for an EFFECTIVELY public zone
 *  (zone AND parent site both public — the exact conjunction canSeeZone
 *  uses) — any onboarded pilot. */
async function canCommunityEditZone(
  tx: CommunityEditDb,
  zone: { visibility: string; ownerId: string | null },
  site: { visibility: string; ownerId: string | null },
  callerId: string,
): Promise<boolean> {
  if (zone.ownerId === callerId || site.ownerId === callerId) return true;
  const zonePublic = normalizeSiteVisibility(zone.visibility) === "public";
  const sitePublic = normalizeSiteVisibility(site.visibility) === "public";
  if (!zonePublic || !sitePublic) return false;
  return isOnboardedCaller(tx, callerId);
}

/**
 * A generous, per-caller-per-day backstop on community WRITES — rename and
 * boundary set/clear together, so a vandal alternating action types to
 * dodge a per-type cap doesn't get double the budget. Sourced from the
 * audit log (today's entries for this actor across those three actions),
 * which — per decision 7 — only ever records PUBLIC-row mutations. This
 * deliberately does NOT cap a pilot editing their own PRIVATE rows: that's
 * not a community-abuse vector, it's the pilot's own resource, and nothing
 * else in the app rate-limits a pilot editing their own data either.
 */
export const DAILY_COMMUNITY_EDIT_CAP = 20;

const COMMUNITY_EDIT_CAP_ACTIONS: AuditAction[] = ["renamed", "boundary_set", "boundary_cleared"];

interface CommunityEditCountDb {
  locationAuditEntry: { count(args: { where: Prisma.LocationAuditEntryWhereInput }): Promise<number> };
}

async function communityEditsToday(
  tx: CommunityEditCountDb,
  callerId: string,
  startOfDayUtc: Date,
): Promise<number> {
  return tx.locationAuditEntry.count({
    where: { actorId: callerId, action: { in: COMMUNITY_EDIT_CAP_ACTIONS }, createdAt: { gte: startOfDayUtc } },
  });
}

function dailyCommunityEditCapExceeded() {
  return new Error("Daily community-edit limit reached. Try again tomorrow.");
}

async function enforceDailyCommunityEditCap(tx: CommunityEditCountDb, callerId: string): Promise<void> {
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);
  const editedToday = await communityEditsToday(tx, callerId, startOfDayUtc);
  if (editedToday >= DAILY_COMMUNITY_EDIT_CAP) throw dailyCommunityEditCapExceeded();
}

interface CommunityFootprintDb {
  locationAuditEntry: { count(args: { where: Prisma.LocationAuditEntryWhereInput }): Promise<number> };
}

/**
 * True once ordinary creator delete/demote must be refused because another
 * pilot has made a REAL community edit — a LocationAuditEntry for this row
 * with an actor other than the owner. Endorsements do NOT count (decision
 * 3) — only actual contributions do, alongside the pre-existing
 * referencedByOthers/siteHasOtherOwnedZone guards this is layered on top
 * of, not a replacement for.
 */
async function hasCommunityFootprint(
  tx: CommunityFootprintDb,
  level: "site" | "zone",
  id: string,
  ownerId: string,
): Promise<boolean> {
  const count = await tx.locationAuditEntry.count({
    where: {
      ...(level === "site" ? { siteId: id } : { zoneId: id }),
      actorId: { not: ownerId },
    },
  });
  return count > 0;
}

function communityFootprintExists() {
  return new Error("Other pilots have contributed to this — it can no longer be changed this way.");
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

function notFoundOrNotEditable() {
  return new Error("Site not found, or you don't have permission to edit it.");
}

function zoneNotFoundOrNotEditable() {
  return new Error("Zone not found, or you don't have permission to edit it.");
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
    if (existing.visibility !== "public" && visibility === "public") {
      await writeAuditEntry(tx, { siteId }, ownerId, "published", "public", {});
    }
    return updated;
  });
}

/**
 * Rename a site the caller may edit — its owner, or (SPRINT-007) any
 * onboarded pilot when the site is public. The cache follows for every
 * referencing flight when the site is public; a private site's cache stays
 * NULL either way (it was never populated). Zone caches are UNTOUCHED — a
 * site rename changes the parent's name, not any zone's own name.
 */
export async function renameSite(
  siteId: string,
  callerId: string,
  name: string,
  normalizedName: string,
): Promise<Site> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.site.findUnique({ where: { id: siteId } });
    if (!existing) throw notFoundOrNotEditable();
    if (!(await canCommunityEditSite(tx, existing, callerId))) throw notFoundOrNotEditable();
    await enforceDailyCommunityEditCap(tx, callerId);

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
    await writeAuditEntry(tx, { siteId }, callerId, "renamed", normalizeSiteVisibility(updated.visibility), {
      from: existing.name,
      to: updated.name,
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
 * another pilot owns a zone under it (referenced by a flight or not), OR
 * (SPRINT-007) another pilot has made a real community edit to it, it's
 * community property and can no longer be deleted this way. Endorsements
 * alone do NOT block this (decision 3) — only actual contributions do. The
 * operator remedy (scripts/admin-sites.ts merge) reassigns those references
 * first — once the site is naturally unreferenced and footprint-free, this
 * same guard passes.
 */
export async function deleteSite(siteId: string, ownerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!existing) throw notFoundOrNotOwned();
    if (await referencedByOthers(tx, siteId, ownerId)) throw stillReferenced();
    if (await siteHasOtherOwnedZone(tx, siteId, ownerId)) throw stillReferenced();
    if (await hasCommunityFootprint(tx, "site", siteId, ownerId)) throw communityFootprintExists();

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
    if (await hasCommunityFootprint(tx, "site", siteId, ownerId)) throw communityFootprintExists();

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
 * A zone the caller may rename/unpublish/delete: either they created it, OR
 * they own the PARENT SITE it lives under (SPRINT-005 decision 4). The site
 * owner's power here is deliberately no broader in kind than what they
 * already have — they can already demote or delete the whole site, taking
 * every zone under it with it; this just makes that existing power
 * targetable at one zone instead of all of them. Scoped strictly to zones
 * under a site this caller actually owns — never a general moderation role.
 */
async function findZoneEditableBy(
  tx: { zone: { findUnique(args: { where: { id: string } }): Promise<Zone | null> }; site: { findUnique(args: { where: { id: string }; select: { ownerId: true } }): Promise<{ ownerId: string | null } | null> } },
  zoneId: string,
  callerId: string,
): Promise<Zone | null> {
  const zone = await tx.zone.findUnique({ where: { id: zoneId } });
  if (!zone) return null;
  if (zone.ownerId === callerId) return zone;
  const site = await tx.site.findUnique({ where: { id: zone.siteId }, select: { ownerId: true } });
  if (site?.ownerId === callerId) return zone;
  return null;
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
    const effectivelyPublic = siteIsPublic && visibility === "public";
    const cachedName = effectivelyPublic ? updated.name : null;
    await tx.flight.updateMany({
      where: { takeoffZoneId: zoneId },
      data: { takeoffZoneName: cachedName },
    });
    await tx.flight.updateMany({
      where: { landingZoneId: zoneId },
      data: { landingZoneName: cachedName },
    });
    if (normalizeSiteVisibility(existing.visibility) !== "public" && effectivelyPublic) {
      await writeAuditEntry(tx, { zoneId }, ownerId, "published", "public", {});
    }
    return updated;
  });
}

/**
 * Rename a zone the caller may edit — its own creator, the parent site's
 * owner (decision 4), or (SPRINT-007) any onboarded pilot when the zone is
 * EFFECTIVELY public. The cache follows for every referencing flight only
 * when the zone is effectively public — a private-either-way zone's cache
 * stays NULL, mirroring SPRINT-004's site-level rule.
 */
export async function renameZone(
  zoneId: string,
  callerId: string,
  name: string,
  normalizedName: string,
): Promise<Zone> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.zone.findUnique({ where: { id: zoneId } });
    if (!existing) throw zoneNotFoundOrNotEditable();
    const parentSite = await tx.site.findUnique({ where: { id: existing.siteId } });
    if (!parentSite) throw zoneNotFoundOrNotEditable();
    if (!(await canCommunityEditZone(tx, existing, parentSite, callerId))) throw zoneNotFoundOrNotEditable();
    await enforceDailyCommunityEditCap(tx, callerId);

    const updated = await tx.zone.update({
      where: { id: zoneId },
      data: { name, normalizedName },
    });
    const siteIsPublic = normalizeSiteVisibility(parentSite.visibility) === "public";
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
    await writeAuditEntry(
      tx,
      { zoneId },
      callerId,
      "renamed",
      siteIsPublic ? normalizeSiteVisibility(updated.visibility) : "private",
      { from: existing.name, to: updated.name },
    );
    return updated;
  });
}

/**
 * Delete a zone the caller may edit — its own creator, OR the parent site's
 * owner (decision 4). `onDelete: SetNull` on both Flight zone id columns
 * clears the id automatically; the cached *ZoneName is explicitly nulled
 * here FIRST (matching on the id about to disappear) — a deleted zone's
 * name is never kept as history, unlike a deleted site's. The flight's SITE
 * binding is untouched: falling back to "Mission Ridge" is exactly what
 * should happen when its "North Launch" is undone — including when it was
 * the LAST zone under that site, which leaves a fully functional bare site.
 *
 * Guarded the same way as `deleteSite`: once another pilot's flight depends
 * on this zone, it's community property and can no longer be deleted this
 * way. "Another pilot" excludes only the CALLER — so if the site owner is
 * deleting a zone they didn't create, the zone's own creator having a
 * flight bound to it still blocks the delete, exactly as it would block
 * the creator themselves.
 */
export async function deleteZone(zoneId: string, ownerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await findZoneEditableBy(tx, zoneId, ownerId);
    if (!existing) throw zoneNotFoundOrNotOwned();
    if (await zoneReferencedByOthers(tx, zoneId, ownerId)) throw zoneStillReferenced();
    if (await hasCommunityFootprint(tx, "zone", zoneId, ownerId)) throw communityFootprintExists();

    await tx.flight.updateMany({ where: { takeoffZoneId: zoneId }, data: { takeoffZoneName: null } });
    await tx.flight.updateMany({ where: { landingZoneId: zoneId }, data: { landingZoneName: null } });
    await tx.zone.delete({ where: { id: zoneId } });
  });
}

/**
 * Unpublish (demote to private) a zone the caller may edit — its own
 * creator, OR the parent site's owner (decision 4) — guarded the same way
 * as delete. The specific "creator undo" wrapper — `setZoneVisibility`
 * above stays zone-owner-only, for a future "publish my own private zone"
 * action, not a moderation power.
 */
export async function unpublishOwnZone(zoneId: string, ownerId: string): Promise<Zone> {
  return prisma.$transaction(async (tx) => {
    const existing = await findZoneEditableBy(tx, zoneId, ownerId);
    if (!existing) throw zoneNotFoundOrNotOwned();
    if (await zoneReferencedByOthers(tx, zoneId, ownerId)) throw zoneStillReferenced();
    if (await hasCommunityFootprint(tx, "zone", zoneId, ownerId)) throw communityFootprintExists();

    const updated = await tx.zone.update({ where: { id: zoneId }, data: { visibility: "private" } });
    await tx.flight.updateMany({ where: { takeoffZoneId: zoneId }, data: { takeoffZoneName: null } });
    await tx.flight.updateMany({ where: { landingZoneId: zoneId }, data: { landingZoneName: null } });
    return updated;
  });
}

// ---------------------------------------------------------------------
// SPRINT-006: boundary write path. A boundary is geometry, never identity —
// these functions touch ONLY Site/Zone's own boundary columns, never a
// Flight cache column (write-audit.test.ts's allowlist is unmodified by
// this sprint; the only Flight writes anywhere in this file remain the
// pre-existing *Name-column ones above). See docs/sprints/SPRINT-006.md.
// ---------------------------------------------------------------------

function boundaryInvalid(error: string) {
  return new Error(`Invalid boundary (${error}).`);
}

/**
 * Adapts boundaryColumns()'s plain `Boundary | null` (deliberately DB-free,
 * living in lib/sites/boundary.ts) into what Prisma's generated `update`
 * input actually needs for a nullable Json column: Prisma disambiguates a
 * SQL NULL from a stored JSON `null` via Prisma.DbNull/Prisma.JsonNull, so a
 * plain JS `null` does not type-check (and would be the wrong sentinel even
 * if it did). This is the one place that distinction is bridged.
 */
function boundaryUpdateData(cols: BoundaryColumns) {
  return { ...cols, boundary: cols.boundary ?? Prisma.DbNull };
}

/**
 * Which endpoint(s) a widened boundary should retroactively re-associate
 * the drawer's own unmatched flights against — mirrors kindMatches's
 * existing "both" wildcard; a kind-less/legacy row re-associates both
 * directions rather than none, which is conservative (it only ever fills
 * in a null on the OWNER's own flights).
 */
function endpointsForKind(kind: string): SiteEndpoint[] {
  if (kind === "takeoff") return ["takeoff"];
  if (kind === "landing") return ["landing"];
  return ["takeoff", "landing"];
}

/**
 * Widening a boundary can reach flights the old radius couldn't — fire the
 * same retroactive, owner-scoped, capped re-association
 * createOrAttachSiteFromFlight already uses (lib/sites/repo.ts's
 * reassociateOwnFlights), additively: locationCachePatch remains the only
 * Flight-cache writer, this only decides WHICH of the caller's own flights
 * get offered to it. A dynamic import breaks the otherwise-circular
 * associate.ts <-> repo.ts dependency (repo.ts already imports
 * locationCachePatch from this file) without restructuring either module —
 * safe because it's resolved lazily, well after both modules are loaded,
 * never at import time.
 */
async function reassociateAfterBoundarySet(
  ownerId: string,
  level: "site" | "zone",
  updatedRow: Site | Zone,
): Promise<void> {
  const { reassociateOwnFlights } = await import("./repo");
  if (level === "site") {
    const site = updatedRow as Site;
    for (const endpoint of endpointsForKind(site.kind)) {
      await reassociateOwnFlights(ownerId, site, endpoint, null);
    }
    return;
  }

  const zone = updatedRow as Zone;
  const site = await prisma.site.findUnique({ where: { id: zone.siteId } });
  if (!site) return; // deleted concurrently — nothing to re-associate against
  for (const endpoint of endpointsForKind(zone.kind)) {
    await reassociateOwnFlights(ownerId, site, endpoint, zone);
  }
}

/**
 * Set (or replace) a site's boundary — its owner, or (SPRINT-007) any
 * onboarded pilot when the site is public. No "referenced by another
 * pilot's flight" guard, unlike rename/delete: a boundary edit destroys
 * nothing (existing bindings survive by construction; the worst case is a
 * future flight matching differently, which is what a gazetteer edit IS),
 * so guarding it the same way as rename would make the feature unusable at
 * exactly the sites that need it most.
 */
export async function setSiteBoundary(siteId: string, callerId: string, raw: unknown): Promise<Site> {
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.site.findUnique({ where: { id: siteId } });
    if (!existing) throw notFoundOrNotEditable();
    if (!(await canCommunityEditSite(tx, existing, callerId))) throw notFoundOrNotEditable();

    const validated = validateBoundary(raw, "site", { lat: existing.lat, lon: existing.lon });
    if (!validated.ok) throw boundaryInvalid(validated.error);

    await enforceDailyCommunityEditCap(tx, callerId);

    const row = await tx.site.update({
      where: { id: siteId },
      data: boundaryUpdateData(boundaryColumns(validated.boundary, callerId)),
    });
    await writeAuditEntry(tx, { siteId }, callerId, "boundary_set", normalizeSiteVisibility(row.visibility), {
      vertexCount: validated.boundary.geometry.coordinates[0].length - 1,
    });
    console.log(
      `[sites] boundary set site=${siteId} caller=${callerId} vertices=${validated.boundary.geometry.coordinates[0].length - 1}`,
    );
    return row;
  });
  await reassociateAfterBoundarySet(callerId, "site", updated);
  return updated;
}

/** Clear a site's boundary — its owner, or (SPRINT-007) any onboarded pilot
 *  when the site is public. Back to circle matching; always succeeds for an
 *  editable caller, never leaves the row unmatched. */
export async function clearSiteBoundary(siteId: string, callerId: string): Promise<Site> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.site.findUnique({ where: { id: siteId } });
    if (!existing) throw notFoundOrNotEditable();
    if (!(await canCommunityEditSite(tx, existing, callerId))) throw notFoundOrNotEditable();
    await enforceDailyCommunityEditCap(tx, callerId);

    const updated = await tx.site.update({
      where: { id: siteId },
      data: boundaryUpdateData(boundaryColumns(null, callerId)),
    });
    await writeAuditEntry(tx, { siteId }, callerId, "boundary_cleared", normalizeSiteVisibility(updated.visibility), {});
    console.log(`[sites] boundary cleared site=${siteId} caller=${callerId}`);
    return updated;
  });
}

/** Set (or replace) a zone's boundary — the zone's own owner, the parent
 *  site's owner (decision 4), or (SPRINT-007) any onboarded pilot when the
 *  zone is EFFECTIVELY public. */
export async function setZoneBoundary(zoneId: string, callerId: string, raw: unknown): Promise<Zone> {
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.zone.findUnique({ where: { id: zoneId } });
    if (!existing) throw zoneNotFoundOrNotEditable();
    const parentSite = await tx.site.findUnique({ where: { id: existing.siteId } });
    if (!parentSite) throw zoneNotFoundOrNotEditable();
    if (!(await canCommunityEditZone(tx, existing, parentSite, callerId))) throw zoneNotFoundOrNotEditable();

    const validated = validateBoundary(raw, "zone", { lat: existing.lat, lon: existing.lon });
    if (!validated.ok) throw boundaryInvalid(validated.error);

    await enforceDailyCommunityEditCap(tx, callerId);

    const row = await tx.zone.update({
      where: { id: zoneId },
      data: boundaryUpdateData(boundaryColumns(validated.boundary, callerId)),
    });
    const effectivelyPublic =
      normalizeSiteVisibility(parentSite.visibility) === "public" && normalizeSiteVisibility(row.visibility) === "public";
    await writeAuditEntry(tx, { zoneId }, callerId, "boundary_set", effectivelyPublic ? "public" : "private", {
      vertexCount: validated.boundary.geometry.coordinates[0].length - 1,
    });
    console.log(
      `[sites] boundary set zone=${zoneId} caller=${callerId} vertices=${validated.boundary.geometry.coordinates[0].length - 1}`,
    );
    return row;
  });
  await reassociateAfterBoundarySet(callerId, "zone", updated);
  return updated;
}

/** Clear a zone's boundary — the zone's own owner, the parent site's owner,
 *  or (SPRINT-007) any onboarded pilot when the zone is effectively public. */
export async function clearZoneBoundary(zoneId: string, callerId: string): Promise<Zone> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.zone.findUnique({ where: { id: zoneId } });
    if (!existing) throw zoneNotFoundOrNotEditable();
    const parentSite = await tx.site.findUnique({ where: { id: existing.siteId } });
    if (!parentSite) throw zoneNotFoundOrNotEditable();
    if (!(await canCommunityEditZone(tx, existing, parentSite, callerId))) throw zoneNotFoundOrNotEditable();
    await enforceDailyCommunityEditCap(tx, callerId);

    const updated = await tx.zone.update({
      where: { id: zoneId },
      data: boundaryUpdateData(boundaryColumns(null, callerId)),
    });
    const effectivelyPublic =
      normalizeSiteVisibility(parentSite.visibility) === "public" && normalizeSiteVisibility(updated.visibility) === "public";
    await writeAuditEntry(tx, { zoneId }, callerId, "boundary_cleared", effectivelyPublic ? "public" : "private", {});
    console.log(`[sites] boundary cleared zone=${zoneId} caller=${callerId}`);
    return updated;
  });
}

export interface OwnedSiteForBoundaryEditing {
  id: string;
  name: string;
  visibility: string;
  lat: number;
  lon: number;
  hasBoundary: boolean;
}

export interface OwnedZoneForBoundaryEditing {
  id: string;
  siteId: string;
  siteName: string;
  name: string;
  visibility: string;
  lat: number;
  lon: number;
  hasBoundary: boolean;
  /** Editable via zone ownership, or via the parent site's ownership. */
  editableAsSiteOwner: boolean;
}

/**
 * Every site `callerId` owns — the picker's site list (decision 5). An
 * owner-scoped read: returns exactly the rows the caller may already
 * rename/delete/edit, nothing more. `hasBoundary` is derived from the
 * (unselected) boundary column via its bbox sibling, so the boundary JSON
 * itself never leaves the DB layer for this listing.
 */
export async function listOwnedSitesForBoundaryEditing(callerId: string): Promise<OwnedSiteForBoundaryEditing[]> {
  const rows = await prisma.site.findMany({
    where: { ownerId: callerId },
    select: { id: true, name: true, visibility: true, lat: true, lon: true, boundaryMinLat: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    visibility: r.visibility,
    lat: r.lat,
    lon: r.lon,
    hasBoundary: r.boundaryMinLat != null,
  }));
}

/**
 * Every zone `callerId` may edit — their own zones, OR zones under a site
 * they own (decision 4's scoped power, listed instead of looked up one at a
 * time). This is the SAME set `findZoneEditableBy` recognizes; nothing here
 * widens it.
 */
export async function listOwnedZonesForBoundaryEditing(callerId: string): Promise<OwnedZoneForBoundaryEditing[]> {
  const rows = await prisma.zone.findMany({
    where: { OR: [{ ownerId: callerId }, { site: { ownerId: callerId } }] },
    select: {
      id: true,
      siteId: true,
      name: true,
      visibility: true,
      lat: true,
      lon: true,
      ownerId: true,
      boundaryMinLat: true,
      site: { select: { name: true, ownerId: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    siteId: r.siteId,
    siteName: r.site.name,
    name: r.name,
    visibility: r.visibility,
    lat: r.lat,
    lon: r.lon,
    hasBoundary: r.boundaryMinLat != null,
    editableAsSiteOwner: r.ownerId !== callerId && r.site.ownerId === callerId,
  }));
}
