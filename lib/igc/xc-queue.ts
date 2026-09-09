import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { METRICS_VERSION, WAITING_STATES, RUNNING_STATES } from "../flights/analysis-state";
import { PARSER_VERSION } from "../ingest/ingest-flight";
import { parseIgc } from "./parse";
import { deriveMetrics } from "./derive";
import { analyzeXc } from "./xc";
import { completedXcCategories, mergeXcResults, storedXcAnalysis } from "./xc-result";
import { repairedMeasurements } from "./repair-flight";
import { buildTrackArtifact } from "./track-artifact";
import { buildReplayArtifact } from "./replay-artifact";

// Claim under a short global lock, then release the transaction while scoring.
// A two-minute lease recovers interrupted jobs; bounded workers run at most 45s.
export async function processNextXcJob() {
  const flight = await prisma.$transaction(async tx => {
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(73421, 1) AS locked`;
    if (!lock.locked) return null;
    const stale = new Date(Date.now() - 120_000);
    for (let i = 0; i < RUNNING_STATES.length; i++) {
      await tx.flight.updateMany({ where: { xcStatus: RUNNING_STATES[i], OR: [{ xcStartedAt: { lt: stale } }, { xcStartedAt: null }] },
        data: { xcStatus: WAITING_STATES[i], xcStartedAt: null } });
    }
    if (await tx.flight.findFirst({ where: { xcStatus: { in: RUNNING_STATES } }, select: { id: true } })) return null;
    const queued = await tx.flight.findFirst({ where: { xcStatus: { in: WAITING_STATES } },
      orderBy: [{ xcQueuedAt: "asc" }, { id: "asc" }] });
    if (!queued) return null;
    return tx.flight.update({ where: { id: queued.id }, data: {
      xcStatus: RUNNING_STATES[WAITING_STATES.indexOf(queued.xcStatus)], xcStartedAt: new Date(),
    } });
  }, { maxWait: 10_000, timeout: 10_000 });
  if (!flight) return false;
  const lease = { id: flight.id, xcStatus: flight.xcStatus, xcStartedAt: flight.xcStartedAt };
  try {
    const data = await prisma.flightData.findUnique({ where: { flightId: flight.id }, select: { rawIgc: true } });
    if (!data?.rawIgc.length) {
      await prisma.flight.updateMany({ where: lease, data: { xcStatus: "unavailable", xcStartedAt: null,
        xcError: "The original IGC file is missing, so this flight cannot be calculated." } });
      return true;
    }
    const parsed = parseIgc(new Uint8Array(data.rawIgc));
    const metrics = deriveMetrics(parsed);
    let previous: unknown = flight.xcScore;
    if (flight.metricsVersion !== METRICS_VERSION || flight.xcStatus === "repairing") {
      const repaired = await prisma.$transaction(async tx => {
        const updated = await tx.flight.updateMany({ where: lease, data: {
          ...repairedMeasurements(parsed, metrics), parserVersion: PARSER_VERSION, xcScore: Prisma.JsonNull,
        } });
        if (!updated.count) return false;
        await tx.flightData.update({ where: { flightId: flight.id }, data: {
          track: metrics ? buildTrackArtifact(parsed.fixes, metrics) as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
          replay: metrics ? buildReplayArtifact(parsed, metrics, flight.igcSha256, PARSER_VERSION) as unknown as Prisma.InputJsonValue : Prisma.JsonNull,
        } });
        return true;
      });
      if (!repaired) return true;
      previous = null;
    }
    if (!metrics) {
      await prisma.flight.updateMany({ where: lease, data: { xcStatus: "unavailable", xcStartedAt: null,
        xcError: "The original file has no usable GPS track." } });
      return true;
    }
    // A failed improvement may already have complete category coverage.
    const improve = flight.xcStatus === "improving" || completedXcCategories(previous).length === 3;
    const analysis = mergeXcResults(previous, await analyzeXc(parsed.fixes, metrics, {
      completedCategories: improve ? [] : completedXcCategories(previous),
      improve: improve || (previous as { complete?: boolean } | null)?.complete === false,
    }));
    await prisma.flight.updateMany({ where: lease, data: {
      xcScore: storedXcAnalysis(analysis) as unknown as Prisma.InputJsonValue,
      xcStatus: !analysis.complete ? "partial" : analysis.score ? "ready" : "empty", xcError: null, xcStartedAt: null,
    } });
  } catch (error) {
    console.error(`XC analysis failed for ${flight.id}:`, error);
    await prisma.flight.updateMany({ where: lease, data: { xcStatus: "failed", xcStartedAt: null,
      xcError: "Calculation was interrupted. Retry to continue; saved results are kept." } });
  }
  return true;
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
