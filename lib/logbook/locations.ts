import type { Site } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { siteVisibleWhere } from "@/lib/sites/repo";
import { locationCachePatch, type LocationFieldPatch } from "@/lib/sites/associate";
import type { EntryDraft } from "./entry";

export const entrySiteSelect = { id: true, name: true, lat: true, lon: true, visibility: true, ownerId: true } as const;
type EntrySite = Pick<Site, keyof typeof entrySiteSelect>;
export type SiteCache = Map<string, EntrySite>;
export async function locationData(db: Pick<typeof prisma, "site">, ownerId: string, draft: EntryDraft, cache?: SiteCache) {
  const result: LocationFieldPatch & { takeoffLat?: number; takeoffLon?: number; landingLat?: number; landingLon?: number } = {
    takeoffSiteId: null, landingSiteId: null, takeoffZoneId: null, landingZoneId: null, takeoffZoneName: null, landingZoneName: null,
  };
  for (const endpoint of ["takeoff", "landing"] as const) {
    const id = draft[`${endpoint}SiteId`];
    if (!id) continue;
    const site = cache ? cache.get(id) : await db.site.findFirst({ where: { id, ...siteVisibleWhere(ownerId) }, select: entrySiteSelect });
    if (!site) throw new Error("A selected site is no longer available. Choose it again before saving.");
    // The shared cache helper keeps private site names out of the public cache.
    Object.assign(result, locationCachePatch(site, null, endpoint));
    result[`${endpoint}Lat`] = site.lat;
    result[`${endpoint}Lon`] = site.lon;
  }
  return result;
}
