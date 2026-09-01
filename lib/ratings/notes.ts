import { prisma } from "@/lib/prisma";
import { canReadInstructorNote, canWriteInstructorNote } from "@/lib/ratings/authz";

export interface InstructorNoteView {
  id: string;
  body: string;
  authorId: string;
  authorDisplayName: string;
  authorHandle: string;
  /** Whether the author is still flight.instructorId — the only state in
   *  which they (and only they) may edit this note. */
  isCurrentInstructor: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Every InstructorNote on this flight the viewer may read — the owner sees
 * all of them; a note's own author sees at least theirs, forever, even
 * after reassignment. Never resolved through the general friends/public
 * flight-visibility path (lib/flights/repo.ts) — a friend or the public
 * viewing an otherwise-visible flight gets none of these.
 */
export async function listInstructorNotesForViewer(
  flightId: string,
  viewerId: string,
): Promise<InstructorNoteView[]> {
  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    select: { ownerId: true, instructorId: true },
  });
  if (!flight) return [];

  const notes = await prisma.instructorNote.findMany({
    where: { flightId },
    include: { instructor: { select: { id: true, displayName: true, handle: true } } },
    orderBy: { createdAt: "asc" },
  });

  return notes
    .filter((note) => canReadInstructorNote(viewerId, flight.ownerId, note.instructorId))
    .map((note) => ({
      id: note.id,
      body: note.body,
      authorId: note.instructorId,
      authorDisplayName: note.instructor.displayName,
      authorHandle: note.instructor.handle,
      isCurrentInstructor: note.instructorId === flight.instructorId,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }));
}

export type UpsertInstructorNoteResult = { ok: true } | { ok: false; error: string };

/**
 * Create or edit the calling instructor's own note on this flight — one
 * evolving note per (flight, instructor), same shape as the pilot's own
 * Flight.notes field. Only the flight's CURRENT instructor may call this
 * successfully; a former instructor's note is frozen (still readable, no
 * longer editable) the moment the flight is reassigned away from them.
 */
export async function upsertInstructorNote(
  actorId: string,
  flightId: string,
  body: string,
): Promise<UpsertInstructorNoteResult> {
  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    select: { instructorId: true },
  });
  if (!flight) return { ok: false, error: "Flight not found." };

  if (!canWriteInstructorNote(actorId, actorId, flight.instructorId)) {
    return { ok: false, error: "You can only leave a note on a flight you currently instruct." };
  }

  await prisma.instructorNote.upsert({
    where: { flightId_instructorId: { flightId, instructorId: actorId } },
    create: { flightId, instructorId: actorId, body },
    update: { body },
  });

  return { ok: true };
}
