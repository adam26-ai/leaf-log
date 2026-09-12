import { prisma } from "@/lib/prisma";
import { canReadSignoff, canWriteSignoff } from "@/lib/ratings/authz";
import { RATING_CRITERIA } from "@/lib/ratings/criteria";

export interface SignoffView {
  id: string;
  criterionKey: string;
  ratingLevel: string;
  signedByProfileId: string;
  signedByDisplayName: string;
  signedByHandle: string;
  signedAt: Date;
  note: string | null;
}

/**
 * Every active RatingSignoff for this pilot, across all levels, scoped to
 * what the viewer may read — the pilot (always), each signoff's own
 * original signer (always), and whoever is CURRENTLY that flight's
 * instructor (continuity). Never resolved through the general
 * friends/public flight-visibility path. One query covers every level
 * since /ratings renders all three cards from a single fetch.
 */
export async function activeSignoffsFor(
  pilotId: string,
  viewerId: string,
): Promise<SignoffView[]> {
  const rows = await prisma.ratingSignoff.findMany({
    where: { pilotId },
    include: {
      signedBy: { select: { id: true, displayName: true, handle: true } },
      flight: { select: { instructorId: true } },
    },
    orderBy: { signedAt: "asc" },
  });

  return rows
    .filter((row) =>
      canReadSignoff(viewerId, pilotId, row.signedByProfileId, row.flight.instructorId),
    )
    .map((row) => ({
      id: row.id,
      criterionKey: row.criterionKey,
      ratingLevel: row.ratingLevel,
      signedByProfileId: row.signedByProfileId,
      signedByDisplayName: row.signedBy.displayName,
      signedByHandle: row.signedBy.handle,
      signedAt: row.signedAt,
      note: row.note,
    }));
}

export type CreateSignoffResult = { ok: true } | { ok: false; error: string };

/**
 * Witness one USHPA criterion on this flight — only the flight's CURRENT
 * instructor may call this successfully, and only for a criterionKey that
 * is actually a `kind: "instructor"` row in the catalog. Append-only: this
 * always creates a new row, even if the same criterion was already signed
 * off (e.g. re-witnessed on a later flight) — /ratings only cares that at
 * least one active signoff exists.
 */
export async function createSignoff(
  actorId: string,
  flightId: string,
  criterionKey: string,
  note: string | null,
): Promise<CreateSignoffResult> {
  const criterion = RATING_CRITERIA.find((c) => c.id === criterionKey);
  if (!criterion || criterion.kind !== "instructor") {
    return { ok: false, error: "Not a signable criterion." };
  }

  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    select: { ownerId: true, instructorId: true },
  });
  if (!flight) return { ok: false, error: "Flight not found." };

  if (!canWriteSignoff(actorId, flight.instructorId)) {
    return { ok: false, error: "You can only sign off a flight you currently instruct." };
  }

  await prisma.ratingSignoff.create({
    data: {
      flightId,
      pilotId: flight.ownerId,
      ratingLevel: criterion.level,
      criterionKey,
      signedByProfileId: actorId,
      note,
    },
  });

  return { ok: true };
}
