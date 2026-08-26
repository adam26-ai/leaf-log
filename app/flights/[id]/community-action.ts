"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { renameSite, renameZone } from "@/lib/sites/associate";
import { validateSiteName } from "@/lib/sites/name";
import { siteCommunityInfo, zoneCommunityInfo, type LocationCommunityInfo } from "@/lib/sites/community";
import { toggleSiteEndorsement, toggleZoneEndorsement } from "@/lib/sites/endorsements";
import type { BoundaryLevel } from "@/lib/sites/boundary";
import { zonesEnabled } from "@/lib/sites/zones-enabled";

export type CommunityActionResult = { ok: true } | { ok: false; error: string };

const ZONES_UNAVAILABLE = "Zones are not available.";

function revalidateCommunitySurfaces() {
  revalidatePath("/logbook");
  revalidatePath("/feed");
}

/**
 * SPRINT-007: the new public/read-first community dialog's data source —
 * contributors, recent history, and endorsement summary for a PUBLIC
 * site/zone. Viewer-scoped: works for an anonymous viewer (they'll see
 * counts/history but the dialog hides edit affordances client-side, and
 * every mutation re-checks server-side regardless). Returns null for a
 * hidden/nonexistent/private row.
 */
export async function getCommunityInfoForRow(level: BoundaryLevel, id: string): Promise<LocationCommunityInfo | null> {
  if (level === "zone" && !zonesEnabled()) return null;
  const userId = await getCurrentUserId();
  return level === "site" ? siteCommunityInfo(id, userId) : zoneCommunityInfo(id, userId);
}

/**
 * Rename a PUBLIC site/zone — reachable by any signed-in, onboarded pilot,
 * not just the owner (decision 1). `renameSite`/`renameZone` re-verify
 * eligibility from scratch; this action trusts nothing from the client
 * beyond the raw name string, exactly like every other site/zone action.
 */
export async function renamePublicRow(level: BoundaryLevel, id: string, rawName: string): Promise<CommunityActionResult> {
  if (level === "zone" && !zonesEnabled()) return { ok: false, error: ZONES_UNAVAILABLE };
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  const validated = validateSiteName(rawName);
  if (!validated.ok) return { ok: false, error: `Invalid name (${validated.error}).` };

  try {
    if (level === "site") await renameSite(id, userId, validated.name, validated.normalizedName);
    else await renameZone(id, userId, validated.name, validated.normalizedName);
    revalidateCommunitySurfaces();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}

export type ToggleEndorsementResult = CommunityActionResult | { ok: true; endorsed: boolean };

/** One-tap endorsement toggle, public rows only — endorsements.ts fails
 *  closed on a private (or effectively-private) target. */
export async function toggleEndorsement(level: BoundaryLevel, id: string): Promise<ToggleEndorsementResult> {
  if (level === "zone" && !zonesEnabled()) return { ok: false, error: ZONES_UNAVAILABLE };
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "You must be signed in." };

  try {
    const result = level === "site" ? await toggleSiteEndorsement(id, userId) : await toggleZoneEndorsement(id, userId);
    revalidateCommunitySurfaces();
    return { ok: true, endorsed: result.endorsed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
  }
}
