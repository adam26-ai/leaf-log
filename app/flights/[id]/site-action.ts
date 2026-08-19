"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import {
  createOrAttachSiteFromFlight,
  suggestNearbySites,
  type SiteSuggestion,
} from "@/lib/sites/repo";
import {
  unpublishOwnSite,
  deleteSite as deleteSiteRow,
  type SiteEndpoint,
} from "@/lib/sites/associate";
import { SITE_VISIBILITIES, type SiteVisibility } from "@/lib/sites/visibility";

export interface NameSiteInput {
  flightId: string;
  endpoint: SiteEndpoint;
  mode: "reuse" | "create";
  existingSiteId?: string;
  name?: string;
  visibility?: SiteVisibility;
}

export type NameSiteResult =
  | { ok: true; siteId: string; siteName: string }
  | { ok: false; error: string };

/**
 * Owner-guarded core of "name this site". Every field the client can
 * influence is re-validated server-side; the coordinate always comes from
 * the flight row, never the client. Hidden/nonexistent sites are
 * indistinguishable in the error returned.
 */
export async function nameSite(input: NameSiteInput): Promise<NameSiteResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  if (input.endpoint !== "takeoff" && input.endpoint !== "landing") {
    return { ok: false, error: "Invalid endpoint." };
  }
  if (input.mode !== "reuse" && input.mode !== "create") {
    return { ok: false, error: "Invalid mode." };
  }
  if (
    input.visibility !== undefined &&
    !(SITE_VISIBILITIES as readonly string[]).includes(input.visibility)
  ) {
    return { ok: false, error: "Invalid visibility." };
  }

  try {
    const { site } = await createOrAttachSiteFromFlight({
      flightId: input.flightId,
      ownerId: userId,
      endpoint: input.endpoint,
      mode: input.mode,
      existingSiteId: input.existingSiteId,
      name: input.name,
      visibility: input.visibility,
    });

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { handle: true },
    });

    revalidatePath(`/flights/${input.flightId}`);
    revalidatePath("/logbook");
    revalidatePath("/feed");
    if (profile) revalidatePath(`/${profile.handle}`);

    return { ok: true, siteId: site.id, siteName: site.name };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

/**
 * Nearby visible site candidates for the reuse-first step of the dialog.
 * Owner-guarded and re-derives the coordinate from the flight row.
 */
export async function suggestSitesForFlight(
  flightId: string,
  endpoint: SiteEndpoint,
): Promise<SiteSuggestion[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const flight = await prisma.flight.findFirst({
    where: { id: flightId, ownerId: userId },
    select: { takeoffLat: true, takeoffLon: true, landingLat: true, landingLon: true },
  });
  if (!flight) return [];

  const lat = endpoint === "takeoff" ? flight.takeoffLat : flight.landingLat;
  const lon = endpoint === "takeoff" ? flight.takeoffLon : flight.landingLon;
  if (lat == null || lon == null) return [];

  return suggestNearbySites(lat, lon, userId);
}

export interface BoundSiteInfo {
  ownedByViewer: boolean;
  visibility: SiteVisibility;
}

/**
 * Whether the site currently bound to this flight endpoint is one the
 * viewer owns — governs whether the dialog offers Unpublish/Delete at all.
 * Returns null when there's no bound site.
 */
export async function getBoundSiteInfo(
  flightId: string,
  endpoint: SiteEndpoint,
): Promise<BoundSiteInfo | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const siteId = await siteIdForFlightEndpoint(flightId, endpoint, userId);
  if (!siteId) return null;

  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { ownerId: true, visibility: true } });
  if (!site) return null;

  return {
    ownedByViewer: site.ownerId === userId,
    visibility: site.visibility === "public" ? "public" : "private",
  };
}

export type SiteUndoResult = { ok: true } | { ok: false; error: string };

async function siteIdForFlightEndpoint(
  flightId: string,
  endpoint: SiteEndpoint,
  userId: string,
): Promise<string | null> {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, ownerId: userId },
    select: { takeoffSiteId: true, landingSiteId: true },
  });
  if (!flight) return null;
  return endpoint === "takeoff" ? flight.takeoffSiteId : flight.landingSiteId;
}

function revalidateSiteSurfaces(flightId: string) {
  revalidatePath(`/flights/${flightId}`);
  revalidatePath("/logbook");
  revalidatePath("/feed");
}

/**
 * Creator undo: unpublish (demote to private) the site currently bound to
 * this flight endpoint, guarded — refuses once another pilot's flight
 * depends on it.
 */
export async function unpublishSiteForFlight(
  flightId: string,
  endpoint: SiteEndpoint,
): Promise<SiteUndoResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const siteId = await siteIdForFlightEndpoint(flightId, endpoint, userId);
  if (!siteId) return { ok: false, error: "No site to unpublish." };

  try {
    await unpublishOwnSite(siteId, userId);
    revalidateSiteSurfaces(flightId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

/**
 * Creator undo: delete the site currently bound to this flight endpoint,
 * guarded the same way as unpublish.
 */
export async function deleteSiteForFlight(
  flightId: string,
  endpoint: SiteEndpoint,
): Promise<SiteUndoResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const siteId = await siteIdForFlightEndpoint(flightId, endpoint, userId);
  if (!siteId) return { ok: false, error: "No site to delete." };

  try {
    await deleteSiteRow(siteId, userId);
    revalidateSiteSurfaces(flightId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
