"use client";

import { useEffect, useState } from "react";
import type { TrackArtifact } from "@/lib/igc/track-artifact";
import { TrackMap } from "./track-map";
import { Barograph } from "./barograph";
import { Card } from "@/components/ui/card";

/** Fetches the track artifact once (via the authorizing route) and renders both views. */
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
      <Card className="overflow-hidden">
        <TrackMap line={track.line} bounds={track.bounds} />
      </Card>
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
