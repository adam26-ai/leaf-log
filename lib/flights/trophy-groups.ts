import type { FlightTrophy } from "./trophies";

/** Keep higher medals individual for as long as the row has room. */
export function trophyGroups(trophies: FlightTrophy[], slots: number): FlightTrophy[][] {
  let groups = [...trophies].sort((a, b) => a.rank - b.rank).map(trophy => [trophy]);
  const merge = (matches: (trophy: FlightTrophy) => boolean) => {
    const combined = groups.flat().filter(matches);
    groups = [...groups.filter(group => !matches(group[0])), ...(combined.length ? [combined] : [])];
    groups.sort((a, b) => a[0].rank - b[0].rank);
  };
  for (const rank of [3, 2, 1]) {
    if (groups.length <= Math.max(1, slots)) return groups;
    merge(trophy => trophy.rank === rank);
  }
  if (groups.length > Math.max(1, slots)) merge(trophy => trophy.rank >= 2);
  if (groups.length > Math.max(1, slots)) merge(() => true);
  return groups;
}
