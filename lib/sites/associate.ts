import type { Prisma, Site } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canSeeSite, normalizeSiteVisibility, type SiteVisibility } from "./visibility";

export type SiteEndpoint = "takeoff" | "landing";

interface SiteForCacheRow {
  id: string;
  name: string;
  visibility: string;
  ownerId: string | null;
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
export interface SiteCacheDb {
  site: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; visibility: true; ownerId: true };
    }): Promise<SiteForCacheRow | null>;
  };
}

/**
 * The four denormalized Flight columns this module is the sole writer of.
 * Deliberately a plain type (not a Prisma checked/unchecked variant) so it
 * spreads cleanly into either a `flight.create` or `flight.update` data
 * object without fighting Prisma's create/update type duality.
 */
export interface SiteFieldPatch {
  takeoffSiteId?: string | null;
  takeoffSiteName?: string | null;
  landingSiteId?: string | null;
  landingSiteName?: string | null;
}

/**
 * The ONLY thing in the app allowed to write
 * Flight.{takeoff,landing}SiteId/SiteName — enforced by an audited allowlist
 * test. Caches the display name ONLY for a public site; a private site's
 * name must never reach this denormalized cache column. Scoped to the given
 * endpoint so a caller can never accidentally cross-wire takeoff/landing
 * fields.
 */
export function siteCachePatch(
  site: Pick<Site, "id" | "name" | "visibility">,
  endpoint: SiteEndpoint,
): SiteFieldPatch {
  const name = normalizeSiteVisibility(site.visibility) === "public" ? site.name : null;
  return endpoint === "takeoff"
    ? { takeoffSiteId: site.id, takeoffSiteName: name }
    : { landingSiteId: site.id, landingSiteName: name };
}

function notFoundOrNotOwned() {
  return new Error("Site not found or not owned by caller.");
}

/**
 * Re-reads a previously matched site id and re-verifies it's still visible
 * to `ownerId` before returning a cache patch — not just "does it still
 * exist," but "is it STILL something this owner may name their flight with."
 * A site demoted to private and now owned by someone else resolves exactly
 * like it never matched. Callers pass their transaction client (`tx`) so
 * this re-check happens inside the same transaction as the write that
 * depends on it — ingestFlight's create, most importantly — closing the
 * race where a demotion between an earlier match and the write would
 * otherwise cache a name the owner no longer has any claim to.
 */
export async function resolveSiteCache(
  db: SiteCacheDb,
  siteId: string | null,
  endpoint: SiteEndpoint,
  ownerId: string,
): Promise<SiteFieldPatch> {
  const empty: SiteFieldPatch =
    endpoint === "takeoff"
      ? { takeoffSiteId: null, takeoffSiteName: null }
      : { landingSiteId: null, landingSiteName: null };
  if (!siteId) return empty;

  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { id: true, name: true, visibility: true, ownerId: true },
  });
  if (!site) return empty; // deleted concurrently

  const visibility = normalizeSiteVisibility(site.visibility);
  if (!canSeeSite(visibility, site.ownerId, ownerId)) return empty;

  return siteCachePatch(site, endpoint);
}

/**
 * Promote/demote a site the caller owns. The cached name on every flight
 * referencing it (either endpoint) follows the new visibility in the same
 * transaction — public gets the name, private gets NULL (the owner still
 * sees it via the viewer-scoped read-path resolver, not this cache).
 */
export async function setSiteVisibility(
  siteId: string,
  ownerId: string,
  visibility: SiteVisibility,
): Promise<Site> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!existing) throw notFoundOrNotOwned();

    const updated = await tx.site.update({ where: { id: siteId }, data: { visibility } });
    const cachedName = visibility === "public" ? updated.name : null;
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

/**
 * Rename a site the caller owns. The cache follows for every referencing
 * flight when the site is public; a private site's cache stays NULL either
 * way (it was never populated).
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
  tx: Pick<SiteCacheDb, "site"> & {
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
 * Delete a site the caller owns. `onDelete: SetNull` on both
 * Flight.takeoffSiteId/landingSiteId nulls the id on every referencing
 * flight automatically; the cached *SiteName columns are deliberately left
 * untouched — that's the historical fallback the read path relies on.
 * Raw `prisma.site.delete` is forbidden everywhere else in the app; this is
 * the one sanctioned path.
 *
 * Always guarded: once another pilot's flight depends on this site, it's
 * community property and can no longer be deleted this way. The operator
 * remedy (scripts/admin-sites.ts merge) reassigns those references first —
 * once the site is naturally unreferenced, this same guard passes.
 */
export async function deleteSite(siteId: string, ownerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!existing) throw notFoundOrNotOwned();
    if (await referencedByOthers(tx, siteId, ownerId)) throw stillReferenced();
    await tx.site.delete({ where: { id: siteId } });
  });
}

/**
 * Unpublish (demote to private) a site the caller owns, guarded the same
 * way as delete: once another pilot's flight depends on it, it's community
 * property and the creator can no longer take it back. This is the specific
 * "creator undo" wrapper — the general setSiteVisibility above stays
 * unguarded for the operator's force-private remedy, which by design
 * overrides this exact guard.
 */
export async function unpublishOwnSite(siteId: string, ownerId: string): Promise<Site> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!existing) throw notFoundOrNotOwned();
    if (await referencedByOthers(tx, siteId, ownerId)) throw stillReferenced();

    const updated = await tx.site.update({ where: { id: siteId }, data: { visibility: "private" } });
    await tx.flight.updateMany({ where: { takeoffSiteId: siteId }, data: { takeoffSiteName: null } });
    await tx.flight.updateMany({ where: { landingSiteId: siteId }, data: { landingSiteName: null } });
    return updated;
  });
}
