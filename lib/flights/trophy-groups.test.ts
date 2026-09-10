import { expect, it } from "vitest";
import { trophyGroups } from "./trophy-groups";
import { TROPHY_LABELS, type FlightTrophy, type TrophyCategory } from "./trophies";

const trophies: FlightTrophy[] = Object.keys(TROPHY_LABELS).map((category, i) => ({ category: category as TrophyCategory, rank: (Math.floor(i / 2) + 1) as 1 | 2 | 3, value: 1000, approximate: false }));
it.each([
  [6, [[1], [1], [2], [2], [3], [3]]],
  [5, [[1], [1], [2], [2], [3, 3]]],
  [4, [[1], [1], [2, 2], [3, 3]]],
  [3, [[1, 1], [2, 2], [3, 3]]],
  [2, [[1, 1], [2, 2, 3, 3]]],
  [1, [[1, 1, 2, 2, 3, 3]]],
] as const)("fits %i slots while preserving every award and the requested grouping order", (slots, expected) => {
  const groups = trophyGroups(trophies, slots);
  expect(groups.map(group => group.map(trophy => trophy.rank))).toEqual(expected);
  expect(groups.flat()).toEqual(trophies);
});

it("keeps gold and bronze individual when there is no silver and enough space", () => {
  expect(trophyGroups([trophies[0], trophies[4]], 2)).toHaveLength(2);
  expect(trophyGroups([], 0)).toEqual([]);
});
