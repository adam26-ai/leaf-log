"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Sun,
  Video,
  Navigation,
  Hand,
  Map as MapIcon,
  Satellite,
  Mountain,
  Route,
  Crosshair,
  Scan,
  type LucideIcon,
} from "lucide-react";
import type { TrackArtifact } from "@/lib/igc/track-artifact";
import type { ReplayResponse } from "@/lib/igc/replay";
import { Barograph } from "./barograph";
import { FlightReplay3D, type CameraMode, type FlightReplay3DHandle } from "./flight-replay-3d";
import { PlaybackBar } from "./playback-bar";
import { PhotoGallery } from "./photo-gallery";
import { PhotoUpload } from "./photo-upload";
import type { FlightPhoto } from "./photos";
import { BASEMAPS, hasMapTiler, type BasemapId } from "./basemaps";
import { InstrumentReadout } from "./instrument-readout";
import { instrumentAt } from "@/lib/flights/instruments";
import { useUnits } from "@/lib/flights/use-units";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Small square icon button for the map's own control overlay — distinct
 *  from the flat `title`-only text buttons used elsewhere in the app since
 *  it has to read clearly floating over map imagery. */
function MapIconButton({
  icon: Icon,
  active = false,
  title,
  onClick,
}: {
  icon: LucideIcon;
  active?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-md border shadow-sm backdrop-blur-sm transition-colors",
        active
          ? "border-amber bg-amber text-ink"
          : "border-gray-300 bg-paper/90 text-gray-600 hover:text-ink",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

interface FlyoutOption<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

/** An icon button that, on hover, pops out a menu of every option (icon +
 *  name) so one can be picked directly — clicking the main icon still cycles
 *  (via `onClick`), which is the only path on touch, where hover never fires. */
function IconFlyoutControl<T extends string>({
  icon,
  active,
  title,
  onClick,
  options,
  value,
  onSelect,
}: {
  icon: LucideIcon;
  active?: boolean;
  title: string;
  onClick: () => void;
  options: FlyoutOption<T>[];
  value: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="group relative">
      <MapIconButton icon={icon} active={active} title={title} onClick={onClick} />
      <div
        className="invisible absolute right-full top-0 mr-2 flex flex-col gap-0.5 rounded-md border border-gray-300 bg-paper p-1 opacity-0 shadow-md transition-opacity
          group-hover:visible group-hover:opacity-100"
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={o.disabled}
            onClick={() => onSelect(o.id)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-left font-condensed text-sm font-bold transition-colors",
              o.disabled
                ? "cursor-not-allowed text-gray-300"
                : o.id === value
                  ? "bg-amber text-ink"
                  : "text-gray-600 hover:bg-gray-100 hover:text-ink",
            )}
          >
            <o.icon className="h-4 w-4 shrink-0" />
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const CAMERA_MODES: FlyoutOption<CameraMode>[] = [
  { id: "follow", label: "Follow", icon: Video },
  { id: "chase", label: "Chase", icon: Navigation },
  { id: "fixed", label: "Fixed", icon: Hand },
];

function CameraModeControl({
  mode,
  onCycle,
  onSelect,
}: {
  mode: CameraMode;
  onCycle: () => void;
  onSelect: (mode: CameraMode) => void;
}) {
  const current = CAMERA_MODES.find((m) => m.id === mode) ?? CAMERA_MODES[0];
  return (
    <IconFlyoutControl
      icon={current.icon}
      active={mode !== "fixed"}
      title={`Camera: ${current.label} (click to cycle, hover for options)`}
      onClick={onCycle}
      options={CAMERA_MODES}
      value={mode}
      onSelect={onSelect}
    />
  );
}

const BASEMAP_ICONS: Record<BasemapId, LucideIcon> = {
  monochrome: MapIcon,
  satellite: Satellite,
  hybrid: Satellite,
  topo: Mountain,
  streets: Route,
};

function BasemapControl({
  basemap,
  onCycle,
  onSelect,
}: {
  basemap: BasemapId;
  onCycle: () => void;
  onSelect: (id: BasemapId) => void;
}) {
  const options: FlyoutOption<BasemapId>[] = BASEMAPS.map((b) => ({
    id: b.id,
    label: b.needsKey && !hasMapTiler() ? `${b.label} (needs key)` : b.label,
    icon: BASEMAP_ICONS[b.id],
    disabled: b.needsKey && !hasMapTiler(),
  }));
  const current = BASEMAPS.find((b) => b.id === basemap);
  return (
    <IconFlyoutControl
      icon={BASEMAP_ICONS[basemap]}
      title={`Basemap: ${current?.label ?? basemap} (click to cycle, hover for options)`}
      onClick={onCycle}
      options={options}
      value={basemap}
      onSelect={onSelect}
    />
  );
}

/**
 * Owns the flight's shared replay timeline (time/play/speed) so the scrubber
 * drives the 3D replay and a linked barograph cursor together.
 */
export function FlightViz({
  flightId,
  takeoffMs,
  offsetMin,
  isOwner = false,
  pilotName,
}: {
  flightId: string;
  takeoffMs: number;
  offsetMin: number;
  isOwner?: boolean;
  /** Shown on the 3D glider marker's pole. */
  pilotName?: string | null;
}) {
  const [track, setTrack] = useState<TrackArtifact | null>(null);
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [photos, setPhotos] = useState<FlightPhoto[]>([]);
  const [error, setError] = useState(false);
  // Restore the saved basemap (ignore key-only ones when no MapTiler key). Safe
  // as a lazy initializer — the UI only renders client-side once the track loads.
  const [basemap, setBasemap] = useState<BasemapId>(() => {
    if (typeof window === "undefined") return "monochrome";
    const saved = localStorage.getItem("leaf-basemap") as BasemapId | null;
    const def = saved && BASEMAPS.find((b) => b.id === saved);
    return def && !(def.needsKey && !hasMapTiler()) ? def.id : "monochrome";
  });
  const [cameraMode, setCameraMode] = useState<CameraMode>(() => {
    if (typeof window === "undefined") return "follow";
    const saved = localStorage.getItem("leaf-camera-mode");
    if (saved === "follow" || saved === "chase" || saved === "fixed") return saved;
    return localStorage.getItem("leaf-camera-follow") === "false" ? "fixed" : "follow";
  });
  const [showShadow, setShowShadow] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("leaf-3d-shadow") === "true";
  });

  // Shared replay timeline (seconds from takeoff).
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  // Whether a point is selected/highlighted (readout shown). Starts true —
  // the glider is always the highlight.
  const [active, setActive] = useState(true);
  // The photo whose lightbox is open (controlled so a map pin can open it).
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const timeRef = useRef(0);
  const replayRef = useRef<FlightReplay3DHandle>(null);
  // Same Metric/Imperial preference as the key-statistics card, kept live in
  // sync across both components (see lib/flights/use-units.ts).
  const [units] = useUnits();

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

  useEffect(() => {
    try {
      localStorage.setItem("leaf-camera-mode", cameraMode);
    } catch {
      /* ignore */
    }
  }, [cameraMode]);

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
  function changeBasemap(id: BasemapId) {
    setBasemap(id);
    try {
      localStorage.setItem("leaf-basemap", id);
    } catch {
      /* ignore */
    }
  }
  function cycleBasemap() {
    const available = BASEMAPS.filter((b) => !(b.needsKey && !hasMapTiler()));
    const i = available.findIndex((b) => b.id === basemap);
    changeBasemap(available[(i + 1) % available.length].id);
  }
  // Persisted to localStorage by the effect above whenever it changes.
  function selectCameraMode(next: CameraMode) {
    setCameraMode(next);
  }
  function cycleCameraMode() {
    selectCameraMode(cameraMode === "follow" ? "chase" : cameraMode === "chase" ? "fixed" : "follow");
  }
  function toggleShadow() {
    setShowShadow((on) => {
      const next = !on;
      try {
        localStorage.setItem("leaf-3d-shadow", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
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

  const reading = active && replay ? instrumentAt(replay, time) : null;
  const duration = replay?.durationS ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {/* The map spans 80% of the browser window, breaking out of the
            page's centered max-w column rather than following the same
            margins as the key-statistics card above it. */}
        <div className="relative left-1/2 w-[80vw] -translate-x-1/2">
          <div className="relative">
            <FlightReplay3D
              ref={replayRef}
              flightId={flightId}
              basemap={basemap}
              time={time}
              cameraMode={cameraMode}
              showShadow={showShadow}
              photos={photos}
              pilotName={pilotName}
              onPhotoHover={scrubTo}
              onPhotoOpen={(id, t) => {
                setOpenPhotoId(id);
                if (t != null) scrubTo(t);
              }}
            />
            {/* Live instrument panel, overlaid on the map (top-centre). */}
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
              <InstrumentReadout reading={reading} units={units} />
            </div>
            {/* Map controls, overlaid on the map (right-centre). */}
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2">
              <MapIconButton
                icon={Sun}
                active={showShadow}
                title="Toggle the terrain-clamped flight shadow"
                onClick={toggleShadow}
              />
              <CameraModeControl mode={cameraMode} onCycle={cycleCameraMode} onSelect={selectCameraMode} />
              <BasemapControl basemap={basemap} onCycle={cycleBasemap} onSelect={changeBasemap} />
              <MapIconButton
                icon={Crosshair}
                title="Center on pilot"
                onClick={() => replayRef.current?.centerOnPilot()}
              />
              <MapIconButton
                icon={Scan}
                title="Zoom to full route"
                onClick={() => replayRef.current?.fitToRoute()}
              />
            </div>
            {/* Scrubber transport, overlaid on the map (bottom-centre). Cleared
                enough to sit above the map's own attribution strip. */}
            <div className="absolute inset-x-0 bottom-8 flex justify-center px-3">
              <div className="w-full max-w-2xl">
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
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Same 80vw treatment as the map above it, so the elevation profile
          lines up edge-to-edge with the map rather than the narrower
          key-statistics column. */}
      <div className="relative left-1/2 w-[80vw] -translate-x-1/2">
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
      </div>

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
