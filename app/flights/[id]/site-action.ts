"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import {
  createOrAttachSiteFromFlight,
  suggestNearbySites,
  type SiteSuggestion,
} from "@/lib/sites/repo";
import type { SiteEndpoint } from "@/lib/sites/associate";
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
