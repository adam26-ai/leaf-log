import { areFriends } from "@/lib/social/friends";

/**
 * SPRINT-009 instructor/signoff authorization predicates — small, named,
 * independently-tested functions, each landing in the PR that needs it.
 * No predicate is ever satisfied by a client-supplied value alone; every
 * check re-reads the live row (here, the current friend graph) at the
 * instant of the check.
 */

/**
 * Only the flight's owner may assign/reassign/clear its instructor, and
 * only to a profile currently in the owner's accepted friends —
 * re-verified here, not just filtered in the picker UI. `instructorId:
 * null` (clearing) is always allowed for the owner.
 */
export async function canAssignInstructor(
  actorId: string,
  ownerId: string,
  instructorId: string | null,
): Promise<boolean> {
  if (actorId !== ownerId) return false;
  if (instructorId === null) return true;
  return areFriends(ownerId, instructorId);
}

/**
 * An InstructorNote may only be written/edited by the profile that is BOTH
 * the note's own immutable author AND currently the flight's instructor.
 * Reassigning the flight freezes every note written under a prior
 * instructor — the author keeps read access (see canReadInstructorNote)
 * but loses write access, since they're no longer the current instructor.
 * Pure/synchronous: every input is a value the caller already fetched, so
 * this never re-reads anything itself — it's not exempt from the "re-check
 * the live row" rule, it just doesn't own the read.
 */
export function canWriteInstructorNote(
  actorId: string,
  noteAuthorId: string,
  flightInstructorId: string | null,
): boolean {
  return actorId === noteAuthorId && actorId === flightInstructorId;
}

/**
 * An InstructorNote is readable by the flight's owner (always) or the
 * note's own author (always, even after reassignment) — never a different
 * instructor, never a friends/public viewer, independent of the flight's
 * own visibility. Deliberately never resolved through
 * lib/flights/repo.ts's general visibility predicate.
 */
export function canReadInstructorNote(
  viewerId: string,
  flightOwnerId: string,
  noteAuthorId: string,
): boolean {
  return viewerId === flightOwnerId || viewerId === noteAuthorId;
}

/**
 * A RatingSignoff may only be created by the profile currently
 * `flight.instructorId` — append-only, so there is no separate edit
 * predicate. Once created, `signedByProfileId` is immutable and independent
 * of who instructs the flight afterward.
 */
export function canWriteSignoff(actorId: string, flightInstructorId: string | null): boolean {
  return actorId === flightInstructorId;
}

/**
 * A RatingSignoff is readable by the pilot it's about (always), the
 * instructor who originally signed it (always, even after reassignment),
 * and whoever is CURRENTLY the flight's instructor (for continuity when
 * picking up a returning student) — never a friends/public viewer.
 */
export function canReadSignoff(
  viewerId: string,
  pilotId: string,
  signedByProfileId: string,
  currentFlightInstructorId: string | null,
): boolean {
  return (
    viewerId === pilotId ||
    viewerId === signedByProfileId ||
    (currentFlightInstructorId !== null && viewerId === currentFlightInstructorId)
  );
}
