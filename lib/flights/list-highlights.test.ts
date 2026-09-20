import { expect, it } from "vitest";
import type { FlightListItem } from "./repo";
import { listHighlights } from "./list-highlights";

function flight(id: string, values: Partial<FlightListItem> = {}): FlightListItem {
  return {
    id,
    status: "ready",
    durationS: 100,
    maxAltM: null,
    launchAltM: null,
    altGainM: null,
    straightDistM: null,
    xcScore: null,
    ...values,
  } as FlightListItem;
}

it("uses peak altitude above launch rather than cumulative ascent for blue highlighting", () => {
  const highPeak = flight("high-peak", { maxAltM: 1_500, launchAltM: 500, altGainM: 10 });
  const manyClimbs = flight("many-climbs", { maxAltM: 1_500, launchAltM: 1_400, altGainM: 10_000 });
  const { highlightScore } = listHighlights([highPeak, manyClimbs]);

  expect(highlightScore(highPeak)).toBe(1);
  expect(highlightScore(manyClimbs)).toBeCloseTo(0.55);
});

it("does not invent peak gain when either altitude is missing or inconsistent", () => {
  const reference = flight("reference", { maxAltM: 1_500, launchAltM: 500 });
  const missingLaunch = flight("missing-launch", { maxAltM: 2_000, altGainM: 2_000 });
  const belowLaunch = flight("below-launch", { maxAltM: 400, launchAltM: 500 });
  const { highlightScore } = listHighlights([reference, missingLaunch, belowLaunch]);

  expect(highlightScore(missingLaunch)).toBe(0.5);
  expect(highlightScore(belowLaunch)).toBe(0.5);
});
