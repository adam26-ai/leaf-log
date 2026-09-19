import { expect, it } from "vitest";
import { nextXcShape, replayXcRoutes } from "./xc-selection";
import type { XcCandidate, XcScore } from "@/lib/igc/xc-types";

const route = (shape: XcCandidate["shape"], distanceM = 1000): XcCandidate => ({ shape, distanceM, name: shape, points: 1, multiplier: 1, optimal: true, closingGapM: 0, start: null, finish: null, vertices: [{ lat: 1, lon: 1, timeMs: 0 }] });
const best = route("fai-triangle");
const score: XcScore = { version: 1, rules: "XContest", approximate: false, best, candidates: [route("open"), best, route("free-triangle")] };

it("cycles from the top score through each other category, then returns to hidden", () => {
  expect(replayXcRoutes(score).map(route => route.shape)).toEqual(["fai-triangle", "open", "free-triangle"]);
  expect(nextXcShape(score, null)).toBe("fai-triangle");
  expect(nextXcShape(score, "fai-triangle")).toBe("open");
  expect(nextXcShape(score, "open")).toBe("free-triangle");
  expect(nextXcShape(score, "free-triangle")).toBeNull();
  expect(nextXcShape(null, null)).toBeNull();
});

it("skips empty scores and categories with no drawable route", () => {
  expect(replayXcRoutes({ ...score, candidates: [route("open", 0), { ...route("free-triangle"), vertices: [] }] })).toEqual([best]);
  expect(nextXcShape({ ...score, candidates: [] }, "fai-triangle")).toBeNull();
});
