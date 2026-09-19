import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { applyWingTandemDefault, lockWingSettings, wingIsTandem } from "./tandem";

export interface WingSummary { name: string | null; count: number; durationS?: number; hidden?: boolean; tandem?: boolean }
export const wingEditSchema = z.object({
  sources: z.array(z.object({ name: z.string().max(10000).nullable(), count: z.number().int().positive() })).min(1).max(1000),
  target: z.string().trim().min(1).max(200).refine(name => !/[\x00-\x1f\x7f]/.test(name)),
  tandem: z.boolean().optional(),
});
export class WingListChanged extends Error {}

export async function listOwnWings(ownerId: string): Promise<WingSummary[]> {
  const groups = await prisma.flight.groupBy({ by: ["glider"], where: { ownerId }, _count: { _all: true }, _sum: { durationS: true }, orderBy: { glider: "asc" } });
  const profile = await prisma.profile.findUnique({ where: { id: ownerId }, select: { hiddenWings: true, tandemWings: true } });
  return groups.map(group => ({ name: group.glider, count: group._count._all, durationS: group._sum.durationS ?? 0, hidden: group.glider != null && (profile?.hiddenWings.includes(group.glider) ?? false), tandem: wingIsTandem(profile?.tandemWings ?? [], group.glider) }));
}

/** One update merges exact source names without cascading renames or changing other pilots' flights. */
export async function renameOwnWings(ownerId: string, edit: z.infer<typeof wingEditSchema>) {
  const sources = new Map(edit.sources.map(source => [source.name, source.count]));
  if (sources.size !== edit.sources.length) throw new WingListChanged();
  const where = { ownerId, OR: [...sources.keys()].map(glider => ({ glider })) };
  return prisma.$transaction(async tx => {
    const settings = await lockWingSettings(tx, ownerId);
    const current = await tx.flight.groupBy({ by: ["glider"], where, _count: { _all: true } });
    if (current.length !== sources.size || current.some(group => group._count._all !== sources.get(group.glider))) {
      throw new WingListChanged();
    }
    const profile = await tx.profile.findUnique({ where: { id: ownerId }, select: { hiddenWings: true } });
    const hidden = profile?.hiddenWings ?? [];
    const targetExists = await tx.flight.count({ where: { ownerId, glider: edit.target } });
    const keepHidden = targetExists ? hidden.includes(edit.target) : [...sources.keys()].every(name => name != null && hidden.includes(name));
    const merging = sources.size > 1 || (targetExists > 0 && !sources.has(edit.target));
    if (merging && settings.tandemEnabled && edit.tandem === undefined) throw new WingListChanged();
    const tandem = merging && settings.tandemEnabled ? edit.tandem!
      : wingIsTandem(settings.tandemWings, edit.target) || [...sources.keys()].some(name => wingIsTandem(settings.tandemWings, name));
    await tx.profile.update({ where: { id: ownerId }, data: {
      hiddenWings: [...hidden.filter(name => !sources.has(name) && name !== edit.target), ...(keepHidden ? [edit.target] : [])],
      tandemWings: [...settings.tandemWings.filter(name => !sources.has(name) && name !== edit.target), ...(tandem ? [edit.target] : [])],
    } });
    // The target can be an existing wing; matching entries simply become one group.
    const changed = await tx.flight.updateMany({
      where: { ownerId, OR: [...sources.keys()].filter(glider => glider !== edit.target).map(glider => ({ glider })) },
      data: { glider: edit.target },
    });
    await applyWingTandemDefault(tx, ownerId, edit.target, tandem);
    return changed.count;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000 });
}
