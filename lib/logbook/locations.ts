import { z } from "zod";
import { createHash } from "node:crypto";
import { Prisma, type Site } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockSiteRows } from "@/lib/sites/locks";
import { siteVisibleWhere } from "@/lib/sites/repo";
import { locationCachePatch, type LocationFieldPatch } from "@/lib/sites/associate";
import { planSites, type SitePlan, type SiteResolution, type EndpointInput } from "@/lib/sites/resolution";
import { saveSiteDraft, type SiteWriteDb } from "@/lib/sites/editor";
import { siteDraftSchema, hasSitePoint } from "@/lib/sites/model";
import type { EntryDraft } from "./entry";

export const entrySiteSelect = { id: true, name: true, lat: true, lon: true, visibility: true, ownerId: true, kind: true, boundary: true, normalizedName: true, updatedAt: true } as const;
type EntrySite = Pick<Site, keyof typeof entrySiteSelect>;
export type SiteCache = Map<string, EntrySite>;
export type SiteChange = { id: string; created: boolean; updatedAt: string; before?: { lat: number | null; lon: number | null; pinSource: string } };

export function entryEndpointInputs(draft: EntryDraft, key = "entry"): EndpointInput[] {
  return (["takeoff", "landing"] as const).map(endpoint => {
    let siteDraft;
    if (draft[`${endpoint}SiteDraft`]) {
      try { siteDraft = siteDraftSchema.parse(JSON.parse(draft[`${endpoint}SiteDraft`])); }
      catch { throw new Error("The pending site edit is invalid. Reopen its editor before saving."); }
    }
    return { key: `${key}:${endpoint}`, endpoint, name: draft[`${endpoint}SiteName`],
      lat: draft[`${endpoint}Lat`] === "" ? null : Number(draft[`${endpoint}Lat`]),
      lon: draft[`${endpoint}Lon`] === "" ? null : Number(draft[`${endpoint}Lon`]),
      siteId: draft[`${endpoint}SiteId`] || undefined, draft: siteDraft, cleared: draft[`${endpoint}SiteCleared`] === "true" };
  });
}

export async function planEntrySites(db: Pick<typeof prisma, "site" | "flight">, ownerId: string, entries: Array<{ key: string; draft: EntryDraft }>) {
  const candidates = await db.site.findMany({ where: { ...siteVisibleWhere(ownerId), archivedAt: null }, select: entrySiteSelect });
  const inputs = entries.flatMap(entry => entryEndpointInputs(entry.draft, entry.key));
  const selected = new Set(inputs.filter(input => !input.draft).map(input => input.siteId));
  const unmapped = candidates.filter(site => selected.has(site.id) && site.ownerId === ownerId && !hasSitePoint(site)).map(site => site.id);
  const support: EndpointInput[] = [];
  if (unmapped.length) {
    const existing = await db.flight.findMany({ where: { ownerId, OR: [{ takeoffSiteId: { in: unmapped } }, { landingSiteId: { in: unmapped } }] },
      select: { id: true, takeoffSiteId: true, landingSiteId: true, takeoffLat: true, takeoffLon: true, landingLat: true, landingLon: true } });
    for (const flight of existing) for (const endpoint of ["takeoff", "landing"] as const) {
      const id = flight[`${endpoint}SiteId`];
      if (id && unmapped.includes(id)) support.push({ key: `evidence:${flight.id}:${endpoint}`, endpoint, name: "", siteId: id,
        lat: flight[`${endpoint}Lat`], lon: flight[`${endpoint}Lon`], evidenceOnly: true });
    }
  }
  return { plan: planSites([...inputs, ...support], candidates, ownerId), candidates };
}

export function sitePlanSignature(plan: SitePlan, candidates: EntrySite[]) {
  const selected = new Set(plan.resolutions.flatMap(row => row.siteId ? [row.siteId] : []));
  return createHash("sha256").update(JSON.stringify({ plan, sites: candidates.filter(site => selected.has(site.id)).map(site => [site.id, site.updatedAt.toISOString()]).sort() })).digest("hex");
}

export async function commitEntrySites(tx: SiteWriteDb, ownerId: string, plan: SitePlan, candidates: EntrySite[], scope: string, source: "manual" | "csv" | "flight_gps" | "legacy") {
  const selectedIds = [...new Set([...plan.resolutions.flatMap(row => row.siteId ? [row.siteId] : []), ...plan.groups.flatMap(group => group.draft.id ? [group.draft.id] : [])])];
  await lockSiteRows(tx, selectedIds);
  const fresh = selectedIds.length ? await tx.site.findMany({ where: { id: { in: selectedIds }, ...siteVisibleWhere(ownerId), archivedAt: null }, select: entrySiteSelect }) : [];
  if (fresh.length !== selectedIds.length || fresh.some(site => candidates.find(old => old.id === site.id)?.updatedAt.getTime() !== site.updatedAt.getTime())) throw new Error('A selected site changed. Review your site selections before saving.');
  const sites = new Map(candidates.map(site => [site.id, site]));
  const groupIds = new Map<string, string>();
  const changes: SiteChange[] = [];
  for (const group of plan.groups) {
    const autoGroupKey = createHash("sha256").update(`${scope}:${group.key}`).digest("hex");
    const prior = !group.draft.id ? await tx.site.findUnique({ where: { ownerId_autoGroupKey: { ownerId, autoGroupKey } } }) : null;
    const before = group.draft.id ? await tx.site.findUnique({ where: { id: group.draft.id } }) : null;
    const explicit = group.key.startsWith("draft:") || group.key.startsWith("edit:");
    const site = prior ?? await saveSiteDraft(tx, ownerId, group.draft, { pinSource: source, autoGroupKey, automatic: !explicit });
    sites.set(site.id, site); groupIds.set(group.key, site.id);
    if (!prior && !group.draft.id) changes.push({ id: site.id, created: true, updatedAt: site.updatedAt.toISOString() });
    if (before && group.key.startsWith("enrich:")) changes.push({ id: site.id, created: false, updatedAt: site.updatedAt.toISOString(), before: { lat: before.lat, lon: before.lon, pinSource: before.pinSource } });
  }
  return { sites, groupIds, changes };
}

export function resolvedLocationPatch(draft: EntryDraft, key: string, plan: SitePlan, sites: SiteCache, groupIds = new Map<string, string>()): LocationFieldPatch & { takeoffSiteAssignment: string; landingSiteAssignment: string } {
  const result = { takeoffSiteId: null, landingSiteId: null, takeoffZoneId: null, landingZoneId: null, takeoffZoneName: null, landingZoneName: null,
    takeoffSiteName: null, landingSiteName: null, takeoffSiteAssignment: "unassigned", landingSiteAssignment: "unassigned" } as LocationFieldPatch & { takeoffSiteAssignment: string; landingSiteAssignment: string };
  for (const endpoint of ["takeoff", "landing"] as const) {
    const row = plan.resolutions.find(item => item.key === `${key}:${endpoint}`);
    if (!row) continue;
    const id = row.siteId ?? (row.groupKey ? groupIds.get(row.groupKey) : null);
    const site = id ? sites.get(id) : null;
    if (site) Object.assign(result, locationCachePatch(site, null, endpoint));
    else result[`${endpoint}SiteName`] = row.name;
    result[`${endpoint}SiteAssignment`] = draft[`${endpoint}SiteCleared`] === "true" && !site && !row.name ? "cleared" : row.outcome === "review" ? "needs_review"
      : draft[`${endpoint}SiteId`] || draft[`${endpoint}SiteDraft`] ? "user_selected"
      : site ? row.outcome === "existing" ? "auto_matched" : "imported" : row.name ? "custom_name" : "unassigned";
  }
  return result;
}

export function locationEvidence(draft: EntryDraft, source: "manual" | "csv" | "flight_gps" | "legacy") {
  const original = (endpoint: "takeoff" | "landing") => {
    if (!draft[`${endpoint}OriginalLocation`]) return null;
    try { return z.object({ name: z.string().max(200), latitude: z.string().max(200), longitude: z.string().max(200) }).strict().parse(JSON.parse(draft[`${endpoint}OriginalLocation`])); }
    catch { throw new Error("Original CSV location data is invalid. Reopen the import."); }
  };
  const evidence = (endpoint: "takeoff" | "landing"): Prisma.InputJsonObject => ({
    original: original(endpoint),
    name: draft[`${endpoint}SiteName`] || null,
    lat: draft[`${endpoint}Lat`] === "" ? null : Number(draft[`${endpoint}Lat`]),
    lon: draft[`${endpoint}Lon`] === "" ? null : Number(draft[`${endpoint}Lon`]),
    meaning: draft[`${endpoint}CoordinateMeaning`], source,
  });
  return { takeoffLocationSource: draft.takeoffCoordinateMeaning === "site" ? "site_reference" : source,
    landingLocationSource: draft.landingCoordinateMeaning === "site" ? "site_reference" : source,
    takeoffLocationEvidence: evidence("takeoff"), landingLocationEvidence: evidence("landing") };
}

/** Compatibility for previews; site pins never fill a missing flight position. */
export async function locationData(db: Pick<typeof prisma, "site">, ownerId: string, draft: EntryDraft, cache?: SiteCache) {
  const candidates = cache ? [...cache.values()] : await db.site.findMany({ where: { ...siteVisibleWhere(ownerId), archivedAt: null }, select: entrySiteSelect });
  const plan = planSites(entryEndpointInputs(draft), candidates, ownerId);
  const patch = resolvedLocationPatch(draft, "entry", plan, new Map(candidates.map(site => [site.id, site])));
  // This helper is only for duplicate inspection; use live authorized names.
  for (const endpoint of ["takeoff", "landing"] as const) patch[`${endpoint}SiteName`] = plan.resolutions.find(row => row.key === `entry:${endpoint}`)?.name ?? null;
  return patch;
}

export function describeSiteResolution(row: SiteResolution): string {
  if (row.reason) return row.reason;
  if (row.outcome === "mapped") return `Create ${row.name} · Mapped · Private`;
  if (row.outcome === "unmapped") return `${row.name} · Name only · Private`;
  if (row.outcome === "existing") return `Use ${row.name}`;
  return "Site not identified";
}
