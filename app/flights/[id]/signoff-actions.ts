"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { createSignoff } from "@/lib/ratings/signoffs";

export type SignoffState = { error?: string; ok?: boolean };

const MAX_NOTE = 500;

/**
 * Witness one criterion on this flight. createSignoff re-verifies the actor
 * is the flight's current instructor and that criterionKey is actually a
 * `kind: "instructor"` row — this action never trusts the client beyond
 * "who is signed in."
 */
export async function witnessCriterion(
  flightId: string,
  _prev: SignoffState,
  formData: FormData,
): Promise<SignoffState> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: "Not signed in." };

  const criterionKey = String(formData.get("criterionKey") ?? "");
  if (!criterionKey) return { error: "Missing criterion." };

  const noteRaw = String(formData.get("note") ?? "").trim();
  if (noteRaw.length > MAX_NOTE) {
    return { error: `Note must be ${MAX_NOTE} characters or fewer.` };
  }

  const result = await createSignoff(userId, flightId, criterionKey, noteRaw || null);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/flights/${flightId}`);
  revalidatePath("/ratings");
  return { ok: true };
}
