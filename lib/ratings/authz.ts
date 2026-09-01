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
