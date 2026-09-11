import type { Site } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { siteVisibleWhere } from "@/lib/sites/repo";
import { locationCachePatch, type LocationFieldPatch } from "@/lib/sites/associate";
import { assignmentPatch } from "@/lib/sites/assignment";
import type { EntryDraft } from "./entry";

export const entrySiteSelect = { id: true, name: true, lat: true, lon: true, visibility: true, ownerId: true } as const;
type EntrySite = Pick<Site, keyof typeof entrySiteSelect>;
export type SiteCache = Map<string, EntrySite>;
export async function locationData(db: Pick<typeof prisma, "site">, ownerId: string, draft: EntryDraft, cache?: SiteCache) {
  const result: LocationFieldPatch & {
    takeoffLat?: number; takeoffLon?: number; landingLat?: number; landingLon?: number;
    takeoffSiteAssignment: string; landingSiteAssignment: string;
  } = {
    takeoffSiteId: null, landingSiteId: null, takeoffZoneId: null, landingZoneId: null, takeoffZoneName: null, landingZoneName: null,
    takeoffSiteAssignment: draft.takeoffSiteName ? "custom_name" : "unassigned",
    landingSiteAssignment: draft.landingSiteName ? "custom_name" : "unassigned",
  };
  for (const endpoint of ["takeoff", "landing"] as const) {
    const id = draft[`${endpoint}SiteId`];
    if (!id) continue;
    const site = cache ? cache.get(id) : await db.site.findFirst({ where: { id, ...siteVisibleWhere(ownerId) }, select: entrySiteSelect });
    if (!site) throw new Error("A selected site is no longer available. Choose it again before saving.");
    // The shared cache helper keeps private site names out of the public cache.
    Object.assign(result, locationCachePatch(site, null, endpoint));
    Object.assign(result, assignmentPatch(endpoint, "user_selected"));
    // Flight endpoints and site anchors are separate facts. Keep an entered
    // point intact, using the site's anchor only when the entry has none.
    if (!draft[`${endpoint}Lat`] || !draft[`${endpoint}Lon`]) {
      result[`${endpoint}Lat`] = site.lat;
      result[`${endpoint}Lon`] = site.lon;
    }
  }
  return result;
}
