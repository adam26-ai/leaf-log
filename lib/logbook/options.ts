import { prisma } from "@/lib/prisma";
import { siteVisibleWhere } from "@/lib/sites/repo";
import { isValidBoundaryShape, type Boundary } from "@/lib/sites/geo";

export type EntrySite = { id: string; name: string; lat: number | null; lon: number | null; previous: boolean; kind?: string; visibility?: string; boundary?: Boundary | null; updatedAt?: string; canEditVisibility?: boolean; pinSource?: string };
export type EntryOptions = { wings: string[]; sites: EntrySite[]; siteNames: string[]; tandemWings?: string[] };

export async function getEntryOptions(ownerId: string): Promise<EntryOptions> {
  const profile = await prisma.profile.findUnique({ where: { id: ownerId }, select: { hiddenWings: true, tandemWings: true } });
  const flights = await prisma.flight.findMany({ where: { ownerId }, select: { glider: true, takeoffSiteId: true, landingSiteId: true, takeoffSiteName: true, landingSiteName: true } });
  const previous = new Set(flights.flatMap(flight => [flight.takeoffSiteId, flight.landingSiteId]).filter((id): id is string => Boolean(id)));
  const sites = await prisma.site.findMany({ where: { ...siteVisibleWhere(ownerId), archivedAt: null }, select: { id: true, name: true, lat: true, lon: true, kind: true, visibility: true, boundary: true, updatedAt: true, ownerId: true, pinSource: true }, orderBy: { name: "asc" } });
  return {
    tandemWings: profile?.tandemWings ?? [],
    wings: [...new Set(flights.map(flight => flight.glider).filter((name): name is string => Boolean(name) && !profile?.hiddenWings.includes(name!)))].sort(),
    sites: sites.map(site => ({ ...site, updatedAt: site.updatedAt.toISOString(), boundary: isValidBoundaryShape(site.boundary) ? site.boundary : null, canEditVisibility: site.ownerId === ownerId, previous: previous.has(site.id) })).sort((a, b) => Number(b.previous) - Number(a.previous) || a.name.localeCompare(b.name)),
    siteNames: [...new Set(flights.flatMap(flight => [flight.takeoffSiteName, flight.landingSiteName]).filter((name): name is string => Boolean(name)))].sort(),
  };
}
