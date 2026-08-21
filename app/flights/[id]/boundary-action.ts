"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import {
  setSiteBoundary,
  clearSiteBoundary,
  setZoneBoundary,
  clearZoneBoundary,
  listOwnedSitesForBoundaryEditing,
  listOwnedZonesForBoundaryEditing,
  type OwnedSiteForBoundaryEditing,
  type OwnedZoneForBoundaryEditing,
  type SiteEndpoint,
} from "@/lib/sites/associate";
import type { BoundaryLevel } from "@/lib/sites/boundary";
import type { Boundary } from "@/lib/sites/geo";
import { siteIdForFlightEndpoint, zoneIdForFlightEndpoint, revalidateSiteSurfaces } from "./site-action";

export type BoundaryActionResult = { ok: true } | { ok: false; error: string };

function revalidateBoundarySurfaces() {
  revalidatePath("/logbook");
  revalidatePath("/feed");
}

/**
 * Save/clear a boundary on the site or zone currently bound to a flight
 * endpoint — the common case, reached from the flight page. The row id is
 * re-derived from the flight row (never accepted from the client), exactly
 * as every other SPRINT-004/005 flight-page action. Re-association (a
 * widened boundary retroactively picking up the caller's own previously
 * unmatched flights) fires from inside setSiteBoundary/setZoneBoundary
 * themselves, so every caller gets it automatically.
 */
export async function saveBoundaryForFlightEndpoint(
  flightId: string,
  endpoint: SiteEndpoint,
  level: BoundaryLevel,
  raw: unknown,
): Promise<BoundaryActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const targetId =
    level === "site"
      ? await siteIdForFlightEndpoint(flightId, endpoint, userId)
      : await zoneIdForFlightEndpoint(flightId, endpoint, userId);
  if (!targetId) return { ok: false, error: `No ${level} to edit.` };

  try {
    if (level === "site") await setSiteBoundary(targetId, userId, raw);
    else await setZoneBoundary(targetId, userId, raw);
    await revalidateSiteSurfaces(flightId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function clearBoundaryForFlightEndpoint(
  flightId: string,
  endpoint: SiteEndpoint,
  level: BoundaryLevel,
): Promise<BoundaryActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const targetId =
    level === "site"
      ? await siteIdForFlightEndpoint(flightId, endpoint, userId)
      : await zoneIdForFlightEndpoint(flightId, endpoint, userId);
  if (!targetId) return { ok: false, error: `No ${level} boundary to remove.` };

  try {
    if (level === "site") await clearSiteBoundary(targetId, userId);
    else await clearZoneBoundary(targetId, userId);
    await revalidateSiteSurfaces(flightId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export interface BoundaryEditableRows {
  sites: OwnedSiteForBoundaryEditing[];
  zones: OwnedZoneForBoundaryEditing[];
}

/**
 * The owner-scoped picker's contents (decision 5) — every site/zone the
 * signed-in caller owns or edit-controls, reachable with NO flight bound to
 * the target row. This is the sprint's one deliberate departure from
 * "never accept an id from the client": the id these rows expose travels
 * back through saveBoundaryForOwnedRow/clearBoundaryForOwnedRow below,
 * which re-verify ownership from scratch on every call.
 */
export async function listMyBoundaryEditableRows(): Promise<BoundaryEditableRows> {
  const userId = await getCurrentUserId();
  if (!userId) return { sites: [], zones: [] };

  const [sites, zones] = await Promise.all([
    listOwnedSitesForBoundaryEditing(userId),
    listOwnedZonesForBoundaryEditing(userId),
  ]);
  return { sites, zones };
}

/**
 * Save/clear a boundary on a site or zone the caller owns or edit-controls,
 * selected from the picker rather than derived from a bound flight. `id`
 * comes from the client (the picker's own listing) but is never trusted —
 * setSiteBoundary/setZoneBoundary re-verify ownership before touching
 * anything, so an id for a row outside the caller's own set fails exactly
 * like a nonexistent id.
 */
export async function saveBoundaryForOwnedRow(
  level: BoundaryLevel,
  id: string,
  raw: unknown,
): Promise<BoundaryActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  try {
    if (level === "site") await setSiteBoundary(id, userId, raw);
    else await setZoneBoundary(id, userId, raw);
    revalidateBoundarySurfaces();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export async function clearBoundaryForOwnedRow(level: BoundaryLevel, id: string): Promise<BoundaryActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  try {
    if (level === "site") await clearSiteBoundary(id, userId);
    else await clearZoneBoundary(id, userId);
    revalidateBoundarySurfaces();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export interface BoundaryEditorInitialState {
  anchor: { lat: number; lon: number };
  boundary: Boundary | null;
}

/**
 * The editor's initial state for a row the caller owns/edit-controls —
 * returns the anchor (always, so the editor can show it as a labelled
 * marker) and the current boundary (if any). Returns null for a row the
 * caller can't edit, hidden and nonexistent alike.
 */
export async function getBoundaryForOwnedRow(
  level: BoundaryLevel,
  id: string,
): Promise<BoundaryEditorInitialState | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  if (level === "site") {
    const site = await prisma.site.findFirst({
      where: { id, ownerId: userId },
      select: { lat: true, lon: true, boundary: true },
    });
    if (!site) return null;
    return { anchor: { lat: site.lat, lon: site.lon }, boundary: (site.boundary as Boundary | null) ?? null };
  }

  const zone = await prisma.zone.findFirst({
    where: { id, OR: [{ ownerId: userId }, { site: { ownerId: userId } }] },
    select: { lat: true, lon: true, boundary: true },
  });
  if (!zone) return null;
  return { anchor: { lat: zone.lat, lon: zone.lon }, boundary: (zone.boundary as Boundary | null) ?? null };
}
