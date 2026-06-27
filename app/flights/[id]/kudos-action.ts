"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { toggleKudo } from "@/lib/social/kudos";

export type KudosActionResult =
  | { ok: true; kudoed: boolean }
  | { ok: false; error: string };

export async function toggleKudoAction(
  flightId: string,
): Promise<KudosActionResult> {
  const viewerId = await getCurrentUserId();
  if (!viewerId) return { ok: false, error: "Could not update kudos." };

  try {
    const result = await toggleKudo(flightId, viewerId);
    revalidatePath(`/flights/${flightId}`);
    return { ok: true, kudoed: result.kudoed };
  } catch {
    return { ok: false, error: "Could not update kudos." };
  }
}
