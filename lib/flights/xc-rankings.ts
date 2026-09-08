import { readXcScore, type XcShape } from "@/lib/igc/xc-types";

export interface XcBadge {
  shape: XcShape;
  rank: number;
  distanceM: number;
  approximate: boolean;
}

/** Rank each flight's longest credited route in each category, across the full logbook. */
export function xcRankings(flights: { id: string; status: string; xcScore: unknown }[]) {
  const badges = new Map<string, XcBadge[]>();
  for (const shape of ["open", "fai-triangle", "free-triangle"] as const) {
    const entries = flights.flatMap(flight => {
      if (flight.status !== "ready") return [];
      const score = readXcScore(flight.xcScore);
      const route = score?.candidates?.filter(c => c.shape === shape && Number.isFinite(c.distanceM) && c.distanceM > 0)
        .sort((a, b) => b.distanceM - a.distanceM)[0];
      return route ? [{ id: flight.id, distanceM: route.distanceM, approximate: !route.optimal }] : [];
    }).sort((a, b) => b.distanceM - a.distanceM || a.id.localeCompare(b.id));
    let rank = 0;
    entries.forEach((entry, index) => {
      // Equal distances share a rank, including ties at tenth place.
      if (index === 0 || entry.distanceM !== entries[index - 1].distanceM) rank = index + 1;
      if (rank > 10) return;
      const list = badges.get(entry.id) ?? [];
      list.push({ shape, rank, distanceM: entry.distanceM, approximate: entry.approximate });
      badges.set(entry.id, list);
    });
  }
  return badges;
}
