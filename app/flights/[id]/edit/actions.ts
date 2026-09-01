"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import { OCCUPANCIES, FLIGHT_TYPE_TAGS, LAUNCH_TYPES } from "@/lib/ratings/skill-tags";
import { canAssignInstructor } from "@/lib/ratings/authz";

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

export type FlightDetailsState = { error?: string; ok?: boolean };

function pickMultiSelect(formData: FormData, field: string, allowed: readonly string[]): string[] {
  const values = new Set(formData.getAll(field).map(String));
  return allowed.filter((v) => values.has(v));
}

/**
 * Update a flight's Occupancy, Flight type, Launch type, and Landing tags —
 * one card, one save, matching the notes-field idiom. Every tag is
 * self-reported by the owner and re-validated server-side against the fixed
 * option sets in lib/ratings/skill-tags.ts before it's ever persisted.
 */
export async function updateFlightDetails(
  flightId: string,
  _prev: FlightDetailsState,
  formData: FormData,
): Promise<FlightDetailsState> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: "Not signed in." };

  const occupancyRaw = String(formData.get("occupancy") ?? "");
  if (!(OCCUPANCIES as readonly string[]).includes(occupancyRaw)) {
    return { error: "Invalid occupancy." };
  }

  const flightTypeTags = pickMultiSelect(formData, "flightTypeTags", FLIGHT_TYPE_TAGS);
  const launchTypes = pickMultiSelect(formData, "launchTypes", LAUNCH_TYPES);
  const restrictedLandingField = formData.get("restrictedLandingField") === "on";

  const res = await prisma.flight.updateMany({
    where: { id: flightId, ownerId: userId },
    data: {
      occupancy: occupancyRaw,
      flightTypeTags,
      launchTypes,
      restrictedLandingField,
    },
  });
  if (res.count === 0) return { error: "Flight not found." };

  revalidatePath(`/flights/${flightId}`);
  revalidatePath(`/flights/${flightId}/edit`);
  revalidatePath("/ratings");
  return { ok: true };
}

export type InstructorState = { error?: string; ok?: boolean };

/**
 * Assign, reassign, or clear a flight's instructor of record. Owner-only,
 * and only to a profile currently in the owner's accepted friends —
 * canAssignInstructor re-checks the live friend graph, never trusting the
 * picker UI's own filtering. A no-op resubmit of the flight's current
 * instructorId always succeeds without a fresh friend-check, so an
 * unrelated save doesn't break if that instructor was later unfriended.
 */
export async function updateInstructor(
  flightId: string,
  _prev: InstructorState,
  formData: FormData,
): Promise<InstructorState> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: "Not signed in." };

  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    select: { ownerId: true, instructorId: true },
  });
  if (!flight) return { error: "Flight not found." };

  const raw = String(formData.get("instructorId") ?? "");
  const instructorId = raw === "" ? null : raw;

  if (instructorId !== flight.instructorId) {
    const allowed = await canAssignInstructor(userId, flight.ownerId, instructorId);
    if (!allowed) {
      return { error: "You can only assign a current accepted friend as instructor." };
    }
  }

  const res = await prisma.flight.updateMany({
    where: { id: flightId, ownerId: userId },
    data: { instructorId },
  });
  if (res.count === 0) return { error: "Flight not found." };

  revalidatePath(`/flights/${flightId}`);
  revalidatePath(`/flights/${flightId}/edit`);
  return { ok: true };
}
