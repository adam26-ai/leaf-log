import { expect, it } from "vitest";
import { analysisState, XC_CATEGORIES } from "./analysis-state";
import { storedXcAnalysis, completedXcCategories, mergeXcResults } from "../igc/xc-result";
import type { XcCandidate, XcScore } from "../igc/xc-types";

const flight = { status: "ready", xcStatus: "ready", metricsVersion: 1, xcScore: null };
const empty = storedXcAnalysis({ score: null, completedCategories: [...XC_CATEGORIES], complete: true, emptyReason: "no_eligible_route" });
it("distinguishes an evaluated empty result from legacy, corrupt and unfinished results", () => {
  expect(analysisState(flight).action).toBe("calculate");
  expect(analysisState({ ...flight, xcScore: empty }).label).toBe("No eligible route");
  expect(analysisState({ ...flight, xcScore: { ...empty, emptyReason: null } }).action).toBe("calculate");
  expect(analysisState({ ...flight, xcScore: { ...empty, completedCategories: ["open"] } }).action).toBe("complete");
  expect(analysisState({ ...flight, xcScore: { ...empty, complete: false } }).incomplete).toBe(true);
});
it("prioritizes pending work and terminal data failures over repair prompts", () => {
  expect(analysisState({ ...flight, metricsVersion: 0 }).action).toBe("repair");
  expect(analysisState({ ...flight, metricsVersion: 0, xcStatus: "repair_queued" }).label).toBe("Waiting");
  expect(analysisState({ ...flight, metricsVersion: 0, xcStatus: "repairing" }).action).toBeNull();
  expect(analysisState({ ...flight, metricsVersion: 0, xcStatus: "unavailable" }).action).toBeNull();
  expect(analysisState({ ...flight, xcStatus: "failed" }).action).toBe("retry");
});
it("discards unsupported checkpoints and preserves checked categories without routes", () => {
  expect(completedXcCategories(empty)).toEqual(XC_CATEGORIES);
  expect(completedXcCategories({ ...empty, scoringVersion: 1 })).toEqual([]);
  expect(completedXcCategories({ ...empty, best: { broken: true } })).toEqual([]);
});
const route = (points: number, optimal = false): XcCandidate => ({ shape: "open", name: "Open distance", points,
  distanceM: points * 1000, multiplier: 1, optimal, closingGapM: 0, vertices: [], start: null, finish: null });
const score = (candidate: XcCandidate): XcScore => ({ version: 1, rules: "XContest", best: candidate, candidates: [candidate], approximate: !candidate.optimal });
it("never reduces a saved best-found route on retry and accepts improved proofs", () => {
  const analysis = { score: score(route(9)), completedCategories: [...XC_CATEGORIES], complete: true };
  expect(mergeXcResults(score(route(10)), analysis).score?.best.points).toBe(10);
  const improved = mergeXcResults(score(route(10)), { ...analysis, score: score(route(10, true)) });
  expect(improved.score?.candidates).toHaveLength(1);
  expect(improved.score?.approximate).toBe(false);
  expect(analysisState({ ...flight, xcScore: storedXcAnalysis(analysis) }).action).toBe("improve");
});
