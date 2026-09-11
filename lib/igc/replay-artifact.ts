import type { DerivedMetrics, ParsedIgc } from "./types";
import { buildReplayPath, type ReplayResponse } from "./replay";
import { recordingGapSeconds } from "@/lib/flights/group-replay";
import type { GeoPoint } from "@/lib/flights/route-proximity";

export const REPLAY_ARTIFACT_VERSION = 4;
export interface ReplayArtifact {
  version: number;
  sourceHash: string;
  parserVersion: string;
  replay: ReplayResponse;
  matchingPaths: GeoPoint[][];
}

export function buildReplayArtifact(parsed: ParsedIgc, metrics: DerivedMetrics, sourceHash: string, parserVersion: string): ReplayArtifact {
  const path = buildReplayPath(parsed, metrics);
  const window = parsed.fixes.slice(metrics.takeoffIndex, metrics.landingIndex + 1);
  const threshold = recordingGapSeconds(window.map((f) => [f.lon, f.lat, 0, f.t]));
  const matchingPaths: GeoPoint[][] = [];
  window.forEach((f, index) => {
    if (index === 0 || f.t - window[index - 1].t > threshold) matchingPaths.push([]);
    matchingPaths.at(-1)!.push([f.lon, f.lat]);
  });
  return {
    version: REPLAY_ARTIFACT_VERSION, sourceHash, parserVersion, matchingPaths,
    replay: { ...path, gapThresholdS: Math.max(threshold, recordingGapSeconds(path.samples)), takeoffMs: metrics.takeoffAtMs, offsetMin: metrics.localUtcOffsetMinutes ?? 0 },
  };
}

export function readReplayArtifact(value: unknown, hash: string, parserVersion: string): ReplayArtifact | null {
  if (!value || typeof value !== "object") return null;
  const a = value as ReplayArtifact;
  return a.version === REPLAY_ARTIFACT_VERSION && a.sourceHash === hash && a.parserVersion === parserVersion
    && a.replay?.samples?.length >= 2 && Array.isArray(a.matchingPaths) ? a : null;
}
