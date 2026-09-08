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
  return score.version === 1 && score.best && Number.isFinite(score.best.distanceM)
    && ["open", "free-triangle", "fai-triangle"].includes(score.best.shape) ? score : null;
}
