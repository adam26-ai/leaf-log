"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackArtifact } from "@/lib/igc/track-artifact";
import type { ReplayResponse } from "@/lib/igc/replay";
import { TrackMap } from "./track-map";
import { Barograph } from "./barograph";
import { FlightReplay3D } from "./flight-replay-3d";
import { PlaybackBar } from "./playback-bar";
import { PhotoGallery } from "./photo-gallery";
import { PhotoUpload } from "./photo-upload";
import type { FlightPhoto } from "./photos";
import { BASEMAPS, hasMapTiler, type BasemapId } from "./basemaps";
import { InstrumentReadout } from "./instrument-readout";
import { instrumentAt } from "@/lib/flights/instruments";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Owns the flight's shared replay timeline (time/play/speed) so one scrubber
 * drives both the 2D map and the 3D replay, plus a linked barograph cursor. The
 * selection persists until you click a map; map hover is intentionally not a
 * cursor source.
 */
export function FlightViz({
  flightId,
  takeoffMs,
  offsetMin,
  isOwner = false,
}: {
  flightId: string;
  takeoffMs: number;
  offsetMin: number;
  isOwner?: boolean;
}) {
  const [track, setTrack] = useState<TrackArtifact | null>(null);
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [photos, setPhotos] = useState<FlightPhoto[]>([]);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  // Restore the saved basemap (ignore key-only ones when no MapTiler key). Safe
  // as a lazy initializer — the UI only renders client-side once the track loads.
  const [basemap, setBasemap] = useState<BasemapId>(() => {
    if (typeof window === "undefined") return "monochrome";
    const saved = localStorage.getItem("leaf-basemap") as BasemapId | null;
    const def = saved && BASEMAPS.find((b) => b.id === saved);
    return def && !(def.needsKey && !hasMapTiler()) ? def.id : "monochrome";
  });
  const [cameraFollow, setCameraFollow] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("leaf-camera-follow") !== "false";
  });

  // Shared replay timeline (seconds from takeoff).
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  // Whether a point is selected/highlighted (cursor + readout shown).
  const [active, setActive] = useState(false);
  // The photo whose lightbox is open (controlled so a map pin can open it).
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    let on = true;
    fetch(`/api/flights/${flightId}/track`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => on && setTrack(d))
      .catch(() => on && setError(true));
    return () => {
      on = false;
    };
  }, [flightId]);

  useEffect(() => {
    let on = true;
    fetch(`/api/flights/${flightId}/replay`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => on && setReplay(d))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [flightId]);

  const loadPhotos = useCallback(() => {
    fetch(`/api/flights/${flightId}/photos`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPhotos(d.photos ?? []))
      .catch(() => {});
  }, [flightId]);
  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  // Playback loop — advances the shared time while playing.
  useEffect(() => {
    if (!playing || !replay) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let t = timeRef.current + dt * speed;
      if (t >= replay.durationS) t = 0; // loop
      timeRef.current = t;
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, replay]);

  function applyTime(t: number) {
    timeRef.current = t;
    setTime(t);
    setActive(true);
  }
  function scrubTo(t: number) {
    applyTime(t);
  }
  function onHover(t: number) {
    applyTime(t);
  }
  function togglePlay() {
    setActive(true);
    setPlaying((p) => !p);
  }
  function clearSelection() {
    setActive(false);
    setPlaying(false);
  }
  function changeMode(m: "2d" | "3d") {
    setMode(m);
    if (m === "3d") setActive(true); // the glider is always the highlight in 3D
  }
  function changeBasemap(id: BasemapId) {
    setBasemap(id);
    try {
      localStorage.setItem("leaf-basemap", id);
    } catch {
      /* ignore */
    }
  }
  function toggleFollow() {
    setCameraFollow((f) => {
      const next = !f;
      try {
        localStorage.setItem("leaf-camera-follow", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

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

  const cursor = active ? posAt(time) : null;
  const reading = active && replay ? instrumentAt(replay, time) : null;
  const duration = replay?.durationS ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex w-fit rounded-md border border-gray-200 p-0.5">
            {(["2d", "3d"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => changeMode(m)}
                className={cn(
                  "rounded px-3 py-1 font-condensed text-sm font-bold transition-colors",
                  mode === m ? "bg-ink text-paper" : "text-gray-600 hover:text-ink",
                )}
              >
                {m === "2d" ? "Map" : "3D replay"}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {mode === "3d" && (
              <button
                type="button"
                onClick={toggleFollow}
                className={cn(
                  "h-8 rounded-md border px-2 font-condensed text-sm font-bold transition-colors",
                  cameraFollow
                    ? "border-amber bg-amber text-ink"
                    : "border-gray-300 bg-paper text-gray-600 hover:text-ink",
                )}
                title="Toggle whether the camera follows the glider"
              >
                {cameraFollow ? "Camera: Follow" : "Camera: Fixed"}
              </button>
            )}
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
        </div>

        <InstrumentReadout reading={reading} />

        {mode === "2d" ? (
          <Card className="overflow-hidden">
            <TrackMap
              line={track.line}
              bounds={track.bounds}
              basemap={basemap}
              cursor={cursor}
              flightId={flightId}
              photos={photos}
              onClear={clearSelection}
              onPhotoHover={scrubTo}
              onPhotoOpen={(id, t) => {
                setOpenPhotoId(id);
                if (t != null) scrubTo(t);
              }}
            />
          </Card>
        ) : (
          <FlightReplay3D
            flightId={flightId}
            basemap={basemap}
            time={time}
            cameraFollow={cameraFollow}
          />
        )}

        <PlaybackBar
          playing={playing}
          time={time}
          duration={duration}
          speed={speed}
          takeoffMs={takeoffMs}
          offsetMin={offsetMin}
          disabled={!replay}
          onTogglePlay={togglePlay}
          onScrub={scrubTo}
          onSpeed={setSpeed}
          hint={
            mode === "3d"
              ? "Drag to tilt & rotate · green = climb, red = sink"
              : "Hover the profile or play to scrub · click the map to clear"
          }
        />
      </div>

      <Card className="p-4">
        <Barograph
          baro={track.baro}
          takeoffMs={takeoffMs}
          offsetMin={offsetMin}
          altSource={track.altSource}
          activeTime={active ? time : null}
          onHoverTime={onHover}
        />
      </Card>

      {(photos.length > 0 || isOwner) && (
        <Card className="flex flex-col gap-3 p-4">
          {isOwner && <PhotoUpload flightId={flightId} onUploaded={loadPhotos} />}
          <PhotoGallery
            flightId={flightId}
            photos={photos}
            isOwner={isOwner}
            openId={openPhotoId}
            onOpenChange={setOpenPhotoId}
            onSelect={scrubTo}
            onChanged={loadPhotos}
          />
        </Card>
      )}
    </div>
  );
}
