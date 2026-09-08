import { expect, it } from "vitest";
import { xcRankings } from "./xc-rankings";
const route = (shape: string, distanceM: number) => ({ shape, distanceM, optimal: true });
const flight = (id: string, candidates: ReturnType<typeof route>[]) => ({
  id, status: "ready", xcScore: { version: 1, best: candidates[0], candidates },
});
it("ranks categories independently and uses only the longest candidate per category", () => {
  const result = xcRankings([
    flight("a", [route("open", 100), route("fai-triangle", 200), route("fai-triangle", 150)]),
    flight("b", [route("open", 200), route("fai-triangle", 100)]),
  ]);
  expect(result.get("a")?.map(b => [b.shape, b.rank, b.distanceM])).toEqual([["open", 2, 100], ["fai-triangle", 1, 200]]);
});
it("includes ties at tenth, excludes zero distances and unprocessed flights", () => {
  const flights = Array.from({ length: 12 }, (_, i) => flight(String(i), [route("open", 120 - i * 10)]));
  flights.push(flight("tie", [route("open", 30)]), flight("zero", [route("free-triangle", 0)]));
  const result = xcRankings([...flights, { ...flight("failed", [route("open", 1000)]), status: "failed" }]);
  expect(result.get("tie")?.[0].rank).toBe(10);
  expect(result.has("10")).toBe(false);
  expect(result.has("zero")).toBe(false);
  expect(result.has("failed")).toBe(false);
});
