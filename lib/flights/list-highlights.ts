import type { FlightListItem } from "./repo";
import { flightXcResults } from "./recording";
import { peakGainAboveLaunchM } from "./altitude-metrics";

/** Relative highlights: blue combines duration and peak gain above launch; green represents distance. */
export function listHighlights(flights: FlightListItem[]) {
  const ready = flights.filter(f => f.status === "ready");
  const maxDuration = Math.max(0, ...ready.map(f => f.durationS ?? 0));
  const launchGain = (f: FlightListItem) => peakGainAboveLaunchM(f) ?? 0;
  const maxLaunchGain = Math.max(0, ...ready.map(launchGain));
  const distance = (f: FlightListItem) => flightXcResults(f)[0]?.distanceM ?? f.straightDistM ?? 0;
  const maxDistance = Math.max(0, ...ready.map(distance));
  return {
    distanceScore: (f: FlightListItem) => f.status === "ready" && maxDistance > 0 ? Math.max(0, distance(f)) / maxDistance : 0,
    highlightScore: (f: FlightListItem) => {
      const dimensions = Number(maxDuration > 0) + Number(maxLaunchGain > 0);
      if (f.status !== "ready" || !dimensions) return 0;
      return ((maxDuration ? Math.max(0, f.durationS ?? 0) / maxDuration : 0)
        + (maxLaunchGain ? launchGain(f) / maxLaunchGain : 0)) / dimensions;
    },
  };
}
