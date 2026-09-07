export type ReplayRgb = [number, number, number];

export const REPLAY_WHITE: ReplayRgb = [255, 255, 255];
export const REPLAY_CLIMB_GREEN: ReplayRgb = [216, 255, 0];
export const REPLAY_SINK_BLUE: ReplayRgb = [0, 153, 255];

function lerpRgb(from: ReplayRgb, to: ReplayRgb, amount: number): ReplayRgb {
  return from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  ) as ReplayRgb;
}

/** White around neutral air, Leaf chartreuse in lift, electric blue in sink. */
export function varioReplayColor(varioMs: number): ReplayRgb {
  const deadband = 0.35;
  const amount = Math.min(1, Math.max(0, (Math.abs(varioMs) - deadband) / (3.5 - deadband)));
  return lerpRgb(REPLAY_WHITE, varioMs >= 0 ? REPLAY_CLIMB_GREEN : REPLAY_SINK_BLUE, amount);
}

/** Blue at the minimum, white at the midpoint, and green at the maximum. */
export function rangedReplayColor(value: number, min: number, max: number): ReplayRgb {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return REPLAY_WHITE;
  }
  const amount = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return amount <= 0.5
    ? lerpRgb(REPLAY_SINK_BLUE, REPLAY_WHITE, amount * 2)
    : lerpRgb(REPLAY_WHITE, REPLAY_CLIMB_GREEN, (amount - 0.5) * 2);
}

export function replayColorCss(color: ReplayRgb): string {
  return `rgb(${color.join(", ")})`;
}
