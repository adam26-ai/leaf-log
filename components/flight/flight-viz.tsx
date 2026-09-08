"use client";
import { useMapDefaults } from "@/components/map-defaults-provider";
import { readXcScore } from "@/lib/igc/xc-types";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sun,
  Camera,
  Video,
  Navigation,
  Hand,
  Map as MapIcon,
  Satellite,
  Mountain,
  Route,
  Crosshair,
  Scan,
  RefreshCw,
  ImagePlus,
  type LucideIcon,
} from "lucide-react";
import type { TrackArtifact } from "@/lib/igc/track-artifact";
import type { ReplayResponse } from "@/lib/igc/replay";
import type { TerrainProfilePoint } from "@/lib/flights/terrain-profile";
import {
  BAROGRAPH_PLOT_LEFT_INSET,
  BAROGRAPH_PLOT_RIGHT_INSET,
  Barograph,
} from "./barograph";
import {
  FlightReplay3D,
  type CameraMode,
  type AltitudeMode,
  type FlightReplay3DHandle,
  type TrackDisplayMode,
} from "./flight-replay-3d";
import { PlaybackStatus, PlaybackTimeline } from "./playback-bar";
import { PhotoGallery } from "./photo-gallery";
import type { FlightPhoto } from "./photos";
import { BASEMAPS, hasMapTiler, type BasemapId } from "./basemaps";
import { InstrumentReadout, type InstrumentRanges } from "./instrument-readout";
import { instrumentAt } from "@/lib/flights/instruments";
import { haversineM } from "@/lib/geo/distance";
import { useUnits } from "@/lib/flights/use-units";
import { Card, CardBody } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ReplayPaletteLab } from "./replay-palette-lab";
import { REPLAY_SEEK_EVENT, REPLAY_XC_OVERVIEW_EVENT, type ReplayMetric } from "@/lib/flights/replay-events";

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
          ? "border-[var(--replay-active-border)] [border-width:var(--replay-button-border-width)] bg-[var(--replay-active-bg)] text-[var(--replay-active-fg)]"
          : "border-[var(--replay-inactive-border)] [border-width:var(--replay-inactive-button-border-width)] bg-[var(--replay-inactive-bg)] text-[var(--replay-inactive-fg)] hover:brightness-95",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4",
          active
            ? "[stroke-width:var(--replay-button-icon-stroke)]"
            : "[stroke-width:var(--replay-inactive-button-icon-stroke)]",
        )}
      />
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
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <MapIconButton
        icon={icon}
        active={active}
        title={title}
        onClick={onClick}
      />
      <div
        className={cn(
          "absolute left-full top-0 z-20 flex pl-3 transition-opacity",
          open ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <div className="flex flex-col gap-0.5 rounded-md border border-gray-300 bg-paper p-1 shadow-md">
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
                    ? "bg-[var(--replay-active-bg)] text-[var(--replay-active-fg)]"
                    : "text-gray-600 hover:bg-gray-100 hover:text-ink",
              )}
            >
              <o.icon className="h-4 w-4 shrink-0" />
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const CAMERA_MODES: FlyoutOption<CameraMode>[] = [
  { id: "follow", label: "Follow", icon: Video },
  { id: "chase", label: "Chase", icon: Navigation },
  { id: "orbit", label: "Orbit", icon: RefreshCw },
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
      icon={Camera}
      active={mode !== "fixed"}
      title={`Camera: ${current.label} (click to cycle, hover for options)`}
      onClick={onCycle}
      options={CAMERA_MODES}
      value={mode}
      onSelect={onSelect}
    />
  );
}

function AltitudeModeControl({
  mode,
  onSelect,
}: {
  mode: AltitudeMode;
  onSelect: (mode: AltitudeMode) => void;
}) {
  return (
    <MapIconButton
      icon={Mountain}
      active={mode === "agl"}
      title={
        mode === "agl"
          ? "Altitude: AGL, relative to terrain (click for MSL)"
          : "Altitude: MSL, above sea level (click for AGL)"
      }
      onClick={() => onSelect(mode === "asl" ? "agl" : "asl")}
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
      icon={MapIcon}
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
  xcScore,
  flightId,
  canAddPhotos = false,
  takeoffMs,
  offsetMin,
  pilotName,
  notes,
}: {
  flightId: string;
  xcScore?: unknown;
  canAddPhotos?: boolean;
  takeoffMs: number;
  offsetMin: number;
  /** Shown on the 3D glider marker's pole. */
  pilotName?: string | null;
  /** Owner-only free-text notes, shown just below the altitude graph. */
  notes?: string | null;
}) {
  const defaults = useMapDefaults();
  const [track, setTrack] = useState<TrackArtifact | null>(null);
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [terrainProfile, setTerrainProfile] = useState<TerrainProfilePoint[]>([]);
  const [photos, setPhotos] = useState<FlightPhoto[]>([]);
  const [error, setError] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>(() => {
    const style = BASEMAPS.find(b => b.id === defaults.basemap);
    return style?.needsKey && !hasMapTiler() ? "monochrome" : defaults.basemap;
  });
  const [cameraMode, setCameraMode] = useState<CameraMode>(defaults.camera);
  const [showShadow, setShowShadow] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("leaf-3d-shadow");
    return saved == null ? true : saved === "true";
  });
  const [trackDisplay, setTrackDisplay] = useState<TrackDisplayMode>(defaults.track);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [altitudeMode, setAltitudeMode] = useState<AltitudeMode>(defaults.altitude);

  // Shared replay timeline (seconds from takeoff).
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(defaults.speed);
  // Whether a point is selected/highlighted (readout shown). Starts true —
  // the glider is always the highlight.
  const [active, setActive] = useState(true);
  // The photo whose lightbox is open (controlled so a map pin can open it).
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);
  const [photoDropActive, setPhotoDropActive] = useState(false);
  const [photoUploadState, setPhotoUploadState] = useState<"idle" | "uploading" | "error">("idle");
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

  const uploadDroppedPhotos = useCallback(async (allFiles: File[]) => {
    const files = allFiles.filter(
      (file) => file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif)$/i.test(file.name),
    );
    if (!canAddPhotos || files.length === 0) return;
    setPhotoUploadState("uploading");
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const response = await fetch(`/api/flights/${flightId}/photos`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error("Photo upload failed");
      loadPhotos();
      setPhotoUploadState("idle");
    } catch {
      setPhotoUploadState("error");
      window.setTimeout(() => setPhotoUploadState("idle"), 3000);
    }
  }, [canAddPhotos, flightId, loadPhotos]);


  // Playback loop — advances the shared time while playing and rests on the
  // final sample instead of wrapping back to takeoff.
  useEffect(() => {
    if (!playing || !replay) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const t = timeRef.current + dt * speed;
      if (t >= replay.durationS) {
        timeRef.current = replay.durationS;
        setTime(replay.durationS);
        setPlaying(false);
        return;
      }
      timeRef.current = t;
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, replay]);

  const applyTime = useCallback((t: number) => {
    timeRef.current = t;
    setTime(t);
    setActive(true);
  }, []);
  function scrubTo(t: number) {
    applyTime(t);
  }
  const togglePlay = useCallback(() => {
    setActive(true);
    if (playing) {
      setPlaying(false);
      return;
    }
    if (replay && timeRef.current >= replay.durationS) applyTime(0);
    setHasPlaybackStarted(true);
    setPlaying(true);
  }, [applyTime, playing, replay]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select")) return;
      event.preventDefault();
      togglePlay();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay]);

  useEffect(() => {
    function seekToMetric(event: Event) {
      if (!replay?.samples.length) return;
      const metric = (event as CustomEvent<ReplayMetric>).detail;
      let selected = 0;
      for (let index = 1; index < replay.samples.length; index++) {
        if (
          (metric === "max-altitude" && replay.samples[index][2] > replay.samples[selected][2]) ||
          (metric === "best-climb" && replay.vario[index] > replay.vario[selected]) ||
          (metric === "max-sink" && replay.vario[index] < replay.vario[selected])
        ) {
          selected = index;
        }
      }
      setPlaying(false);
      if (cameraMode === "fixed") selectCameraMode("follow");
      applyTime(replay.samples[selected][3]);
      requestAnimationFrame(() => replayRef.current?.centerOnPilot());
    }
    const showXcOverview = () => replayRef.current?.fitToXcRoute();
    window.addEventListener(REPLAY_SEEK_EVENT, seekToMetric);
    window.addEventListener(REPLAY_XC_OVERVIEW_EVENT, showXcOverview);
    return () => {
      window.removeEventListener(REPLAY_SEEK_EVENT, seekToMetric);
      window.removeEventListener(REPLAY_XC_OVERVIEW_EVENT, showXcOverview);
    };
  }, [applyTime, cameraMode, replay]);
  function changeBasemap(id: BasemapId) {
    setBasemap(id);
  }
  function cycleBasemap() {
    const available = BASEMAPS.filter((b) => !(b.needsKey && !hasMapTiler()));
    const i = available.findIndex((b) => b.id === basemap);
    changeBasemap(available[(i + 1) % available.length].id);
  }
  function selectCameraMode(next: CameraMode) {
    setCameraMode(next);
  }
  function cycleCameraMode() {
    selectCameraMode(
      cameraMode === "follow"
        ? "chase"
        : cameraMode === "chase"
          ? "orbit"
          : cameraMode === "orbit"
            ? "fixed"
            : "follow",
    );
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
  function selectTrackDisplay(next: TrackDisplayMode) {
    setTrackDisplay(next);
  }
  function selectAltitudeMode(next: AltitudeMode) {
    setAltitudeMode(next);
  }

  const instrumentRanges = useMemo<InstrumentRanges | null>(() => {
    if (!replay?.samples.length) return null;
    let altMinM = Infinity;
    let altMaxM = -Infinity;
    let speedMinKmh = Infinity;
    let speedMaxKmh = -Infinity;
    replay.samples.forEach((sample, index) => {
      altMinM = Math.min(altMinM, sample[2]);
      altMaxM = Math.max(altMaxM, sample[2]);
      if (index === 0) return;
      const previous = replay.samples[index - 1];
      const elapsed = sample[3] - previous[3];
      if (elapsed <= 0) return;
      const speed = (haversineM(previous[1], previous[0], sample[1], sample[0]) / elapsed) * 3.6;
      if (!Number.isFinite(speed)) return;
      speedMinKmh = Math.min(speedMinKmh, speed);
      speedMaxKmh = Math.max(speedMaxKmh, speed);
    });
    return {
      altMinM,
      altMaxM,
      speedMinKmh: Number.isFinite(speedMinKmh) ? speedMinKmh : 0,
      speedMaxKmh: Number.isFinite(speedMaxKmh) ? speedMaxKmh : 0,
    };
  }, [replay]);

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
  const renderedTrackDisplay =
    trackDisplay === "elapsed" && hasPlaybackStarted ? "elapsed" : "full";

  return (
    <div className="flex flex-col gap-6">
      {process.env.NODE_ENV === "development" && (
        <ReplayPaletteLab basemap={basemap} onBasemap={changeBasemap} />
      )}
      <div className="flex flex-col gap-2">
        {/* The map spans 80% of the browser window, breaking out of the
            page's centered max-w column rather than following the same
            margins as the key-statistics card above it. */}
        <div className="relative left-1/2 w-[80vw] -translate-x-1/2">
          <div
            className="relative"
            onDragEnter={(event) => {
              if (!canAddPhotos || !event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setPhotoDropActive(true);
            }}
            onDragOver={(event) => {
              if (!canAddPhotos || !event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setPhotoDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setPhotoDropActive(false);
              }
            }}
            onDrop={(event) => {
              if (!canAddPhotos) return;
              event.preventDefault();
              setPhotoDropActive(false);
              void uploadDroppedPhotos(Array.from(event.dataTransfer.files));
            }}
          >
            <FlightReplay3D
              xcRoute={readXcScore(xcScore)?.best}
              ref={replayRef}
              flightId={flightId}
              basemap={basemap}
              time={time}
              playing={playing}
              cameraMode={cameraMode}
              showShadow={showShadow}
              trackDisplay={renderedTrackDisplay}
              units={units}
              altitudeMode={altitudeMode}
              photos={photos}
              pilotName={pilotName}
              onManualCameraChange={() => selectCameraMode("fixed")}
              onPhotoHover={playing ? undefined : scrubTo}
              onPhotoOpen={(id, t) => {
                setOpenPhotoId(id);
                if (!playing && t != null) scrubTo(t);
              }}
              onTerrainProfile={setTerrainProfile}
            />
            {/* Live instrument panel, overlaid on the map (top-centre). */}
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
              <InstrumentReadout reading={reading} units={units} ranges={instrumentRanges} />
            </div>
            {/* Keep Leaf's map controls centered separately from MapLibre's upper-left nav stack. */}
            <div className="absolute left-[10px] top-1/2 flex -translate-y-1/2 flex-col gap-1">
              <MapIconButton
                icon={Sun}
                active={showShadow}
                title="Toggle ground shadow and altitude trails"
                onClick={toggleShadow}
              />
              <AltitudeModeControl mode={altitudeMode} onSelect={selectAltitudeMode} />
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
            {/* Clock and speed mirror the map attribution in the lower-left. */}
            <div className="absolute bottom-2 left-3 z-10">
              <PlaybackStatus
                time={time}
                speed={speed}
                takeoffMs={takeoffMs}
                offsetMin={offsetMin}
                disabled={!replay}
                onSpeed={setSpeed}
                trackDisplay={trackDisplay}
                onTrackDisplay={selectTrackDisplay}
              />
            </div>
            {(photoDropActive || photoUploadState !== "idle") && (
              <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-lg bg-ink/45 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-lg border border-white/40 bg-ink/85 px-4 py-3 font-condensed font-bold text-white shadow-lg">
                  <ImagePlus className="h-5 w-5 text-[var(--replay-accent)]" />
                  {photoUploadState === "uploading"
                    ? "Adding photos…"
                    : photoUploadState === "error"
                      ? "Photos could not be added"
                      : "Drop photos to add them to this flight"}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* The bare timeline removes vertical card padding. Its outer columns
            include the profile card's 16px padding, keeping the rail on the
            Recharts X-axis while putting Play on the map's left edge. */}
        <div
          className="relative left-1/2 grid w-[80vw] -translate-x-1/2 items-center"
          style={{
            gridTemplateColumns: `${BAROGRAPH_PLOT_LEFT_INSET + 16}px minmax(0, 1fr) ${BAROGRAPH_PLOT_RIGHT_INSET + 16}px`,
          }}
        >
          <PlaybackTimeline
            playing={playing}
            time={time}
            duration={duration}
            disabled={!replay}
            onTogglePlay={togglePlay}
            onScrub={scrubTo}
          />
        </div>

        {/* Same 80vw treatment and padding as the timeline above it. */}
        <div className="relative left-1/2 w-[80vw] -translate-x-1/2">
          <Card className="px-4 py-2">
            <Barograph
              baro={track.baro}
              terrain={terrainProfile}
              takeoffMs={takeoffMs}
              offsetMin={offsetMin}
              altSource={track.altSource}
              units={units}
              activeTime={active ? time : null}
              onScrubTime={scrubTo}
            />
          </Card>
        </div>
      </div>

      {notes && (
        <Card>
          <CardBody className="flex flex-col gap-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Notes
            </p>
            <p className="whitespace-pre-wrap text-sm text-gray-700">{notes}</p>
          </CardBody>
        </Card>
      )}

      {photos.length > 0 && (
        <Card className="flex flex-col gap-3 p-4">
          <PhotoGallery
            flightId={flightId}
            photos={photos}
            openId={openPhotoId}
            onOpenChange={setOpenPhotoId}
            onSelect={scrubTo}
          />
        </Card>
      )}
    </div>
  );
}
