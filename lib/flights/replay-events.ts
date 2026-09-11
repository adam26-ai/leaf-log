export const REPLAY_SEEK_EVENT = "leaf-replay-seek";
export const REPLAY_XC_TOGGLE_EVENT = "leaf-replay-xc-toggle";

export function toggleReplayXcRoute() {
  window.dispatchEvent(new Event(REPLAY_XC_TOGGLE_EVENT));
}

export type ReplayMetric = "max-altitude" | "best-climb" | "max-sink";

export function seekReplayToMetric(metric: ReplayMetric) {
  window.dispatchEvent(new CustomEvent<ReplayMetric>(REPLAY_SEEK_EVENT, { detail: metric }));
}
