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
    const worker = new Worker(path.join(process.cwd(), "lib/igc/xc-worker.cjs"), {
      workerData: { fixes: usable.map((fix) => ({
        latitude: fix.lat, longitude: fix.lon, timestamp: fix.timeMs,
        valid: true, pressureAltitude: fix.baroAlt, gpsAltitude: fix.gpsAlt,
      })) },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("XC scoring exceeded its time limit"));
    }, 15000);
    worker.once("message", (score: XcScore | null) => { clearTimeout(timer); resolve(score); void worker.terminate(); });
    worker.once("error", (error) => { clearTimeout(timer); reject(error); });
    worker.once("exit", (code) => { clearTimeout(timer); if (code !== 0) reject(new Error(`XC worker exited (${code})`)); });
  });
}
