import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getFlightForViewer } from "@/lib/flights/repo";

const RECENT_KUDOS_LIMIT = 12;

export interface KudoRecentProfile {
  id: string;
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | null;
}

export interface KudoSummary {
  count: number;
  hasKudoed: boolean;
  recent: KudoRecentProfile[];
}

function hiddenFlightError() {
  return new Error("Flight not found.");
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function toggleKudo(
  flightId: string,
  viewerId: string,
): Promise<{ kudoed: boolean }> {
  const flight = await getFlightForViewer(flightId, viewerId);
  if (!flight) throw hiddenFlightError();
  if (flight.ownerId === viewerId) throw new Error("You cannot kudos your own flight.");

  const deleted = await prisma.kudo.deleteMany({
    where: { flightId, profileId: viewerId },
  });
  if (deleted.count > 0) return { kudoed: false };

  try {
    await prisma.kudo.create({ data: { flightId, profileId: viewerId } });
    return { kudoed: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    await prisma.kudo.deleteMany({ where: { flightId, profileId: viewerId } });
    return { kudoed: false };
  }
}

export async function kudoSummaryForViewer(
  flightId: string,
  viewerId: string,
): Promise<KudoSummary> {
  const flight = await getFlightForViewer(flightId, viewerId);
  if (!flight) throw hiddenFlightError();

  const [count, own, recentRows] = await Promise.all([
    prisma.kudo.count({ where: { flightId } }),
    prisma.kudo.findUnique({
      where: { flightId_profileId: { flightId, profileId: viewerId } },
      select: { flightId: true },
    }),
    prisma.kudo.findMany({
      where: { flightId },
      orderBy: { createdAt: "desc" },
      take: RECENT_KUDOS_LIMIT,
      select: {
        profile: {
          select: {
            id: true,
            handle: true,
            displayName: true,
            avatarUpdatedAt: true,
          },
        },
      },
    }),
  ]);

  return {
    count,
    hasKudoed: own !== null,
    recent: recentRows.map((row) => row.profile),
  };
}

/**
 * Batch counts for flight lists. Callers must pass only flight ids already
 * authorized for the current viewer; this helper does not perform visibility.
 */
export async function kudoCountsFor(flightIds: string[]): Promise<Map<string, number>> {
  if (flightIds.length === 0) return new Map();

  const rows = await prisma.kudo.groupBy({
    by: ["flightId"],
    where: { flightId: { in: flightIds } },
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.flightId, row._count._all]));
}
