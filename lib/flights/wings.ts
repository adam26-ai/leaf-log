import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export interface WingSummary { name: string | null; count: number }
export const wingEditSchema = z.object({
  sources: z.array(z.object({ name: z.string().max(10000).nullable(), count: z.number().int().positive() })).min(1).max(1000),
  target: z.string().trim().min(1).max(200).refine(name => !/[\x00-\x1f\x7f]/.test(name)),
});
export class WingListChanged extends Error {}

export async function listOwnWings(ownerId: string): Promise<WingSummary[]> {
  const groups = await prisma.flight.groupBy({ by: ["glider"], where: { ownerId }, _count: { _all: true }, orderBy: { glider: "asc" } });
  return groups.map(group => ({ name: group.glider, count: group._count._all }));
}

/** One update merges exact source names without cascading renames or changing other pilots' flights. */
export async function renameOwnWings(ownerId: string, edit: z.infer<typeof wingEditSchema>) {
  const sources = new Map(edit.sources.map(source => [source.name, source.count]));
  if (sources.size !== edit.sources.length) throw new WingListChanged();
  const where = { ownerId, OR: [...sources.keys()].map(glider => ({ glider })) };
  return prisma.$transaction(async tx => {
    const current = await tx.flight.groupBy({ by: ["glider"], where, _count: { _all: true } });
    if (current.length !== sources.size || current.some(group => group._count._all !== sources.get(group.glider))) {
      throw new WingListChanged();
    }
    // The target can be an existing wing; matching entries simply become one group.
    const changed = await tx.flight.updateMany({
      where: { ownerId, OR: [...sources.keys()].filter(glider => glider !== edit.target).map(glider => ({ glider })) },
      data: { glider: edit.target },
    });
    return changed.count;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000 });
}
