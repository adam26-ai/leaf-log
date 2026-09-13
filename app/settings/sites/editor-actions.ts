"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import { siteVisibleWhere } from "@/lib/sites/repo";
import { locationCachePatch, resolveLocationCache } from "@/lib/sites/associate";
import { saveSiteDraft } from "@/lib/sites/editor";
import { hasSitePoint, newSiteDraft, siteDraftSchema, type SiteEditorValue } from "@/lib/sites/model";
import { isValidBoundaryShape } from "@/lib/sites/geo";
import { lockFlightRow } from "@/lib/sites/locks";

const contextSchema = z.object({ siteId: z.string().max(100).optional(), flightId: z.string().max(100).optional(),
  endpoint: z.enum(["takeoff", "landing"]).optional(), create: z.boolean().optional() }).strict();
export type SiteEditorContext = z.infer<typeof contextSchema>;
async function requireOwner() {
  const id = await getCurrentUserId();
  if (!id) throw new Error("Sign in to edit sites.");
  return id;
}
export async function getSiteEditorAction(value: SiteEditorContext) {
  const ownerId = await requireOwner();
  const context = contextSchema.parse(value);
  const flight = context.flightId ? await prisma.flight.findFirst({ where: { id: context.flightId, ownerId } }) : null;
  if (context.flightId && (!flight || !context.endpoint)) throw new Error("Flight unavailable.");
  const endpoint = context.endpoint ?? "takeoff";
  const siteId = context.create ? null : context.siteId ?? flight?.[`${endpoint}SiteId`];
  const site = siteId ? await prisma.site.findFirst({ where: { id: siteId, ...siteVisibleWhere(ownerId) } }) : null;
  if (siteId && !site) throw new Error("Site unavailable.");
  const point = { lat: flight?.[`${endpoint}Lat`] ?? null, lon: flight?.[`${endpoint}Lon`] ?? null };
  const flightPoint = hasSitePoint(point) ? point : null;
  const initial: SiteEditorValue = site ? { id: site.id, expectedUpdatedAt: site.updatedAt.toISOString(), name: site.name,
    kind: site.kind === "landing" || site.kind === "both" ? site.kind : "takeoff", visibility: site.visibility === "public" ? "public" : "private",
    lat: site.lat, lon: site.lon, boundary: isValidBoundaryShape(site.boundary) ? site.boundary : null }
    : newSiteDraft(context.create ? "" : flight?.[`${endpoint}SiteName`] ?? "", endpoint, flightPoint);
  const usageCount = site ? await prisma.flight.count({ where: { ownerId, OR: [{ takeoffSiteId: site.id }, { landingSiteId: site.id }] } }) : 0;
  return { initial, pinSource: site?.pinSource ?? (flightPoint ? flight?.[`${endpoint}LocationSource`] ?? "legacy" : "manual"), flightPoint, usageCount, canChangeVisibility: !site || site.ownerId === ownerId, expectedFlightUpdatedAt: flight?.updatedAt.toISOString() };
}

export async function saveSiteEditorAction(value: { draft: z.infer<typeof siteDraftSchema>; context?: SiteEditorContext; expectedFlightUpdatedAt?: string }) {
  const ownerId = await requireOwner();
  const input = z.object({ draft: siteDraftSchema, context: contextSchema.optional(), expectedFlightUpdatedAt: z.string().datetime().optional() }).strict().parse(value);
  const endpoint = input.context?.endpoint ?? "takeoff";
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
    if (input.draft.id) await tx.$queryRaw`SELECT "id" FROM "Site" WHERE "id" = ${input.draft.id} FOR UPDATE`;
    const flightId = input.context?.flightId;
    if (flightId) await tx.$queryRaw`SELECT "id" FROM "Flight" WHERE "id" = ${flightId} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const flight = flightId ? await tx.flight.findFirst({ where: { id: flightId, ownerId } }) : null;
    if (flightId && (!flight || !input.context?.endpoint || flight.updatedAt.toISOString() !== input.expectedFlightUpdatedAt)) throw new Error("This flight changed. Reopen the editor before saving.");
    const site = await saveSiteDraft(tx, ownerId, input.draft);
    if (flight) {
      const sameSite = flight[`${endpoint}SiteId`] === site.id;
      await tx.flight.update({ where: { id: flight.id }, data: {
        ...(!sameSite ? locationCachePatch(site, null, endpoint) : {}),
        [`${endpoint}SiteAssignment`]: "user_selected",
      } });
    }
    return { id: site.id, name: site.name, updatedAt: site.updatedAt.toISOString() };
  }, { maxWait: 10000, timeout: 30000 });
  revalidatePath("/settings/sites"); revalidatePath("/logbook"); revalidatePath("/feed");
  revalidatePath("/flights/[id]", "page"); revalidatePath("/[handle]", "page");
  return result;
}

export async function clearFlightSiteAction(value: { flightId: string; endpoint: "takeoff" | "landing"; siteId: string | null; name: string | null }) {
  const ownerId = await requireOwner();
  const input = z.object({ flightId: z.string().min(1).max(100), endpoint: z.enum(["takeoff", "landing"]), siteId: z.string().max(100).nullable(), name: z.string().max(200).nullable() }).strict().parse(value);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
    await lockFlightRow(tx, input.flightId, ownerId);
    const flight = await tx.flight.findFirst({ where: { id: input.flightId, ownerId } });
    if (!flight || flight[`${input.endpoint}SiteId`] !== input.siteId || (!input.siteId && flight[`${input.endpoint}SiteName`] !== input.name)) throw new Error("The flight's site changed. Reopen its details before removing it.");
    await tx.flight.update({ where: { id: flight.id }, data: { ...await resolveLocationCache(tx, null, null, input.endpoint, ownerId), [`${input.endpoint}SiteAssignment`]: "cleared" } });
  });
  revalidatePath("/settings/sites"); revalidatePath("/logbook"); revalidatePath("/feed"); revalidatePath("/flights/[id]", "page"); revalidatePath("/[handle]", "page");
}
