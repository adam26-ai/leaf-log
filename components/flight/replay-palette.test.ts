import { describe, expect, it } from "vitest";
import {
  REPLAY_CLIMB_GREEN,
  REPLAY_SINK_BLUE,
  REPLAY_WHITE,
  varioReplayColor,
  varioReplayScale,
} from "./replay-palette";

describe("dynamic vario replay colors", () => {
  const scale = varioReplayScale(
    [0, 1.2, -0.8],
    { maxClimbMs: 4.6, maxSinkMs: -3.2 },
  );

  it("saturates climb and sink independently at 75% of the flight peaks", () => {
    expect(scale.climbSaturationMs).toBeCloseTo(3.45);
    expect(scale.sinkSaturationMs).toBeCloseTo(2.4);
    expect(varioReplayColor(3.45, scale)).toEqual(REPLAY_CLIMB_GREEN);
    expect(varioReplayColor(4.6, scale)).toEqual(REPLAY_CLIMB_GREEN);
    expect(varioReplayColor(-2.4, scale)).toEqual(REPLAY_SINK_BLUE);
    expect(varioReplayColor(-3.2, scale)).toEqual(REPLAY_SINK_BLUE);
  });

  it("interpolates linearly from white with no deadband", () => {
    expect(varioReplayColor(0, scale)).toEqual(REPLAY_WHITE);
    expect(varioReplayColor(scale.climbSaturationMs / 2, scale)).toEqual([236, 255, 128]);
    expect(varioReplayColor(-scale.sinkSaturationMs / 2, scale)).toEqual([128, 204, 255]);
    expect(varioReplayColor(0.01, scale)).not.toEqual(REPLAY_WHITE);
  });

  it("keeps a direction white when the flight has no peak on that side", () => {
    const climbOnly = varioReplayScale([0, 1, 2]);
    expect(varioReplayColor(-1, climbOnly)).toEqual(REPLAY_WHITE);
  });
});
