"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import {
  assignFlightsToSite,
  createStandaloneSite,
  moveOwnedSiteAnchor,
  previewFlightsForSite,
  type SiteFlightCandidate,
} from "@/lib/sites/manage";
import { setSiteVisibility, unpublishOwnSite, type SiteEndpoint } from "@/lib/sites/associate";
import type { SiteVisibility } from "@/lib/sites/visibility";

export type SiteManagerResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function refreshSitePages() {
  revalidatePath("/settings/sites");
  revalidatePath("/logbook");
  revalidatePath("/feed");
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

export async function assignSiteFlightsAction(input: {
  siteId: string;
  selections: Array<{ id: string; endpoint: SiteEndpoint }>;
}): Promise<SiteManagerResult<{ updated: number }>> {
  try {
    const updated = await assignFlightsToSite(await ownerId(), input.siteId, input.selections);
    refreshSitePages();
    return { ok: true, value: { updated } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
