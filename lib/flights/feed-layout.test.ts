import { expect, it } from "vitest";
import { feedLayout } from "./feed-layout";
import { trophyGroups } from "./trophy-groups";
import type { FlightTrophy } from "./trophies";

const all: FlightTrophy[] = (["duration", "altitude", "launch-gain", "open", "free-triangle", "fai-triangle"] as const).map(category => ({ category, rank: 1, value: 100, approximate: false }));
it("only removes capacity and merges trophy groups as width decreases", () => {
  const mixed = all.map((trophy, index) => ({ ...trophy, rank: (Math.floor(index / 2) + 1) as 1 | 2 | 3 }));
  const sets = [all, mixed, all.slice(0, 2)];
  let previous = feedLayout(1200, sets);
  for (let width = 1199; width >= 80; width--) {
    const next = feedLayout(width, sets);
    expect(next.slots).toBeLessThanOrEqual(previous.slots);
    expect(next.trophies).toBeLessThanOrEqual(previous.trophies);
    if (!previous.upload) expect(next.upload).toBe(false);
    if (!previous.altitude) expect(next.altitude).toBe(false);
    if (previous.stacked) expect(next.stacked).toBe(true);
    if (previous.compactTrophies) expect(next.compactTrophies).toBe(true);
    for (const set of sets) {
      const groups = trophyGroups(set, next.slots);
      for (const group of trophyGroups(set, previous.slots)) {
        expect(groups.some(candidate => group.every(trophy => candidate.includes(trophy)))).toBe(true);
      }
    }
    previous = next;
  }
  expect(feedLayout(679, sets).slots).toBe(1);
  expect(feedLayout(679, sets).upload).toBe(true);
  expect(feedLayout(679, sets).altitude).toBe(true);
});
it("shows all six trophies with room and reclaims unused grouped slots", () => {
  expect(feedLayout(840, [all]).slots).toBe(6);
  expect(feedLayout(840, [all]).trophies).toBe(284);
  const narrow = feedLayout(700, [all]);
  expect(narrow.slots).toBeLessThan(6);
  expect(narrow.trophies).toBe(44);
  expect(feedLayout(700, [all, all.slice(0, 2)]).trophies).toBe(92);
});
it("applies ordered card-width transitions and preserves minimum badge space", () => {
  expect(feedLayout(640, [all]).compactTrophies).toBe(false);
  expect(feedLayout(640, [all]).trophies).toBe(44);
  expect(feedLayout(639, [all]).compactTrophies).toBe(true);
  expect(feedLayout(639, [all]).trophies).toBe(24);
  expect(feedLayout(600, [all]).upload).toBe(true);
  expect(feedLayout(599, [all]).upload).toBe(false);
  expect(feedLayout(400, [all]).altitude).toBe(true);
  expect(feedLayout(399, [all]).altitude).toBe(true);
  expect(feedLayout(359, [all]).stacked).toBe(true);
  expect(feedLayout(359, [all]).altitude).toBe(true);
  expect(feedLayout(300, [all]).altitude).toBe(true);
  expect(feedLayout(300, [all]).combinedBadges).toBe(false);
  expect(feedLayout(300, [all]).columns).toBe("minmax(0,1fr) 76px 32px 24px");
  expect(feedLayout(299, [all]).altitude).toBe(false);
  expect(feedLayout(299, [all]).combinedBadges).toBe(true);
  expect(feedLayout(299, [all]).columns).toBe("minmax(0,1fr) auto");
  expect(feedLayout(259, [all]).trophies).toBe(24);
  expect(feedLayout(259, [all]).compactTrophies).toBe(true);
  expect(feedLayout(320, [[]]).hasTrophies).toBe(false);
});
