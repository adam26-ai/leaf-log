import { createHash } from "node:crypto";
import { Prisma, type Flight } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { haversineM } from "@/lib/geo/distance";
import { validateSiteName } from "./name";
import { boundaryColumns, validateBoundary } from "./boundary";
import { hasSitePoint, siteDraftSchema, type SiteDraft } from "./model";
import { canCommunityEditSite, recomputeSiteAndZoneCaches, DAILY_COMMUNITY_EDIT_CAP } from "./associate";
import { siteVisibleWhere, DAILY_CREATE_CAP } from "./repo";
import { writeAuditEntry } from "./audit";

export type SiteWriteDb = Pick<typeof prisma, "site" | "flight" | "zone" | "profile" | "locationAuditEntry" | "$queryRaw" | "$executeRaw">;

/** Expected editor failures may be returned by a Server Action without exposing database errors. */
export class SiteEditorExpectedError extends Error {}

/** Scoring and unrelated flight edits must not invalidate a site draft. */
export function flightSiteRevision(flight: Flight, endpoint: "takeoff" | "landing") {
  return createHash("sha256").update(JSON.stringify([
    flight.id, endpoint, flight.recordingKind,
    flight[`${endpoint}Lat`], flight[`${endpoint}Lon`],
    flight[`${endpoint}SiteId`], flight[`${endpoint}ZoneId`],
    flight[`${endpoint}SiteId`] ? null : flight[`${endpoint}SiteName`],
    flight[`${endpoint}SiteAssignment`], flight[`${endpoint}LocationSource`],
    flight[`${endpoint}LocationEvidence`],
  ])).digest("hex");
}

export function validateSiteDraft(value: unknown) {
  const draft = siteDraftSchema.parse(value);
  const name = validateSiteName(draft.name);
  if (!name.ok) throw new SiteEditorExpectedError(`Choose a valid site name (${name.error.replaceAll("_", " ")}).`);
  if ((draft.lat === null) !== (draft.lon === null)) throw new SiteEditorExpectedError("Enter both latitude and longitude, or leave both blank.");
  if (draft.visibility === "public" && !hasSitePoint(draft)) throw new SiteEditorExpectedError("Add a map pin before sharing this site.");
  const rawBoundary = draft.boundary ?? null;
  let boundary = null;
  if (rawBoundary !== null) {
    if (!hasSitePoint(draft)) throw new SiteEditorExpectedError("Place the site pin inside its boundary before saving.");
    const validated = validateBoundary(rawBoundary, "site", draft);
    if (!validated.ok) throw new SiteEditorExpectedError(`Check the boundary (${validated.error.replaceAll("_", " ")}).`);
    boundary = validated.boundary;
  }
  return { ...draft, ...name, boundary };
}

export async function assertSiteCanBecomePrivate(tx: SiteWriteDb, id: string, ownerId: string) {
  const [flights, zones, contributions] = await Promise.all([
    tx.flight.count({ where: { ownerId: { not: ownerId }, OR: [{ takeoffSiteId: id }, { landingSiteId: id }] } }),
    tx.zone.count({ where: { siteId: id, ownerId: { not: ownerId } } }),
    tx.locationAuditEntry.count({ where: { siteId: id, actorId: { not: ownerId } } }),
  ]);
  if (flights || zones || contributions) throw new SiteEditorExpectedError("Other pilots use or have contributed to this public site. It must remain public.");
}

/** Caller owns the transaction. A full edit either succeeds as a whole or rolls back. */
export async function saveSiteDraft(tx: SiteWriteDb, ownerId: string, value: SiteDraft, options: {
  pinSource?: "manual" | "csv" | "flight_gps" | "legacy";
  autoGroupKey?: string;
  automatic?: boolean;
} = {}) {
  const draft = validateSiteDraft(value);
  if (draft.id) await tx.$queryRaw`SELECT "id" FROM "Site" WHERE "id" = ${draft.id} FOR UPDATE`;
  const existing = draft.id ? await tx.site.findUnique({ where: { id: draft.id } }) : null;
  if (draft.id) {
    if (!existing || !await canCommunityEditSite(tx, existing, ownerId)) throw new SiteEditorExpectedError("Site not found or unavailable to edit.");
    if (existing.updatedAt.toISOString() !== draft.expectedUpdatedAt) throw new SiteEditorExpectedError("This site changed. Reload its details before saving; your draft has not been saved.");
    if (existing.ownerId !== ownerId && existing.visibility !== draft.visibility) throw new SiteEditorExpectedError("Only the site owner can change its visibility.");
    if (existing.visibility === "public" && draft.visibility === "private") await assertSiteCanBecomePrivate(tx, existing.id, ownerId);
  }
  if (options.automatic && draft.visibility !== "private") throw new SiteEditorExpectedError("Automatic site creation must remain private.");
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  if (!existing && draft.visibility === "public" && await tx.site.count({ where: { ownerId, visibility: "public", createdAt: { gte: start } } }) >= DAILY_CREATE_CAP) {
    throw new SiteEditorExpectedError("Daily public site creation limit reached. Save privately and share it later.");
  }
  if (existing?.visibility === "public" && await tx.locationAuditEntry.count({ where: { actorId: ownerId, createdAt: { gte: start }, action: { not: "create" } } }) >= DAILY_COMMUNITY_EDIT_CAP) {
    throw new SiteEditorExpectedError("Daily community edit limit reached. Please try again tomorrow.");
  }
  if (!existing && hasSitePoint(draft)) {
    const sameName = await tx.site.findMany({ where: { normalizedName: draft.normalizedName, archivedAt: null, ...siteVisibleWhere(ownerId) } });
    // Reuse suggestions are advisory outside the strict identity distance. Two
    // nearby launches with the same generic name are not necessarily duplicates.
    const duplicate = sameName.find(site => (site.kind === draft.kind || site.kind === "both" || draft.kind === "both") && hasSitePoint(site) && haversineM(site.lat, site.lon, draft.lat, draft.lon) <= (draft.kind === "landing" ? 300 : 150));
    if (duplicate) throw new SiteEditorExpectedError(`“${duplicate.name}” already has a nearby map pin. Choose that site, or review the location before creating another.`);
  }
  const pinChanged = !existing || existing.lat !== draft.lat || existing.lon !== draft.lon;
  const cols = boundaryColumns(draft.boundary, ownerId);
  const data = {
    name: draft.name, normalizedName: draft.normalizedName, kind: draft.kind, visibility: draft.visibility,
    lat: draft.lat, lon: draft.lon, ...cols, boundary: cols.boundary ?? Prisma.DbNull,
    ...(pinChanged ? { pinSource: options.pinSource ?? "manual" } : {}),
  };
  const site = existing
    ? await tx.site.update({ where: { id: existing.id }, data })
    : await tx.site.create({ data: { ...data, ownerId, source: "user", autoGroupKey: options.autoGroupKey ?? null } });
  if (existing && (existing.name !== site.name || existing.visibility !== site.visibility)) await recomputeSiteAndZoneCaches(tx, site);
  // A publish records only the now-public values, never its private before-state.
  await writeAuditEntry(tx, { siteId: site.id }, ownerId,
    existing ? existing.visibility === "private" && site.visibility === "public" ? "published" : "updated" : "create",
    draft.visibility, { name: site.name, kind: site.kind, lat: site.lat, lon: site.lon, hasBoundary: draft.boundary !== null });
  return site;
}
