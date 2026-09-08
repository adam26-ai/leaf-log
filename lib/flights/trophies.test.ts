import { expect, it } from "vitest";
import { flightTrophies } from "./trophies";
const flight = (id: string, value: number) => ({ id, status: "ready", durationS: value, maxAltM: value, launchAltM: 10, xcScore: null });
it("awards only gold silver bronze, including shared ranks", () => {
  const result = flightTrophies([flight("a", 100), flight("b", 90), flight("c", 80), flight("tie", 80), flight("d", 70)]);
  expect(result.a).toHaveLength(3);
  expect(result.a.every(t => t.rank === 1)).toBe(true);
  expect(result.tie.every(t => t.rank === 3)).toBe(true);
  expect(result.d).toBeUndefined();
});
it("ranks gain from launch separately and does not invent missing metrics", () => {
  const result = flightTrophies([{ ...flight("high", 2000), launchAltM: 1800 }, { ...flight("gain", 1500), launchAltM: 100 }, { ...flight("missing", 5000), launchAltM: null, status: "failed" }]);
  expect(result.high.find(t => t.category === "altitude")?.rank).toBe(1);
  expect(result.gain.find(t => t.category === "launch-gain")).toMatchObject({ rank: 1, value: 1400 });
  expect(result.missing).toBeUndefined();
});
it("uses the longest valid XC candidate in each category", () => {
  const open = { shape: "open", distanceM: 10000, optimal: true };
  const result = flightTrophies([{ ...flight("xc", 100), xcScore: { version: 1, best: open, candidates: [open, { ...open, distanceM: 5000 }, { shape: "fai-triangle", distanceM: 12000, optimal: false }] } }]);
  expect(result.xc.find(t => t.category === "open")?.value).toBe(10000);
  expect(result.xc.find(t => t.category === "fai-triangle")?.approximate).toBe(true);
});
