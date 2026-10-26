import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { METRICS_VERSION, analysisPending } from "@/lib/flights/analysis-state";
import { parseIgc } from "@/lib/igc/parse";
import { detectFlightWindow } from "@/lib/igc/detect";
import { recordAltitude } from "@/lib/igc/altitude";
import { launchAltitude } from "@/lib/igc/repair-flight";

export const LAUNCH_ALTITUDE_JOB = "2026-10-26-startup-zero-launch-altitude";

export interface LaunchRepairOptions {
  apply?: boolean;
  once?: boolean;
  batchSize?: number;
  report?: (flightId: string, reason: string) => void;
}

/** Offline only: inspect stored zero baselines and update proven recoveries.
 * Each write compares the original source and measurement state. Other fields,
 * original bytes, render artifacts and XC scores are never rewritten.
 */
export async function repairLaunchAltitudes(options: LaunchRepairOptions = {}) {
  const { apply = false, once = false, batchSize = 100, report = () => {} } = options;
  if (once && !apply) throw new Error("--once requires --apply");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error("Batch size must be between 1 and 500");
  const result = { scanned: 0, matched: 0, repaired: 0, unchanged: 0, review: 0, deferred: 0, alreadyCompleted: false };
  if (once && await prisma.maintenanceJob.findUnique({ where: { id: LAUNCH_ALTITUDE_JOB } })) {
    return { ...result, alreadyCompleted: true };
  }

  let afterId: string | undefined;
  while (true) {
    const flights = await prisma.flight.findMany({
      where: { recordingKind: "igc", status: "ready", launchAltM: 0, metricsVersion: METRICS_VERSION,
        igcSha256: { not: null }, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: "asc" }, take: batchSize,
      select: { id: true, igcSha256: true, takeoffAt: true, landingAt: true, maxAltM: true,
        parserVersion: true, xcStatus: true, xcStartedAt: true },
    });
    if (!flights.length) break;
    for (const flight of flights) {
      result.scanned++;
      if (analysisPending(flight.xcStatus)) {
        result.deferred++;
        report(flight.id, "Processing is pending; leave for the next run");
        continue;
      }
      // Fetch one original at a time, rather than a page of potentially large files.
      const data = await prisma.flightData.findUnique({ where: { flightId: flight.id }, select: { rawIgc: true } });
      if (!data?.rawIgc.length || createHash("sha256").update(data.rawIgc).digest("hex") !== flight.igcSha256) {
        result.review++;
        report(flight.id, "Original missing or source hash does not match");
        continue;
      }
      const parsed = parseIgc(new Uint8Array(data.rawIgc));
      const { takeoffIndex, landingIndex } = detectFlightWindow(parsed.fixes);
      const window = parsed.fixes.slice(takeoffIndex, landingIndex + 1);
      if (!window.length || window[0].timeMs !== flight.takeoffAt?.getTime()
        || window.at(-1)!.timeMs !== flight.landingAt?.getTime()) {
        result.review++;
        report(flight.id, "Recorded flight window differs from saved measurements");
        continue;
      }
      if (recordAltitude(window[0]) !== 0) {
        result.review++;
        report(flight.id, "Saved zero is not the recorded launch reading");
        continue;
      }
      const corrected = launchAltitude(window);
      if (corrected === 0) { result.unchanged++; continue; }
      if (corrected == null || flight.maxAltM == null || Math.round(corrected) > flight.maxAltM) {
        result.review++;
        report(flight.id, "No usable launch correction consistent with saved peak altitude");
        continue;
      }
      const launchAltM = Math.round(corrected);
      if (launchAltM === 0) { result.unchanged++; continue; }
      result.matched++;
      if (!apply) continue;
      const updated = await prisma.flight.updateMany({
        where: { id: flight.id, recordingKind: "igc", status: "ready", launchAltM: 0, metricsVersion: METRICS_VERSION,
          igcSha256: flight.igcSha256, parserVersion: flight.parserVersion,
          takeoffAt: flight.takeoffAt, landingAt: flight.landingAt, maxAltM: flight.maxAltM,
          xcStatus: flight.xcStatus, xcStartedAt: flight.xcStartedAt },
        data: { launchAltM },
      });
      if (updated.count) result.repaired++;
      else {
        result.deferred++;
        report(flight.id, "Measurements changed during repair; leave for the next run");
      }
    }
    afterId = flights.at(-1)!.id;
  }
  // Unexpected errors propagate without a marker. Retrying is safe because only
  // still-zero flights are candidates. Busy/racing flights also keep the job open.
  if (once && !result.deferred) {
    await prisma.maintenanceJob.createMany({ data: [{ id: LAUNCH_ALTITUDE_JOB }], skipDuplicates: true });
  }
  return result;
}
