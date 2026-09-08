import type { ReplayResponse } from "@/lib/igc/replay";
import { locateSample, type Sample } from "@/lib/igc/interpolate";

export interface ReplayPilot {
  id: string;
  handle: string;
  displayName: string;
  avatarUpdatedAt: string | null;
}

export interface CompanionFlight {
  id: string;
  owner: ReplayPilot;
  takeoffMs: number;
  landingMs: number;
  xcScore: unknown;
}

export interface CompanionManifest {
  flights: CompanionFlight[];
  nextCursor: string | null;
}

export type ReplayState = "On Launch" | "Flying" | "Landed" | "Recording gap";

/** A gap is at least 30 seconds and five times the recorder's median cadence. */
export function recordingGapSeconds(samples: Sample[]): number {
  const steps = samples.slice(1).map((s, i) => s[3] - samples[i][3]).filter((d) => d > 0);
  steps.sort((a, b) => a - b);
  return Math.max(30, (steps[Math.floor(steps.length / 2)] ?? 1) * 5);
}

export function replayStateAt(replay: ReplayResponse, localTime: number): ReplayState {
  if (localTime < 0) return "On Launch";
  if (localTime >= replay.durationS) return "Landed";
  if (replay.samples.length < 2) return "Recording gap";
  const { i } = locateSample(replay.samples, localTime);
  const a = replay.samples[i - 1], b = replay.samples[i];
  const threshold = replay.gapThresholdS ?? 30;
  return b[3] - a[3] > threshold && localTime > a[3] && localTime < b[3]
    ? "Recording gap" : "Flying";
}

/** Hold at the last known point during missing data instead of inventing a trip. */
export function replayPositionAt(replay: ReplayResponse, localTime: number): [number, number, number] {
  if (replay.samples.length < 2) {
    const first = replay.samples[0];
    return first ? [first[0], first[1], first[2]] : [0, 0, 0];
  }
  const { i, f } = locateSample(replay.samples, localTime);
  const a = replay.samples[i - 1], b = replay.samples[i];
  const fraction = replayStateAt(replay, localTime) === "Recording gap" ? 0 : f;
  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, a[2] + (b[2] - a[2]) * fraction];
}

export function splitReplaySamples(replay: ReplayResponse): Sample[][] {
  const paths: Sample[][] = [];
  for (const sample of replay.samples) {
    const path = paths.at(-1);
    if (!path || sample[3] - path.at(-1)![3] > (replay.gapThresholdS ?? 30)) paths.push([sample]);
    else path.push(sample);
  }
  return paths;
}

export function groupTimeBounds(flights: Pick<CompanionFlight, "takeoffMs" | "landingMs">[]) {
  return {
    startMs: Math.min(...flights.map((f) => f.takeoffMs)),
    endMs: Math.max(...flights.map((f) => f.landingMs)),
  };
}

/** Stable choice between successive flights. An explicit flight wins in overlaps. */
export function flightForPilot<T extends CompanionFlight>(flights: T[], timeMs: number, preferredId?: string): T {
  const active = flights.filter((f) => f.takeoffMs <= timeMs && f.landingMs > timeMs);
  if (active.length) return active.find((f) => f.id === preferredId) ?? active[0];
  return [...flights].sort((a, b) => {
    const distance = (f: T) => Math.max(f.takeoffMs - timeMs, timeMs - f.landingMs, 0);
    return distance(a) - distance(b) || a.takeoffMs - b.takeoffMs || a.id.localeCompare(b.id);
  })[0];
}
