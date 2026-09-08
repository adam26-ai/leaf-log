import { Worker } from "node:worker_threads";
import path from "node:path";
import type { DerivedMetrics, Fix } from "./types";
import type { XcScore } from "./xc-types";

/** Original valid fixes, restricted to the detected airborne window; no resampling. */
export async function scoreXc(fixes: Fix[], metrics: Pick<DerivedMetrics, "takeoffIndex" | "landingIndex">): Promise<XcScore | null> {
  const usable = fixes.slice(metrics.takeoffIndex, metrics.landingIndex + 1)
    .filter((fix) => fix.valid && Number.isFinite(fix.lat) && Number.isFinite(fix.lon));
  if (usable.length < 5) return null;
  return new Promise((resolve, reject) => {
    let best: XcScore | null = null;
    const worker = new Worker(path.join(process.cwd(), "lib/igc/xc-worker.cjs"), {
      workerData: { fixes: usable.map((fix) => ({
        latitude: fix.lat, longitude: fix.lon, timestamp: fix.timeMs,
        valid: true, pressureAltitude: fix.baroAlt, gpsAltitude: fix.gpsAlt,
      })) },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let finishing = false;
    const timer = setTimeout(async () => {
      finishing = true;
      await worker.terminate();
      if (best) resolve({ ...best, approximate: true });
      else reject(new Error("XC scoring exceeded its time limit"));
    }, 15000);
    worker.on("message", async (message: XcScore | null | { progress: XcScore }) => {
      if (finishing) return;
      if (message && "progress" in message) { best = message.progress; return; }
      finishing = true;
      clearTimeout(timer);
      await worker.terminate();
      resolve(message);
    });
    worker.once("error", async error => {
      if (finishing) return;
      finishing = true;
      clearTimeout(timer);
      await worker.terminate();
      reject(error);
    });
    worker.once("exit", code => {
      if (finishing) return;
      clearTimeout(timer);
      reject(new Error(`XC worker exited without a result (${code})`));
    });
  });
}
