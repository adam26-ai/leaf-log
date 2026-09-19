import { hasSitePoint } from "./model";
import type { Site } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { haversineM } from "@/lib/geo/distance";
import { validateSiteName } from "./name";
import { normalizeSiteVisibility, canSeeSite, type SiteVisibility } from "./visibility";
import { locationCachePatch, type SiteEndpoint } from "./associate";
import { assignmentPatch } from "./assignment";
import { boundaryContains, isValidBoundaryShape, locationMatches, radiusForKind, SUGGEST_RADIUS_M } from "./geo";
import { writeAuditEntry } from "./audit";
import { DAILY_CREATE_CAP, siteVisibleWhere } from "./repo";
import { flightCalendarDate } from "@/lib/flights/logbook-filters";
import { formatLocalTime } from "@/lib/flights/format";
import { lockSiteRows, lockSiteFlights } from "./locks";

export type ManagedSite = Pick<Site, "id" | "name" | "visibility" | "lat" | "lon" | "updatedAt"> & {
  kind: "takeoff" | "landing" | "both";
  boundary: import("./geo").Boundary | null;
  hasBoundary: boolean;
  ownFlightCount: number;
  hasLocationEvidence?: boolean;
  canDelete: boolean;
};

function validCoordinate(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function validKind(kind: string): kind is "takeoff" | "landing" | "both" {
  return kind === "takeoff" || kind === "landing" || kind === "both";
}

export async function listManagedSites(ownerId: string): Promise<ManagedSite[]> {
  const rows = await prisma.site.findMany({
    where: { OR: [{ ownerId }, { visibility: "public", OR: [{ takeoffFlights: { some: { ownerId } } }, { landingFlights: { some: { ownerId } } }] }] },
    select: {
      id: true, name: true, kind: true, visibility: true, lat: true, lon: true, ownerId: true,
      updatedAt: true, boundaryMinLat: true, boundary: true,
      _count: { select: { takeoffFlights: { where: { ownerId, OR: [{ takeoffLat: { not: null } }, { takeoffLon: { not: null } }] } }, landingFlights: { where: { ownerId, OR: [{ landingLat: { not: null } }, { landingLon: { not: null } }] } } } },
    },
    orderBy: { name: "asc" },
  });
  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const ids = rows.map((row) => row.id);
    const usage = await prisma.flight.groupBy({
      by: ["takeoffSiteId", "landingSiteId"],
      where: { ownerId, OR: [{ takeoffSiteId: { in: ids } }, { landingSiteId: { in: ids } }] },
      _count: { _all: true },
    });
    for (const group of usage) {
      for (const id of new Set([group.takeoffSiteId, group.landingSiteId])) {
        if (id) counts.set(id, (counts.get(id) ?? 0) + group._count._all);
      }
    }
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: validKind(row.kind) ? row.kind : "both",
    visibility: row.visibility,
    lat: row.lat,
    lon: row.lon,
    updatedAt: row.updatedAt,
    boundary: isValidBoundaryShape(row.boundary) ? row.boundary : null,
    hasBoundary: row.boundaryMinLat !== null,
    hasLocationEvidence: row._count.takeoffFlights > 0 || row._count.landingFlights > 0,
    ownFlightCount: counts.get(row.id) ?? 0,
    canDelete: row.ownerId === ownerId,
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
    const conflict = sameName.find((site) => hasSitePoint(site) && haversineM(lat, lon, site.lat, site.lon) <= SUGGEST_RADIUS_M);
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

export interface SiteFlightDetails {
  id: string;
  date: string | null;
  time: string | null;
  source: string;
  glider: string | null;
  durationS: number | null;
}

const flightDetailsSelect = {
  id: true, flightDate: true, takeoffAt: true, localUtcOffsetMinutes: true,
  source: true, glider: true, durationS: true,
} as const;

function flightDetails(row: {
  id: string; flightDate: Date | null; takeoffAt: Date | null; localUtcOffsetMinutes: number | null;
  source: string; glider: string | null; durationS: number | null;
}): SiteFlightDetails {
  return {
    id: row.id, date: flightCalendarDate(row) || null,
    time: row.takeoffAt ? formatLocalTime(row.takeoffAt, row.localUtcOffsetMinutes) : null,
    source: row.source, glider: row.glider, durationS: row.durationS,
  };
}

export interface SiteFlightPage {
  flights: Array<SiteFlightDetails & { endpoints: SiteEndpoint[] }>;
  total: number;
  page: number;
  pageCount: number;
}

export async function listFlightsAtSite(ownerId: string, siteId: string, page = 1): Promise<SiteFlightPage> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new Error("Choose a valid page.");
  const site = await prisma.site.findFirst({ where: { id: siteId, ...siteVisibleWhere(ownerId) }, select: { id: true } });
  if (!site) throw new Error("Site not found or not owned by caller.");
  // Membership is by site ID, regardless of names, coordinates, or the site's current boundary.
  const where = { ownerId, OR: [{ takeoffSiteId: siteId }, { landingSiteId: siteId }] };
  const total = await prisma.flight.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / 50));
  const currentPage = Math.min(page, pageCount);
  const rows = await prisma.flight.findMany({
    where,
    select: { ...flightDetailsSelect, takeoffSiteId: true, landingSiteId: true },
    orderBy: [{ flightDate: { sort: "desc", nulls: "last" } }, { takeoffAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    skip: (currentPage - 1) * 50, take: 50,
  });
  return {
    total, page: currentPage, pageCount,
    flights: rows.map((row) => ({
      ...flightDetails(row),
      endpoints: (["takeoff", "landing"] as const).filter((endpoint) => row[`${endpoint}SiteId`] === siteId),
    })),
  };
}

export interface SiteFlightCandidate extends SiteFlightDetails {
  endpoint: SiteEndpoint;
  currentSiteId: string | null;
  currentSiteName: string | null;
  currentSiteMapped?: boolean;
  currentSiteState: "linked" | "name_only" | "unassigned" | "unavailable";
  assignment: string;
  lat: number;
  lon: number;
  distanceM: number;
}

export async function previewFlightsForSite(ownerId: string, siteId: string): Promise<SiteFlightCandidate[]> {
  const site = await prisma.site.findFirst({ where: { id: siteId, ...siteVisibleWhere(ownerId) } });
  if (!site) throw new Error("Site not found or not owned by caller.");
  const endpoints: SiteEndpoint[] = site.kind === "takeoff" ? ["takeoff"] : site.kind === "landing" ? ["landing"] : ["takeoff", "landing"];
  const rows = await prisma.flight.findMany({
    where: {
      ownerId, status: "ready",
      // A flight already shown in Flights at this site must not also appear for review.
      AND: [
        { OR: [{ takeoffSiteId: null }, { takeoffSiteId: { not: siteId } }] },
        { OR: [{ landingSiteId: null }, { landingSiteId: { not: siteId } }] },
      ],
    },
    select: {
      ...flightDetailsSelect,
      takeoffLat: true, takeoffLon: true, takeoffSiteId: true, takeoffSiteName: true, takeoffSiteAssignment: true,
      landingLat: true, landingLon: true, landingSiteId: true, landingSiteName: true, landingSiteAssignment: true,
      takeoffSite: { select: { id: true, name: true, visibility: true, ownerId: true, lat: true, lon: true } },
      landingSite: { select: { id: true, name: true, visibility: true, ownerId: true, lat: true, lon: true } },
    },
    orderBy: [{ flightDate: { sort: "desc", nulls: "last" } }, { takeoffAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
  });
  const candidates: SiteFlightCandidate[] = [];
  for (const row of rows) {
    for (const endpoint of endpoints) {
      const lat = row[`${endpoint}Lat`];
      const lon = row[`${endpoint}Lon`];
      if (lat === null || lon === null) continue;
      const match = locationMatches(site, lat, lon, radiusForKind(endpoint));
      if (!match.matched) continue;
      const currentSite = row[`${endpoint}Site`];
      const visible = currentSite && canSeeSite(normalizeSiteVisibility(currentSite.visibility), currentSite.ownerId, ownerId);
      const savedName = row[`${endpoint}SiteName`];
      candidates.push({
        ...flightDetails(row),
        endpoint,
        currentSiteId: visible ? currentSite.id : null,
        currentSiteName: currentSite ? (visible ? currentSite.name : null) : savedName,
        currentSiteMapped: Boolean(currentSite && visible && hasSitePoint(currentSite)),
        currentSiteState: currentSite ? (visible ? "linked" : "unavailable") : savedName ? "name_only" : "unassigned",
        assignment: row[`${endpoint}SiteAssignment`],
        lat,
        lon,
        distanceM: match.distanceM,
      });
    }
  }
  return candidates;
}

export async function assignFlightsToSite(ownerId: string, siteId: string, selections: Array<{ id: string; endpoint: SiteEndpoint }>): Promise<number> {
  if (selections.some((item) => item.endpoint !== "takeoff" && item.endpoint !== "landing")) {
    throw new Error("Invalid flight location selection.");
  }
  const unique = [...new Map(selections.map((item) => [`${item.id}:${item.endpoint}`, item])).values()];
  if (unique.length === 0 || unique.length > 200) throw new Error("Choose between 1 and 200 flight locations.");
  return prisma.$transaction(async (tx) => {
    let site = await tx.site.findFirst({ where: { id: siteId, ...siteVisibleWhere(ownerId) } });
    if (!site || !canSeeSite(normalizeSiteVisibility(site.visibility), site.ownerId, ownerId)) throw new Error("Site is not available.");
    const endpointKinds = new Set(unique.map((item) => item.endpoint));
    if (site.kind !== "both" && (endpointKinds.size > 1 || !endpointKinds.has(site.kind as SiteEndpoint))) {
      site = await tx.site.update({ where: { id: site.id }, data: { kind: "both" } });
    }
    const updated = new Set<string>();
    for (const endpoint of ["takeoff", "landing"] as const) {
      const ids = unique.filter((item) => item.endpoint === endpoint).map((item) => item.id);
      if (ids.length === 0) continue;
      const result = await tx.flight.updateManyAndReturn({
        where: { id: { in: ids }, ownerId },
        data: {
          ...locationCachePatch(site, null, endpoint),
          ...assignmentPatch(endpoint, "user_selected"),
        },
        select: { id: true },
      });
      for (const flight of result) updated.add(flight.id);
    }
    return updated.size;
  });
}

export type ReplacementSite = Pick<Site, "id" | "name" | "visibility" | "lat" | "lon">;
export type SiteReplacementPreview = {
  source: ReplacementSite; target: ReplacementSite;
  flightCount: number; takeoffCount: number; landingCount: number; revision: string;
};

export async function listReplacementSites(ownerId: string, sourceId: string): Promise<ReplacementSite[]> {
  const source = await prisma.site.findFirst({ where: { id: sourceId, ...siteVisibleWhere(ownerId) }, select: { id: true } });
  if (!source) throw new Error("This site is no longer available.");
  return prisma.site.findMany({
    where: { id: { not: sourceId }, archivedAt: null, ...siteVisibleWhere(ownerId) },
    select: { id: true, name: true, visibility: true, lat: true, lon: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

async function replacementSnapshot(db: Pick<typeof prisma, "site" | "flight">, ownerId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new Error("Choose a different replacement site.");
  const sites = await db.site.findMany({ where: { id: { in: [sourceId, targetId] }, archivedAt: null, ...siteVisibleWhere(ownerId) } });
  const source = sites.find(site => site.id === sourceId), target = sites.find(site => site.id === targetId);
  if (!source || !target) throw new Error("A selected site is no longer available. Choose again.");
  const flights = await db.flight.findMany({
    where: { ownerId, OR: [{ takeoffSiteId: sourceId }, { landingSiteId: sourceId }] },
    select: { id: true, takeoffSiteId: true, landingSiteId: true }, orderBy: { id: "asc" },
  });
  const compact = (site: Site): ReplacementSite => ({ id: site.id, name: site.name, visibility: site.visibility, lat: site.lat, lon: site.lon });
  const preview: SiteReplacementPreview = {
    source: compact(source), target: compact(target), flightCount: flights.length,
    takeoffCount: flights.filter(flight => flight.takeoffSiteId === sourceId).length,
    landingCount: flights.filter(flight => flight.landingSiteId === sourceId).length,
    revision: createHash("sha256").update(JSON.stringify([source.id, source.updatedAt, target.id, target.updatedAt, flights])).digest("hex"),
  };
  return { preview, flights, target };
}

export async function previewSiteReplacement(ownerId: string, sourceId: string, targetId: string) {
  return (await replacementSnapshot(prisma, ownerId, sourceId, targetId)).preview;
}

export async function replaceLogbookSite(ownerId: string, sourceId: string, targetId: string, revision: string): Promise<number> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
    await lockSiteRows(tx, [sourceId, targetId]);
    await lockSiteFlights(tx, ownerId, sourceId);
    const snapshot = await replacementSnapshot(tx, ownerId, sourceId, targetId);
    if (snapshot.preview.revision !== revision) throw new Error("The sites or their flight references changed. Review the replacement again before confirming.");
    if (!snapshot.flights.length) throw new Error("No flights in your logbook use this site anymore.");
    for (const endpoint of ["takeoff", "landing"] as const) {
      const ids = snapshot.flights.filter(flight => flight[`${endpoint}SiteId`] === sourceId).map(flight => flight.id);
      if (!ids.length) continue;
      await tx.flight.updateMany({
        where: { ownerId, id: { in: ids }, [`${endpoint}SiteId`]: sourceId },
        data: { ...locationCachePatch(snapshot.target, null, endpoint), ...assignmentPatch(endpoint, "user_selected") },
      });
    }
    return snapshot.preview.flightCount;
  }, { maxWait: 10000, timeout: 30000 });
}
