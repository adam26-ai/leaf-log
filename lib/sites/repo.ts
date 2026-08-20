import { prisma } from "@/lib/prisma";
import type { Prisma, Site } from "@prisma/client";

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
