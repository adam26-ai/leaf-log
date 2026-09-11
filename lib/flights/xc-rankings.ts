import type { XcShape } from "@/lib/igc/xc-types";
import { flightXcResults, type RecordingFields } from "./recording";

export interface XcBadge {
  shape: XcShape;
  rank: number;
  distanceM: number;
  approximate: boolean;
  reported?: boolean;
}

/** Rank each flight's longest credited route in each category, across the full logbook. */
export function xcRankings(flights: (RecordingFields & { id: string; status: string; xcScore: unknown })[]) {
  const badges = new Map<string, XcBadge[]>();
  for (const shape of ["open", "fai-triangle", "free-triangle"] as const) {
    const entries = flights.flatMap(flight => {
      if (flight.status !== "ready") return [];
      const route = flightXcResults(flight).find(route => route.shape === shape);
      return route ? [{ id: flight.id, distanceM: route.distanceM, approximate: route.approximate, reported: route.reported }] : [];
    }).sort((a, b) => b.distanceM - a.distanceM || a.id.localeCompare(b.id));
    let rank = 0;
    entries.forEach((entry, index) => {
      // Equal distances share a rank, including ties at tenth place.
      if (index === 0 || entry.distanceM !== entries[index - 1].distanceM) rank = index + 1;
      if (rank > 10) return;
      const list = badges.get(entry.id) ?? [];
      list.push({ shape, rank, distanceM: entry.distanceM, approximate: entry.approximate, ...(entry.reported ? { reported: true } : {}) });
      badges.set(entry.id, list);
    });
  }
  return badges;
}
