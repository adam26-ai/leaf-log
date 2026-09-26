export type ReplayRgb = [number, number, number];

export const REPLAY_WHITE: ReplayRgb = [255, 255, 255];
export const REPLAY_CLIMB_GREEN: ReplayRgb = [216, 255, 0];
export const REPLAY_SINK_BLUE: ReplayRgb = [0, 153, 255];

export interface VarioReplayScale {
  climbSaturationMs: number;
  sinkSaturationMs: number;
}

const DEFAULT_VARIO_SCALE: VarioReplayScale = {
  climbSaturationMs: 3.5,
  sinkSaturationMs: 3.5,
};

function lerpRgb(from: ReplayRgb, to: ReplayRgb, amount: number): ReplayRgb {
  return from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  ) as ReplayRgb;
}

/** Saturate each side at the requested fraction of that flight's peak rate. */
export function varioReplayScale(
  values: readonly number[],
  peaks?: { maxClimbMs?: number; maxSinkMs?: number },
  saturationFraction = 0.75,
): VarioReplayScale {
  const finite = values.filter(Number.isFinite);
  const suppliedMaxClimbMs = peaks?.maxClimbMs;
  const suppliedMaxSinkMs = peaks?.maxSinkMs;
  const maxClimbMs = typeof suppliedMaxClimbMs === "number" && Number.isFinite(suppliedMaxClimbMs)
    ? Math.max(0, suppliedMaxClimbMs)
    : Math.max(0, ...finite);
  const maxSinkMagnitudeMs = typeof suppliedMaxSinkMs === "number" && Number.isFinite(suppliedMaxSinkMs)
    ? Math.max(0, -suppliedMaxSinkMs)
    : Math.max(0, ...finite.map((value) => -value));
  return {
    climbSaturationMs: maxClimbMs * saturationFraction,
    sinkSaturationMs: maxSinkMagnitudeMs * saturationFraction,
  };
}

/** White at zero, Leaf chartreuse in lift, electric blue in sink. */
export function varioReplayColor(
  varioMs: number,
  scale: VarioReplayScale = DEFAULT_VARIO_SCALE,
): ReplayRgb {
  if (!Number.isFinite(varioMs)) return REPLAY_WHITE;
  const saturationMs = varioMs >= 0
    ? scale.climbSaturationMs
    : scale.sinkSaturationMs;
  const amount = saturationMs > 0
    ? Math.min(1, Math.max(0, Math.abs(varioMs) / saturationMs))
    : 0;
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
