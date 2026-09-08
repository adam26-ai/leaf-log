import { XC_CATEGORIES, XC_SCORING_VERSION } from "../flights/analysis-state";
import { readXcScore, type XcCandidate, type XcScore, type XcShape } from "./xc-types";

export interface XcAnalysis {
  score: XcScore | null;
  completedCategories: XcShape[];
  complete: boolean;
  emptyReason?: string;
}
export function completedXcCategories(value: unknown): XcShape[] {
  const stored = value as { scoringVersion?: number; completedCategories?: unknown } | null;
  const categories = stored?.completedCategories;
  const result = value as { best?: unknown; candidates?: unknown; emptyReason?: unknown } | null;
  const valid = readXcScore(value) || (result?.best === null && Array.isArray(result.candidates) && result.candidates.length === 0);
  return valid && stored?.scoringVersion === XC_SCORING_VERSION && Array.isArray(categories)
    ? XC_CATEGORIES.filter(category => categories.includes(category)) : [];
}
export function storedXcAnalysis(result: XcAnalysis) {
  return { ...(result.score ?? { version: 1, rules: "XContest", best: null, candidates: [] }),
    scoringVersion: XC_SCORING_VERSION, completedCategories: result.completedCategories,
    complete: result.complete, emptyReason: result.emptyReason ?? null };
}
/** A retry must never replace a valid route with a shorter best-found route. */
export function mergeXcResults(previous: unknown, next: XcAnalysis): XcAnalysis {
  const old = readXcScore(previous);
  const routes = [...(old?.candidates ?? []), ...(next.score?.candidates ?? [])]
    .filter(route => Number.isFinite(route.points) && Number.isFinite(route.multiplier));
  const bestByRule = new Map<string, XcCandidate>();
  for (const route of routes) {
    const key = `${route.shape}:${route.multiplier}`;
    const saved = bestByRule.get(key);
    const improvement = saved ? route.points - saved.points || route.distanceM - saved.distanceM
      || Number(route.optimal) - Number(saved.optimal) : 1;
    if (improvement >= 0) bestByRule.set(key, route);
  }
  const candidates = [...bestByRule.values()].sort((a, b) => b.points - a.points || b.distanceM - a.distanceM);
  return { ...next, score: candidates.length ? { version: 1, rules: "XContest",
    best: candidates[0], candidates, approximate: !next.complete || candidates.some(route => !route.optimal) } : null };
}
