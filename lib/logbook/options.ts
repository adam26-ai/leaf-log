import { prisma } from "@/lib/prisma";
import { siteVisibleWhere } from "@/lib/sites/repo";

export type EntrySite = { id: string; name: string; lat: number; lon: number; previous: boolean };
export type EntryOptions = { wings: string[]; sites: EntrySite[]; siteNames: string[] };

export async function getEntryOptions(ownerId: string): Promise<EntryOptions> {
  const flights = await prisma.flight.findMany({ where: { ownerId }, select: { glider: true, takeoffSiteId: true, landingSiteId: true, takeoffSiteName: true, landingSiteName: true } });
  const previous = new Set(flights.flatMap(flight => [flight.takeoffSiteId, flight.landingSiteId]).filter((id): id is string => Boolean(id)));
  const sites = await prisma.site.findMany({ where: siteVisibleWhere(ownerId), select: { id: true, name: true, lat: true, lon: true }, orderBy: { name: "asc" } });
  return {
    wings: [...new Set(flights.map(flight => flight.glider).filter((name): name is string => Boolean(name)))].sort(),
    sites: sites.map(site => ({ ...site, previous: previous.has(site.id) })).sort((a, b) => Number(b.previous) - Number(a.previous) || a.name.localeCompare(b.name)),
    siteNames: [...new Set(flights.flatMap(flight => [flight.takeoffSiteName, flight.landingSiteName]).filter((name): name is string => Boolean(name)))].sort(),
  };
}
