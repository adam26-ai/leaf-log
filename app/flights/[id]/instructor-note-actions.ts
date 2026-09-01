"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { upsertInstructorNote } from "@/lib/ratings/notes";

export type InstructorNoteState = { error?: string; ok?: boolean };

const MAX_NOTE = 2000;

/**
 * Create or edit the signed-in instructor's own note on this flight.
 * upsertInstructorNote re-verifies the actor is still the flight's current
 * instructor before writing — this action never trusts the client beyond
 * "who is signed in."
 */
export async function updateInstructorNote(
  flightId: string,
  _prev: InstructorNoteState,
  formData: FormData,
): Promise<InstructorNoteState> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: "Not signed in." };

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Note can't be empty." };
  if (body.length > MAX_NOTE) {
    return { error: `Note must be ${MAX_NOTE} characters or fewer.` };
  }

  const result = await upsertInstructorNote(userId, flightId, body);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/flights/${flightId}`);
  return { ok: true };
}
