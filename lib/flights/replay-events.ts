export const REPLAY_SEEK_EVENT = "leaf-replay-seek";
export const REPLAY_XC_TOGGLE_EVENT = "leaf-replay-xc-toggle";

export function toggleReplayXcRoute() {
  window.dispatchEvent(new Event(REPLAY_XC_TOGGLE_EVENT));
}

export type ReplayMetric = "max-altitude" | "best-climb" | "max-sink";

export function seekReplayToMetric(metric: ReplayMetric) {
  window.dispatchEvent(new CustomEvent<ReplayMetric>(REPLAY_SEEK_EVENT, { detail: metric }));
}

export const REPLAY_XC_SELECT_EVENT = "leaf-replay-xc-select";
export type XcSelection = { flightId: string; shape: import("@/lib/igc/xc-types").XcShape };
export function selectReplayXcRoute(flightId: string, shape: XcSelection["shape"]) {
  window.dispatchEvent(new CustomEvent<XcSelection>(REPLAY_XC_SELECT_EVENT, { detail: { flightId, shape } }));
}
