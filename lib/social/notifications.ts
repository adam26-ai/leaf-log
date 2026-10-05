import { prisma } from "@/lib/prisma";
import { feedWhereForViewer } from "@/lib/flights/repo";

export async function navigationCounts(viewerId: string, seenThrough?: Date) {
  if (seenThrough) {
    // Late responses from older tabs must never move the watermark backwards.
    await prisma.profile.updateMany({
      where: { id: viewerId, OR: [{ feedLastSeenAt: null }, { feedLastSeenAt: { lt: seenThrough } }] },
      data: { feedLastSeenAt: seenThrough },
    });
  }
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: viewerId }, select: { feedLastSeenAt: true, createdAt: true },
  });
  const feedWhere = await feedWhereForViewer(viewerId);
  const [feed, friends] = await Promise.all([
    prisma.flight.count({ where: { ...feedWhere, createdAt: { gt: profile.feedLastSeenAt ?? profile.createdAt } } }),
    prisma.friendship.count({ where: { addresseeId: viewerId, status: "pending" } }),
  ]);
  return { feed, friends };
}
