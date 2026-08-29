"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";

export type NotesState = { error?: string; ok?: boolean };

const MAX_NOTES = 2000;

/** Update a flight's free-text notes. Owner-scoped via the where-clause. */
export async function updateNotes(
  flightId: string,
  _prev: NotesState,
  formData: FormData,
): Promise<NotesState> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: "Not signed in." };

  const notes = String(formData.get("notes") ?? "").trim();
  if (notes.length > MAX_NOTES) {
    return { error: `Notes must be ${MAX_NOTES} characters or fewer.` };
  }

  const res = await prisma.flight.updateMany({
    where: { id: flightId, ownerId: userId },
    data: { notes: notes || null },
  });
  if (res.count === 0) return { error: "Flight not found." };

  revalidatePath(`/flights/${flightId}`);
  revalidatePath(`/flights/${flightId}/edit`);
  return { ok: true };
}
