import type { FlightListItem } from "./repo";
import { flightXcResults } from "./recording";

/** Relative highlights for the flights displayed in a list. */
export function listHighlights(flights: FlightListItem[]) {
  const ready = flights.filter(f => f.status === "ready");
  const maxDuration = Math.max(0, ...ready.map(f => f.durationS ?? 0));
  const maxGain = Math.max(0, ...ready.map(f => f.altGainM ?? 0));
  const distance = (f: FlightListItem) => flightXcResults(f)[0]?.distanceM ?? f.straightDistM ?? 0;
  const maxDistance = Math.max(0, ...ready.map(distance));
  return {
    distanceScore: (f: FlightListItem) => f.status === "ready" && maxDistance > 0 ? Math.max(0, distance(f)) / maxDistance : 0,
    highlightScore: (f: FlightListItem) => {
      const dimensions = Number(maxDuration > 0) + Number(maxGain > 0);
      if (f.status !== "ready" || !dimensions) return 0;
      return ((maxDuration ? Math.max(0, f.durationS ?? 0) / maxDuration : 0)
        + (maxGain ? Math.max(0, f.altGainM ?? 0) / maxGain : 0)) / dimensions;
    },
  };
}
