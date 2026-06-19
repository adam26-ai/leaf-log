"use client";

import { useEffect, useState } from "react";
import type { TrackArtifact } from "@/lib/igc/track-artifact";
import { TrackMap } from "./track-map";
import { Barograph } from "./barograph";
import { FlightReplay3D } from "./flight-replay-3d";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Fetches the 2D track artifact and renders the map + barograph, with a 2D/3D toggle. */
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
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"2d" | "3d">("2d");

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
            <TrackMap line={track.line} bounds={track.bounds} />
          </Card>
        ) : (
          <FlightReplay3D flightId={flightId} />
        )}
      </div>

      <Card className="p-4">
        <Barograph
          baro={track.baro}
          takeoffMs={takeoffMs}
          offsetMin={offsetMin}
          altSource={track.altSource}
        />
      </Card>
    </div>
  );
}
