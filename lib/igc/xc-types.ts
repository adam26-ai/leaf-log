export type XcShape = "open" | "free-triangle" | "fai-triangle";
export interface XcPoint { lat: number; lon: number; timeMs: number }
export interface XcCandidate {
  shape: XcShape;
  name: string;
  distanceM: number;
  points: number;
  multiplier: number;
  optimal: boolean;
  closingGapM: number;
  vertices: XcPoint[];
  start: XcPoint | null;
  finish: XcPoint | null;
}
export interface XcScore {
  version: 1;
  rules: "XContest";
  approximate: boolean;
  best: XcCandidate;
  candidates: XcCandidate[];
}

export function readXcScore(value: unknown): XcScore | null {
  if (!value || typeof value !== "object") return null;
  const score = value as XcScore;
  const validRoute = (route: XcCandidate) => route && Number.isFinite(route.distanceM) && route.distanceM >= 0
    && ["open", "free-triangle", "fai-triangle"].includes(route.shape);
  return score.version === 1 && validRoute(score.best) && Array.isArray(score.candidates)
    && score.candidates.every(validRoute) ? score : null;
}
