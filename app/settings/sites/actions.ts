"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/profile";
import {
  assignFlightsToSite,
  createStandaloneSite,
  moveOwnedSiteAnchor,
  previewFlightsForSite,
  listFlightsAtSite,
  listReplacementSites, previewSiteReplacement, replaceLogbookSite,
  type ReplacementSite, type SiteReplacementPreview,
  type SiteFlightPage,
  type SiteFlightCandidate,
} from "@/lib/sites/manage";
import { deleteSite, previewSiteDeletion, setSiteVisibility, unpublishOwnSite, type SiteDeletionPreview, type SiteEndpoint } from "@/lib/sites/associate";
import type { SiteVisibility } from "@/lib/sites/visibility";

export type SiteManagerResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function refreshSitePages() {
  revalidatePath("/sites");
  revalidatePath("/settings/sites");
  revalidatePath("/logbook");
  revalidatePath("/feed");
  revalidatePath("/upload");
  revalidatePath("/flights/[id]", "page");
  revalidatePath("/[handle]", "page");
}

async function ownerId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) throw new Error("You must be signed in.");
  return id;
}

export async function createSiteAction(input: {
  name: string;
  kind: string;
  visibility: SiteVisibility;
  lat: number;
  lon: number;
}): Promise<SiteManagerResult<{ id: string }>> {
  try {
    const site = await createStandaloneSite(await ownerId(), input);
    refreshSitePages();
    return { ok: true, value: { id: site.id } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function moveSiteAnchorAction(input: {
  siteId: string;
  lat: number;
  lon: number;
}): Promise<SiteManagerResult> {
  try {
    await moveOwnedSiteAnchor(await ownerId(), input.siteId, input.lat, input.lon);
    refreshSitePages();
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function setSiteVisibilityAction(input: {
  siteId: string;
  visibility: SiteVisibility;
}): Promise<SiteManagerResult> {
  try {
    const id = await ownerId();
    if (input.visibility !== "private" && input.visibility !== "public") {
      return { ok: false, error: "Choose public or private visibility." };
    }
    if (typeof input.siteId !== "string" || !input.siteId.trim()) {
      return { ok: false, error: "Choose a site." };
    }
    if (input.visibility === "private") {
      // Keep the creator-undo guards for sites other pilots depend on.
      await unpublishOwnSite(input.siteId, id);
    } else {
      await setSiteVisibility(input.siteId, id, "public");
    }
    refreshSitePages();
    revalidatePath("/flights/[id]", "page");
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function previewSiteFlightsAction(siteId: string): Promise<SiteManagerResult<SiteFlightCandidate[]>> {
  try {
    return { ok: true, value: await previewFlightsForSite(await ownerId(), siteId) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function listSiteFlightsAction(siteId: string, page = 1): Promise<SiteManagerResult<SiteFlightPage>> {
  try {
    return { ok: true, value: await listFlightsAtSite(await ownerId(), siteId, page) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not load flights." };
  }
}

export async function assignSiteFlightsAction(input: {
  siteId: string;
  selections: Array<{ id: string; endpoint: SiteEndpoint }>;
}): Promise<SiteManagerResult<{ updated: number }>> {
  try {
    const updated = await assignFlightsToSite(await ownerId(), input.siteId, input.selections);
    refreshSitePages();
    revalidatePath("/flights/[id]", "page");
    return { ok: true, value: { updated } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

const siteIdSchema = z.string().min(1).max(100);
const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const replacementSchema = z.object({ sourceId: siteIdSchema, targetId: siteIdSchema }).strict();

export async function replacementSitesAction(sourceId: string): Promise<SiteManagerResult<ReplacementSite[]>> {
  try { return { ok: true, value: await listReplacementSites(await ownerId(), siteIdSchema.parse(sourceId)) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not load replacement sites." }; }
}

export async function previewSiteReplacementAction(input: { sourceId: string; targetId: string }): Promise<SiteManagerResult<SiteReplacementPreview>> {
  try {
    const id = await ownerId(), value = replacementSchema.parse(input);
    return { ok: true, value: await previewSiteReplacement(id, value.sourceId, value.targetId) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not preview this replacement." }; }
}

export async function replaceSiteAction(input: { sourceId: string; targetId: string; revision: string }): Promise<SiteManagerResult<{ updated: number }>> {
  try {
    const id = await ownerId(), value = replacementSchema.extend({ revision: revisionSchema }).parse(input);
    const updated = await replaceLogbookSite(id, value.sourceId, value.targetId, value.revision);
    refreshSitePages();
    return { ok: true, value: { updated } };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not replace this site." }; }
}

export async function previewDeleteSiteAction(siteId: string): Promise<SiteManagerResult<SiteDeletionPreview>> {
  try { return { ok: true, value: await previewSiteDeletion(siteIdSchema.parse(siteId), await ownerId()) }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not preview this deletion." }; }
}

export async function deleteSiteAction(input: { siteId: string; revision: string }): Promise<SiteManagerResult> {
  try {
    const id = await ownerId(), value = z.object({ siteId: siteIdSchema, revision: revisionSchema }).strict().parse(input);
    await deleteSite(value.siteId, id, value.revision);
    refreshSitePages();
    return { ok: true, value: undefined };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Could not delete this site." }; }
}
