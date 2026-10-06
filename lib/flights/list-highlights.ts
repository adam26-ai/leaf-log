import type { FlightListItem } from "./repo";
import { flightXcResults } from "./recording";
import { peakGainAboveLaunchM } from "./altitude-metrics";

export type HighlightFlight = Pick<FlightListItem, "status" | "durationS" | "maxAltM" | "launchAltM" | "straightDistM" | "xcScore" | "reportedXcDistanceM" | "reportedXcType">;

/** Relative highlights: blue combines duration and peak gain above launch; green represents distance. */
export function listHighlights(flights: HighlightFlight[]) {
  const ready = flights.filter(f => f.status === "ready");
  const maxDuration = Math.max(0, ...ready.map(f => f.durationS ?? 0));
  const launchGain = (f: HighlightFlight) => peakGainAboveLaunchM(f) ?? 0;
  const maxLaunchGain = Math.max(0, ...ready.map(launchGain));
  const distance = (f: HighlightFlight) => flightXcResults(f)[0]?.distanceM ?? f.straightDistM ?? 0;
  const maxDistance = Math.max(0, ...ready.map(distance));
  return {
    distanceScore: (f: HighlightFlight) => f.status === "ready" && maxDistance > 0 ? Math.max(0, distance(f)) / maxDistance : 0,
    highlightScore: (f: HighlightFlight) => {
      const dimensions = Number(maxDuration > 0) + Number(maxLaunchGain > 0);
      if (f.status !== "ready" || !dimensions) return 0;
      return ((maxDuration ? Math.max(0, f.durationS ?? 0) / maxDuration : 0)
        + (maxLaunchGain ? launchGain(f) / maxLaunchGain : 0)) / dimensions;
    },
  };
}
