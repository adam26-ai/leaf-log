// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeXc, scoreXc } from "./xc";
import { parseIgc } from "./parse";
import { makeRealisticFlight } from "@/test/igc/make-igc";

const template = parseIgc(makeRealisticFlight().igc).fixes[0];
function track(vertices: [number, number][]) {
  const points: [number, number][] = [];
  for (let i = 1; i < vertices.length; i++) {
    for (let j = 0; j < 4; j++) points.push([
      vertices[i - 1][0] + (vertices[i][0] - vertices[i - 1][0]) * j / 4,
      vertices[i - 1][1] + (vertices[i][1] - vertices[i - 1][1]) * j / 4,
    ]);
  }
  points.push(vertices[vertices.length - 1]);
  return points.map(([lat, lon], i) => ({ ...template, lat, lon, valid: true, t: i * 60, timeMs: template.timeMs + i * 60000 }));
}
async function score(vertices: [number, number][]) {
  const fixes = track(vertices);
  return scoreXc(fixes, { takeoffIndex: 0, landingIndex: fixes.length - 1 });
}
describe("XC scoring", () => {
  it("credits out-and-return flights without declared turnpoints", async () => {
    const result = (await score([[0, 0], [0, 0.1], [0, 0]]))!;
    const open = result.candidates.find((candidate) => candidate.shape === "open")!;
    expect(open.distanceM).toBeGreaterThan(22000);
    expect(open.distanceM).toBeLessThan(22500);
    expect(open.vertices.length).toBeLessThanOrEqual(3);
  });
  it("selects a closed FAI triangle and keeps kilometres separate from points", async () => {
    const result = (await score([[0, 0], [0, 0.1], [0.0866, 0.05], [0, 0]]))!;
    expect(result.best.shape).toBe("fai-triangle");
    expect(result.best.multiplier).toBe(1.6);
    expect(result.best.distanceM).toBeGreaterThan(33000);
    expect(result.best.distanceM).toBeLessThan(34000);
    expect(result.best.points).toBeCloseTo(result.best.distanceM / 1000 * 1.6, 1);
    expect(result.best.closingGapM).toBe(0);
  });
  it("recognizes a free triangle whose short side fails the FAI proportion", async () => {
    const result = (await score([[0, 0], [0, 0.2], [0.02, 0.02], [0, 0]]))!;
    expect(result.candidates.some((item) => item.shape === "free-triangle")).toBe(true);
    expect(result.best.shape).toBe("free-triangle");
  });
  it("does not fabricate distance for stationary or invalid fixes", async () => {
    expect(await score([[0, 0], [0, 0], [0, 0]])).toBeNull();
    const fixes = track([[0, 0], [0, 0.1]]).map((fix) => ({ ...fix, valid: false }));
    expect(await scoreXc(fixes, { takeoffIndex: 0, landingIndex: fixes.length - 1 })).toBeNull();
  });
  it("records stationary tracks as evaluated empty results, not unfinished work", async () => {
    const fixes = track([[0, 0], [0, 0], [0, 0]]);
    expect(await analyzeXc(fixes, { takeoffIndex: 0, landingIndex: fixes.length - 1 }))
      .toMatchObject({ score: null, complete: true, emptyReason: "no_eligible_route", completedCategories: ["open", "free-triangle", "fai-triangle"] });
  });
});
