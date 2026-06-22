"use client";

import { useEffect, useState } from "react";
import type { TrackArtifact } from "@/lib/igc/track-artifact";
import type { ReplayResponse } from "@/lib/igc/replay";
import { TrackMap } from "./track-map";
import { Barograph } from "./barograph";
import { FlightReplay3D } from "./flight-replay-3d";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Fetches the 2D track artifact + the replay path, renders the map + barograph
 * with a 2D/3D toggle, and links a shared hover cursor across the barograph and
 * the active map (hover one, highlight the other).
 */
export function FlightViz({
  flightId,
  takeoffMs,
  offsetMin,
}: {
  flightId: string;
  takeoffMs: number;
  offsetMin: number;
}) {
  const [track, setTrack] = useState<TrackArtifact | null>(null);
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  // Shared linked-cursor time (seconds from takeoff), or null.
  const [activeTime, setActiveTime] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/flights/${flightId}/track`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => active && setTrack(d))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [flightId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/flights/${flightId}/replay`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => active && setReplay(d))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [flightId]);

  // Interpolate the [lon,lat] position at a given time from the replay samples.
  function posAt(t: number): [number, number] | null {
    const s = replay?.samples;
    if (!s || s.length === 0) return null;
    if (t <= s[0][3]) return [s[0][0], s[0][1]];
    for (let i = 1; i < s.length; i++) {
      if (s[i][3] >= t) {
        const a = s[i - 1];
        const b = s[i];
        const f = (t - a[3]) / (b[3] - a[3] || 1);
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      }
    }
    const l = s[s.length - 1];
    return [l[0], l[1]];
  }

  if (error) {
    return (
      <Card className="flex h-[420px] items-center justify-center text-gray-500">
        Track unavailable.
      </Card>
    );
  }
  if (!track) {
    return (
      <Card className="flex h-[420px] items-center justify-center text-gray-400">
        Loading flight…
      </Card>
    );
  }

  const cursor = activeTime != null ? posAt(activeTime) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="inline-flex w-fit rounded-md border border-gray-200 p-0.5">
          {(["2d", "3d"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded px-3 py-1 font-condensed text-sm font-bold transition-colors",
                mode === m ? "bg-ink text-paper" : "text-gray-600 hover:text-ink",
              )}
            >
              {m === "2d" ? "Map" : "3D replay"}
            </button>
          ))}
        </div>

        {mode === "2d" ? (
          <Card className="overflow-hidden">
            <TrackMap
              line={track.line}
              bounds={track.bounds}
              cursor={cursor}
              samples={replay?.samples ?? null}
              onHoverTime={setActiveTime}
            />
          </Card>
        ) : (
          <FlightReplay3D
            flightId={flightId}
            externalTime={activeTime}
            onHoverTime={setActiveTime}
          />
        )}
      </div>

      <Card className="p-4">
        <Barograph
          baro={track.baro}
          takeoffMs={takeoffMs}
          offsetMin={offsetMin}
          altSource={track.altSource}
          activeTime={activeTime}
          onHoverTime={setActiveTime}
        />
      </Card>
    </div>
  );
}
