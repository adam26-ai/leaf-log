import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseIgc } from "./parse";
import { deriveMetrics } from "./derive";
import { scoreXc } from "./xc";

// The transaction lock makes this a single consumer even across server instances.
// A process crash rolls back the transaction, leaving the flight queued.
export async function processNextXcJob() {
  return prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(73421, 1) AS locked`;
    if (!lock.locked) return false;
    const flight = await tx.flight.findFirst({
      where: { xcStatus: "queued" }, orderBy: [{ xcQueuedAt: "asc" }, { id: "asc" }],
      select: { id: true, data: { select: { rawIgc: true } } },
    });
    if (!flight) return false;
    try {
      if (!flight.data?.rawIgc) throw new Error("Missing IGC data");
      const parsed = parseIgc(new Uint8Array(flight.data.rawIgc));
      const metrics = deriveMetrics(parsed);
      if (!metrics) throw new Error("No usable flight track");
      const score = await scoreXc(parsed.fixes, metrics);
      await tx.flight.update({ where: { id: flight.id }, data: {
        xcScore: score ? (score as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        xcStatus: "ready", xcError: null,
      } });
    } catch (error) {
      await tx.flight.update({ where: { id: flight.id }, data: {
        xcStatus: "failed", xcError: error instanceof Error ? error.message.slice(0, 500) : "Scoring failed",
      } });
    }
    return true;
  }, { timeout: 30_000, maxWait: 5_000 });
}

const queueGlobal = globalThis as typeof globalThis & { leafXcQueueStarted?: boolean };
export function startXcQueue() {
  if (queueGlobal.leafXcQueueStarted) return;
  queueGlobal.leafXcQueueStarted = true;
  async function tick() {
    let worked = false;
    try { worked = await processNextXcJob(); }
    catch (error) { console.error("XC queue:", error); }
    setTimeout(tick, worked ? 100 : 3000).unref();
  }
  setTimeout(tick, 1000).unref();
}
