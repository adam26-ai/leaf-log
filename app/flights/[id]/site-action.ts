"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import {
  createOrAttachSiteFromFlight,
  suggestNearbyLocations,
  type SiteSuggestion,
  type SiteChoice,
  type ZoneChoice,
} from "@/lib/sites/repo";
import {
  unpublishOwnSite,
  deleteSite as deleteSiteRow,
  unpublishOwnZone,
  deleteZone as deleteZoneRow,
  type SiteEndpoint,
} from "@/lib/sites/associate";
import { SITE_VISIBILITIES, type SiteVisibility } from "@/lib/sites/visibility";

function isValidSiteVisibility(v: unknown): v is SiteVisibility {
  return (SITE_VISIBILITIES as readonly unknown[]).includes(v);
}

function validateSiteChoice(site: unknown): SiteChoice | null {
  if (!site || typeof site !== "object") return null;
  const s = site as Record<string, unknown>;
  if (s.mode === "reuse" && typeof s.id === "string") return { mode: "reuse", id: s.id };
  if (s.mode === "create" && typeof s.name === "string" && isValidSiteVisibility(s.visibility)) {
    return { mode: "create", name: s.name, visibility: s.visibility };
  }
  return null;
}

function validateZoneChoice(zone: unknown): ZoneChoice | null | undefined {
  if (zone === undefined) return undefined;
  if (!zone || typeof zone !== "object") return null;
  const z = zone as Record<string, unknown>;
  if (z.mode === "reuse" && typeof z.id === "string") return { mode: "reuse", id: z.id };
  if (z.mode === "create" && typeof z.name === "string" && isValidSiteVisibility(z.visibility)) {
    return { mode: "create", name: z.name, visibility: z.visibility };
  }
  return null;
}

export interface NameSiteInput {
  flightId: string;
  endpoint: SiteEndpoint;
  site: SiteChoice;
  /** OMITTED = bind the bare site only — skipping the zone step is a first-class outcome. */
  zone?: ZoneChoice;
}

export type NameSiteResult =
  | { ok: true; siteId: string; siteName: string; zoneId: string | null; zoneName: string | null }
  | { ok: false; error: string };

/**
 * Owner-guarded core of "name this site" — now optionally two levels deep.
 * Every field the client can influence is re-validated server-side; the
 * coordinate always comes from the flight row, never the client.
 * Hidden/nonexistent sites AND zones are indistinguishable in the error
 * returned (lib/sites/repo.ts's hiddenOrMissingSite/hiddenOrMissingZone).
 */
export async function nameSite(input: NameSiteInput): Promise<NameSiteResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  if (input.endpoint !== "takeoff" && input.endpoint !== "landing") {
    return { ok: false, error: "Invalid endpoint." };
  }
  const site = validateSiteChoice(input.site);
  if (!site) return { ok: false, error: "Invalid site selection." };
  const zone = validateZoneChoice(input.zone);
  if (zone === null) return { ok: false, error: "Invalid spot selection." };

  try {
    const result = await createOrAttachSiteFromFlight({
      flightId: input.flightId,
      ownerId: userId,
      endpoint: input.endpoint,
      site,
      zone: zone ?? undefined,
    });

    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { handle: true },
    });

    revalidatePath(`/flights/${input.flightId}`);
    revalidatePath("/logbook");
    revalidatePath("/feed");
    if (profile) revalidatePath(`/${profile.handle}`);

    return {
      ok: true,
      siteId: result.site.id,
      siteName: result.site.name,
      zoneId: result.zone?.id ?? null,
      zoneName: result.zone?.name ?? null,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

/**
 * Nearby visible site (and nested zone) candidates for the reuse-first step
 * of the dialog. Owner-guarded and re-derives the coordinate from the
 * flight row.
 */
export async function suggestLocationsForFlight(
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

  return suggestNearbyLocations(lat, lon, userId);
}

export interface BoundSiteInfo {
  id: string;
  ownedByViewer: boolean;
  visibility: SiteVisibility;
}

export interface BoundZoneInfo {
  id: string;
  ownedByViewer: boolean;
  visibility: SiteVisibility;
}

export interface BoundLocationInfo {
  site: BoundSiteInfo | null;
  zone: BoundZoneInfo | null;
}

/**
 * Whether the site (and zone, if any) currently bound to this flight
 * endpoint are ones the viewer owns — governs whether the dialog offers
 * Unpublish/Delete at either level. `site`/`zone` are null when there's no
 * bound row at that level.
 */
export async function getBoundLocationInfo(
  flightId: string,
  endpoint: SiteEndpoint,
): Promise<BoundLocationInfo> {
  const userId = await getCurrentUserId();
  if (!userId) return { site: null, zone: null };

  const flight = await prisma.flight.findFirst({
    where: { id: flightId, ownerId: userId },
    select: { takeoffSiteId: true, landingSiteId: true, takeoffZoneId: true, landingZoneId: true },
  });
  if (!flight) return { site: null, zone: null };

  const siteId = endpoint === "takeoff" ? flight.takeoffSiteId : flight.landingSiteId;
  const zoneId = endpoint === "takeoff" ? flight.takeoffZoneId : flight.landingZoneId;

  const [siteRow, zoneRow] = await Promise.all([
    siteId
      ? prisma.site.findUnique({ where: { id: siteId }, select: { id: true, ownerId: true, visibility: true } })
      : null,
    zoneId
      ? prisma.zone.findUnique({ where: { id: zoneId }, select: { id: true, ownerId: true, visibility: true } })
      : null,
  ]);

  return {
    site: siteRow
      ? {
          id: siteRow.id,
          ownedByViewer: siteRow.ownerId === userId,
          visibility: siteRow.visibility === "public" ? "public" : "private",
        }
      : null,
    zone: zoneRow
      ? {
          id: zoneRow.id,
          // SPRINT-005 decision 4: the parent site's owner may also
          // rename/unpublish/delete a zone they didn't create — mirrors the
          // check lib/sites/associate.ts's findZoneEditableBy actually
          // enforces, so this flag never promises a button that would fail.
          ownedByViewer: zoneRow.ownerId === userId || siteRow?.ownerId === userId,
          visibility: zoneRow.visibility === "public" ? "public" : "private",
        }
      : null,
  };
}

export type SiteUndoResult = { ok: true } | { ok: false; error: string };

/** Exported for app/flights/[id]/boundary-action.ts — the same
 *  owner-scoped, flight-derived id resolution the boundary write path's
 *  bound-flight case reuses rather than re-deriving. */
export async function siteIdForFlightEndpoint(
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

export async function zoneIdForFlightEndpoint(
  flightId: string,
  endpoint: SiteEndpoint,
  userId: string,
): Promise<string | null> {
  const flight = await prisma.flight.findFirst({
    where: { id: flightId, ownerId: userId },
    select: { takeoffZoneId: true, landingZoneId: true },
  });
  if (!flight) return null;
  return endpoint === "takeoff" ? flight.takeoffZoneId : flight.landingZoneId;
}

// Async only because Next.js requires every export of a "use server" file
// to be an async function — this one has nothing to await.
export async function revalidateSiteSurfaces(flightId: string) {
  revalidatePath(`/flights/${flightId}`);
  revalidatePath("/logbook");
  revalidatePath("/feed");
}

/**
 * Creator undo: unpublish (demote to private) the site currently bound to
 * this flight endpoint, guarded — refuses once another pilot's flight
 * depends on it, or another pilot owns a zone under it.
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
    await revalidateSiteSurfaces(flightId);
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
    await revalidateSiteSurfaces(flightId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

/** Creator undo, one level down: unpublish the zone bound to this endpoint. */
export async function unpublishZoneForFlight(
  flightId: string,
  endpoint: SiteEndpoint,
): Promise<SiteUndoResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const zoneId = await zoneIdForFlightEndpoint(flightId, endpoint, userId);
  if (!zoneId) return { ok: false, error: "No spot to unpublish." };

  try {
    await unpublishOwnZone(zoneId, userId);
    await revalidateSiteSurfaces(flightId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

/** Creator undo, one level down: delete the zone bound to this endpoint. */
export async function deleteZoneForFlight(
  flightId: string,
  endpoint: SiteEndpoint,
): Promise<SiteUndoResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const zoneId = await zoneIdForFlightEndpoint(flightId, endpoint, userId);
  if (!zoneId) return { ok: false, error: "No spot to delete." };

  try {
    await deleteZoneRow(zoneId, userId);
    await revalidateSiteSurfaces(flightId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
