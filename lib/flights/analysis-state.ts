import { readXcScore } from "@/lib/igc/xc-types";

export const METRICS_VERSION = 1;
export const XC_SCORING_VERSION = 2;
export const XC_CATEGORIES = ["open", "free-triangle", "fai-triangle"] as const;
export const WAITING_STATES = ["queued", "repair_queued", "improve_queued"];
export const RUNNING_STATES = ["processing", "repairing", "improving"];
export const analysisPending = (status: string) => [...WAITING_STATES, ...RUNNING_STATES].includes(status);

export interface AnalysisFlight {
  status: string;
  xcStatus: string;
  xcScore: unknown;
  xcError?: string | null;
  metricsVersion?: number;
}
export type AnalysisAction = "calculate" | "retry" | "complete" | "improve" | "repair";
export function analysisState(flight: AnalysisFlight): { label: string; action: AnalysisAction | null; detail: string; incomplete: boolean } {
  const result = flight.xcScore as { scoringVersion?: number; complete?: boolean; emptyReason?: string; completedCategories?: unknown; best?: unknown; candidates?: unknown } | null;
  const score = readXcScore(flight.xcScore);
  if (WAITING_STATES.includes(flight.xcStatus)) return { label: "Waiting", action: null, detail: "Queued for background processing. You can keep browsing.", incomplete: true };
  if (RUNNING_STATES.includes(flight.xcStatus)) return { label: flight.xcStatus === "repairing" ? "Repairing data…" : "Calculating…", action: null, detail: "Processing the original flight file.", incomplete: true };
  if (flight.xcStatus === "unavailable") return { label: "Unavailable", action: null, detail: flight.xcError || "The original flight data cannot be processed.", incomplete: true };
  if ((flight.metricsVersion ?? METRICS_VERSION) !== METRICS_VERSION) return { label: "Repair flight data", action: "repair", detail: "Rebuild missing or outdated measurements from the original IGC, then calculate XC.", incomplete: true };
  if (flight.status !== "ready") return { label: "Unreadable flight", action: null, detail: "The file has no usable flight track.", incomplete: true };
  if (flight.xcStatus === "failed") return { label: "Retry XC", action: "retry", detail: flight.xcError || "Couldn't calculate XC. Try again.", incomplete: true };
  if (flight.xcStatus === "unscored") return { label: "Calculate XC", action: "calculate", detail: "Calculate the three XC distance categories.", incomplete: true };
  if (result?.scoringVersion !== XC_SCORING_VERSION) return { label: "Update XC", action: "calculate", detail: "Update the stored result to check all three XC categories.", incomplete: true };
  const categories = result.completedCategories;
  if (flight.xcStatus === "partial" || result.complete !== true || !Array.isArray(categories) || !XC_CATEGORIES.every(category => categories.includes(category))) return { label: "Complete XC", action: "complete", detail: "Some categories are unfinished. Keep existing results and finish the remaining work.", incomplete: true };
  if (!score && !(result.best === null && Array.isArray(result.candidates) && result.candidates.length === 0 && ["no_eligible_route", "insufficient_track"].includes(result.emptyReason ?? ""))) return { label: "Update XC", action: "calculate", detail: "The stored result is incomplete or unsupported. Recalculate it from the original track.", incomplete: true };
  if (!score) return { label: "No eligible route", action: null, detail: result.emptyReason === "insufficient_track" ? "At least five usable GPS fixes are needed for XC scoring." : "All XC categories were checked; this track has no eligible scoring route.", incomplete: false };
  if (score.approximate) return { label: "Best found", action: "improve", detail: "All categories were checked. A longer search may improve these valid best-found distances.", incomplete: false };
  return { label: "Calculated", action: null, detail: "All XC categories have been checked.", incomplete: false };
}
