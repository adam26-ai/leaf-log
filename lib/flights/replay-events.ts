export const REPLAY_SEEK_EVENT = "leaf-replay-seek";

export type ReplayMetric = "max-altitude" | "best-climb" | "max-sink";

export function seekReplayToMetric(metric: ReplayMetric) {
  window.dispatchEvent(new CustomEvent<ReplayMetric>(REPLAY_SEEK_EVENT, { detail: metric }));
}
