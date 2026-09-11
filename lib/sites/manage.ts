import type { Site } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { haversineM } from "@/lib/geo/distance";
import { validateSiteName } from "./name";
import { normalizeSiteVisibility, canSeeSite, type SiteVisibility } from "./visibility";
import { locationCachePatch, type SiteEndpoint } from "./associate";
import { assignmentPatch } from "./assignment";
import { boundaryContains, isValidBoundaryShape, locationMatches, radiusForKind, SUGGEST_RADIUS_M } from "./geo";
import { writeAuditEntry } from "./audit";
import { DAILY_CREATE_CAP } from "./repo";

export type ManagedSite = Pick<Site, "id" | "name" | "visibility" | "lat" | "lon" | "updatedAt"> & {
  kind: "takeoff" | "landing" | "both";
  hasBoundary: boolean;
  ownFlightCount: number;
};

function validCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function validKind(kind: string): kind is "takeoff" | "landing" | "both" {
  return kind === "takeoff" || kind === "landing" || kind === "both";
}

export async function listManagedSites(ownerId: string): Promise<ManagedSite[]> {
  const rows = await prisma.site.findMany({
    where: { ownerId },
    select: {
      id: true, name: true, kind: true, visibility: true, lat: true, lon: true,
      updatedAt: true, boundaryMinLat: true,
      _count: { select: { takeoffFlights: { where: { ownerId } }, landingFlights: { where: { ownerId } } } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: validKind(row.kind) ? row.kind : "both",
    visibility: row.visibility,
    lat: row.lat,
    lon: row.lon,
    updatedAt: row.updatedAt,
    hasBoundary: row.boundaryMinLat !== null,
    ownFlightCount: row._count.takeoffFlights + row._count.landingFlights,
  }));
}

export async function createStandaloneSite(ownerId: string, input: {
  name: string;
  kind: string;
  visibility: SiteVisibility;
  lat: number;
  lon: number;
}): Promise<Site> {
  const validated = validateSiteName(input.name);
  if (!validated.ok) throw new Error(`Invalid site name (${validated.error}).`);
  if (!validKind(input.kind)) throw new Error("Choose whether this is a takeoff, landing, or both.");
  if (!validCoordinate(input.lat, input.lon)) throw new Error("Choose a valid site location.");
  const visibility = normalizeSiteVisibility(input.visibility);
  const lat = Math.round(input.lat * 1_000_000) / 1_000_000;
  const lon = Math.round(input.lon * 1_000_000) / 1_000_000;
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  return prisma.$transaction(async (tx) => {
    const [siteCreates, zoneCreates, sameName] = await Promise.all([
      tx.site.count({ where: { ownerId, createdAt: { gte: startOfDayUtc } } }),
      tx.zone.count({ where: { ownerId, createdAt: { gte: startOfDayUtc } } }),
      tx.site.findMany({
        where: {
          normalizedName: validated.normalizedName,
          OR: [{ visibility: "public" }, { visibility: "private", ownerId }],
        },
        select: { id: true, name: true, lat: true, lon: true },
      }),
    ]);
    if (siteCreates + zoneCreates >= DAILY_CREATE_CAP) throw new Error("Daily create limit reached. Try again tomorrow.");
    const conflict = sameName.find((site) => haversineM(lat, lon, site.lat, site.lon) <= SUGGEST_RADIUS_M);
    if (conflict) throw new Error(`“${conflict.name}” already exists nearby. Select that site instead.`);

    const site = await tx.site.create({
      data: {
        name: validated.name,
        normalizedName: validated.normalizedName,
        kind: input.kind,
        visibility,
        lat,
        lon,
        source: "user",
        ownerId,
      },
    });
    await writeAuditEntry(tx, { siteId: site.id }, ownerId, "create", visibility, { name: site.name, standalone: true });
    return site;
  });
}

export async function moveOwnedSiteAnchor(ownerId: string, siteId: string, lat: number, lon: number): Promise<Site> {
  if (!validCoordinate(lat, lon)) throw new Error("Choose a valid site location.");
  const roundedLat = Math.round(lat * 1_000_000) / 1_000_000;
  const roundedLon = Math.round(lon * 1_000_000) / 1_000_000;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!existing) throw new Error("Site not found or not owned by caller.");
    if (existing.boundary !== null) {
      if (!isValidBoundaryShape(existing.boundary) || !boundaryContains(existing.boundary, roundedLat, roundedLon)) {
        throw new Error("Move the anchor inside the current boundary, or clear/redraw the boundary first.");
      }
    }
    const updated = await tx.site.update({ where: { id: siteId }, data: { lat: roundedLat, lon: roundedLon } });
    await writeAuditEntry(tx, { siteId }, ownerId, "moved", normalizeSiteVisibility(updated.visibility), {
      from: { lat: existing.lat, lon: existing.lon },
      to: { lat: roundedLat, lon: roundedLon },
    });
    return updated;
  });
}

export interface SiteFlightCandidate {
  id: string;
  endpoint: SiteEndpoint;
  date: string | null;
  source: string;
  currentSiteId: string | null;
  currentSiteName: string | null;
  assignment: string;
  lat: number;
  lon: number;
  distanceM: number;
}

export async function previewFlightsForSite(ownerId: string, siteId: string): Promise<SiteFlightCandidate[]> {
  const site = await prisma.site.findFirst({ where: { id: siteId, ownerId } });
  if (!site) throw new Error("Site not found or not owned by caller.");
  const endpoints: SiteEndpoint[] = site.kind === "takeoff" ? ["takeoff"] : site.kind === "landing" ? ["landing"] : ["takeoff", "landing"];
  const rows = await prisma.flight.findMany({
    where: { ownerId, status: "ready" },
    select: {
      id: true, flightDate: true, source: true,
      takeoffLat: true, takeoffLon: true, takeoffSiteId: true, takeoffSiteName: true, takeoffSiteAssignment: true,
      landingLat: true, landingLon: true, landingSiteId: true, landingSiteName: true, landingSiteAssignment: true,
    },
    orderBy: [{ flightDate: "desc" }, { id: "desc" }],
  });
  const candidates: SiteFlightCandidate[] = [];
  for (const row of rows) {
    for (const endpoint of endpoints) {
      const lat = row[`${endpoint}Lat`];
      const lon = row[`${endpoint}Lon`];
      if (lat === null || lon === null) continue;
      const match = locationMatches(site, lat, lon, radiusForKind(endpoint));
      if (!match.matched) continue;
      candidates.push({
        id: row.id,
        endpoint,
        date: row.flightDate?.toISOString().slice(0, 10) ?? null,
        source: row.source,
        currentSiteId: row[`${endpoint}SiteId`],
        currentSiteName: row[`${endpoint}SiteName`],
        assignment: row[`${endpoint}SiteAssignment`],
        lat,
        lon,
        distanceM: match.distanceM,
      });
    }
  }
  return candidates.slice(0, 200);
}

export async function assignFlightsToSite(ownerId: string, siteId: string, selections: Array<{ id: string; endpoint: SiteEndpoint }>): Promise<number> {
  if (selections.some((item) => item.endpoint !== "takeoff" && item.endpoint !== "landing")) {
    throw new Error("Invalid flight location selection.");
  }
  const unique = [...new Map(selections.map((item) => [`${item.id}:${item.endpoint}`, item])).values()];
  if (unique.length === 0 || unique.length > 200) throw new Error("Choose between 1 and 200 flight locations.");
  return prisma.$transaction(async (tx) => {
    let site = await tx.site.findFirst({ where: { id: siteId, ownerId } });
    if (!site || !canSeeSite(normalizeSiteVisibility(site.visibility), site.ownerId, ownerId)) throw new Error("Site is not available.");
    const endpointKinds = new Set(unique.map((item) => item.endpoint));
    if (site.kind !== "both" && (endpointKinds.size > 1 || !endpointKinds.has(site.kind as SiteEndpoint))) {
      site = await tx.site.update({ where: { id: site.id }, data: { kind: "both" } });
    }
    let updated = 0;
    for (const endpoint of ["takeoff", "landing"] as const) {
      const ids = unique.filter((item) => item.endpoint === endpoint).map((item) => item.id);
      if (ids.length === 0) continue;
      const result = await tx.flight.updateMany({
        where: { id: { in: ids }, ownerId },
        data: {
          ...locationCachePatch(site, null, endpoint),
          ...assignmentPatch(endpoint, "user_selected"),
        },
      });
      updated += result.count;
    }
    return updated;
  });
}
