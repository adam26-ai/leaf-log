"use client";

import { useEffect, useState } from "react";
import type { TrackArtifact } from "@/lib/igc/track-artifact";
import type { ReplayResponse } from "@/lib/igc/replay";
import { TrackMap } from "./track-map";
import { Barograph } from "./barograph";
import { FlightReplay3D } from "./flight-replay-3d";
import { BASEMAPS, hasMapTiler, type BasemapId } from "./basemaps";
import { InstrumentReadout } from "./instrument-readout";
import { instrumentAt } from "@/lib/flights/instruments";
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
  // Restore the saved basemap (ignore key-only ones when no MapTiler key). Safe
  // as a lazy initializer — the basemap UI only renders client-side once the
  // track has loaded, so there's no SSR/hydration mismatch.
  const [basemap, setBasemap] = useState<BasemapId>(() => {
    if (typeof window === "undefined") return "monochrome";
    const saved = localStorage.getItem("leaf-basemap") as BasemapId | null;
    const def = saved && BASEMAPS.find((b) => b.id === saved);
    return def && !(def.needsKey && !hasMapTiler()) ? def.id : "monochrome";
  });
  // Shared linked-cursor time (seconds from takeoff), or null.
  const [activeTime, setActiveTime] = useState<number | null>(null);
  // Current 3D replay time (playback/scrub/hover) for the instrument readout.
  const [replay3dTime, setReplay3dTime] = useState<number | null>(null);

  function changeBasemap(id: BasemapId) {
    setBasemap(id);
    try {
      localStorage.setItem("leaf-basemap", id);
    } catch {
      /* ignore */
    }
  }

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
  // The instrument readout follows the hover in 2D, and the replay/hover in 3D.
  const readoutTime = mode === "3d" ? replay3dTime : activeTime;
  const reading =
    replay && readoutTime != null ? instrumentAt(replay, readoutTime) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
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

          <label className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-condensed font-bold">Basemap</span>
            <select
              value={basemap}
              onChange={(e) => changeBasemap(e.target.value as BasemapId)}
              className="h-8 rounded-md border border-gray-300 bg-paper px-2 text-ink outline-none focus:border-amber"
            >
              {BASEMAPS.map((b) => {
                const locked = b.needsKey && !hasMapTiler();
                return (
                  <option key={b.id} value={b.id} disabled={locked}>
                    {b.label}
                    {locked ? " (needs key)" : ""}
                  </option>
                );
              })}
            </select>
          </label>
        </div>

        <InstrumentReadout reading={reading} />

        {mode === "2d" ? (
          <Card className="overflow-hidden">
            <TrackMap
              line={track.line}
              bounds={track.bounds}
              basemap={basemap}
              cursor={cursor}
              samples={replay?.samples ?? null}
              onHoverTime={setActiveTime}
            />
          </Card>
        ) : (
          <FlightReplay3D
            flightId={flightId}
            basemap={basemap}
            externalTime={activeTime}
            onHoverTime={setActiveTime}
            onTimeChange={setReplay3dTime}
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
