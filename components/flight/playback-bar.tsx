"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronUp, Pause, PencilLine, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/avatar";
import type { ReplayPilot } from "@/lib/flights/group-replay";

function clock(tSec: number, takeoffMs: number, offsetMin: number) {
  const d = new Date(takeoffMs + tSec * 1000 + offsetMin * 60_000);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}`;
}

import { PLAYBACK_SPEEDS as SPEEDS } from "@/lib/flights/map-defaults";

function PlaybackSpeedPicker({
  speed,
  disabled,
  onSpeed,
}: {
  speed: number;
  disabled: boolean;
  onSpeed: (speed: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={pickerRef} className="relative">
      {open && (
        <div
          role="listbox"
          aria-label="Playback speed"
          className="absolute bottom-full left-0 z-20 mb-1 min-w-full overflow-hidden rounded-md border border-gray-200 bg-paper py-1 shadow-lg"
        >
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={speed === option}
              onClick={() => {
                onSpeed(option);
                setOpen(false);
              }}
              className={cn(
                "block w-full px-3 py-1 text-left font-condensed text-xs font-bold hover:bg-gray-100",
                speed === option ? "bg-[color-mix(in_srgb,var(--replay-accent)_20%,white)] text-ink" : "text-gray-700",
              )}
            >
              {option}×
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Playback speed"
        aria-label={`Playback speed: ${speed}×`}
        onClick={() => setOpen((current) => !current)}
        className="flex h-7 min-w-[3.5rem] items-center justify-between gap-1 rounded border border-gray-300 bg-paper px-1.5 font-condensed text-xs font-bold text-ink outline-none hover:border-gray-400 focus:border-brand-blue disabled:opacity-50"
      >
        <span>{speed}×</span>
        <ChevronUp className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

interface TakeoffMarker { id: string; time: number; own: boolean; label: string; pilot: ReplayPilot }

function TakeoffAvatars({ takeoffs, duration, disabled, onTakeoff }: {
  takeoffs: TakeoffMarker[];
  duration: number;
  disabled: boolean;
  onTakeoff: (flightId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Stacking preserves the exact time position even for simultaneous launches.
  const rowEnds: number[] = [];
  const markers = [...takeoffs].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)).map((takeoff) => {
    const fraction = Math.max(0, Math.min(1, takeoff.time / Math.max(1, duration)));
    const x = fraction * (width || 1000);
    const availableRow = rowEnds.findIndex((end) => x - end >= 28);
    const row = availableRow < 0 ? rowEnds.length : availableRow;
    rowEnds[row] = x;
    return { ...takeoff, fraction, row };
  });

  return <div ref={containerRef} role="group" aria-label="Flight takeoffs" className="relative col-start-2 row-start-1"
    style={{ height: Math.max(0, rowEnds.length * 28 - 4) }}>
    {markers.map((marker) => <button key={marker.id} type="button" title={marker.label} aria-label={marker.label}
      data-takeoff-flight={marker.id} disabled={disabled} onClick={() => onTakeoff(marker.id)}
      className="absolute grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full border-2 bg-[var(--replay-group-avatar-bg)] shadow-sm transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
      style={{ left: `${marker.fraction * 100}%`, bottom: marker.row * 28, borderColor: marker.own ? "var(--replay-group-primary)" : "var(--replay-group-companion)" }}>
      <Avatar {...marker.pilot} className="h-5 w-5 bg-[var(--replay-group-avatar-bg)] text-[9px] text-[var(--replay-group-avatar-text)]" />
    </button>)}
  </div>;
}

function AlignedTimeSlider({
  time,
  duration,
  disabled,
  onScrub,
}: {
  time: number;
  duration: number;
  disabled: boolean;
  onScrub: (time: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const maximum = Math.max(1, duration);
  const value = Math.max(0, Math.min(duration, time));
  const fraction = duration > 0 ? value / duration : 0;

  function scrubAt(clientX: number) {
    const rail = railRef.current;
    if (!rail || disabled) return;
    const bounds = rail.getBoundingClientRect();
    const nextFraction = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    onScrub(nextFraction * duration);
  }

  return (
    <div
      ref={railRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Flight playback time"
      aria-disabled={disabled}
      aria-valuemin={0}
      aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(value)}
      className={cn(
        "relative col-start-2 row-start-2 h-9 touch-none select-none outline-none",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
      onPointerDown={(event) => {
        if (disabled) return;
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        scrubAt(event.clientX);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) scrubAt(event.clientX);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
      onKeyDown={(event) => {
        if (disabled) return;
        let next = value;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= 1;
        else if (event.key === "ArrowRight" || event.key === "ArrowUp") next += 1;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = duration;
        else return;
        event.preventDefault();
        onScrub(Math.max(0, Math.min(duration, next)));
      }}
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-gray-300" style={{ height: "var(--replay-timeline-width)" }} />
      <div
        className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-[var(--replay-timeline)]"
        style={{ width: `${fraction * 100}%`, height: "var(--replay-timeline-width)" }}
      />
      <div
        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--replay-timeline)] bg-[var(--replay-timeline-dot-fill)] shadow-sm"
        style={{ left: `${fraction * 100}%` }}
      />
    </div>
  );
}

/** Play/pause and the profile-aligned replay timeline. */
export function PlaybackTimeline({
  playing,
  time,
  duration,
  disabled = false,
  onTogglePlay,
  onScrub,
  takeoffs = [],
  onTakeoff,
  dayExpanded = false,
  discovering = false,
  onToggleDay,
}: {
  playing: boolean;
  time: number;
  duration: number;
  disabled?: boolean;
  onTogglePlay: () => void;
  onScrub: (time: number) => void;
  takeoffs?: TakeoffMarker[];
  onTakeoff: (flightId: string) => void;
  dayExpanded?: boolean;
  discovering?: boolean;
  onToggleDay?: () => void;
}) {
  const Icon = playing ? Pause : Play;
  const label = playing ? "Pause" : "Play";

  return (
    <>
      <TakeoffAvatars takeoffs={takeoffs} duration={duration} disabled={disabled} onTakeoff={onTakeoff} />
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="col-start-1 row-start-2 flex h-9 w-16 items-center justify-center gap-1 rounded-md border [border-width:var(--replay-button-border-width)] border-[var(--replay-active-border)] bg-[var(--replay-active-bg)] font-condensed text-sm font-bold text-[var(--replay-active-fg)] hover:brightness-95 disabled:opacity-50"
      >
        <Icon className="h-4 w-4 [stroke-width:var(--replay-button-icon-stroke)]" fill="currentColor" />
        {label}
      </button>
      <AlignedTimeSlider
        time={time}
        duration={duration}
        disabled={disabled}
        onScrub={onScrub}
      />
      {onToggleDay && <button type="button"
        title={dayExpanded ? "Return to this flight and overlapping friends" : "Relive the day — show everyone's nearby flights from this day"}
        aria-label={dayExpanded ? "Return to this flight" : "Relive the day"}
        aria-pressed={dayExpanded} disabled={disabled || discovering} onClick={onToggleDay}
        className={cn("col-start-3 row-start-2 ml-1 grid h-9 w-6 place-items-center rounded disabled:opacity-40", dayExpanded ? "bg-[var(--replay-active-bg)] text-[var(--replay-active-fg)]" : "text-gray-600 hover:bg-gray-100")}
      ><CalendarDays className="h-4 w-4" aria-hidden="true" /></button>}
    </>
  );
}

/** Compact lower-left map card for clock time and playback rate. */
export function PlaybackStatus({
  time,
  speed,
  takeoffMs,
  offsetMin,
  trackDisplay,
  disabled = false,
  onSpeed,
  onTrackDisplay,
}: {
  time: number;
  speed: number;
  takeoffMs: number;
  offsetMin: number;
  trackDisplay: "elapsed" | "full";
  disabled?: boolean;
  onSpeed: (speed: number) => void;
  onTrackDisplay: (mode: "elapsed" | "full") => void;
}) {
  const progressive = trackDisplay === "elapsed";
  return (
    <Card className="flex items-center gap-2 bg-paper/95 px-2 py-1.5 shadow-sm backdrop-blur-sm">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={progressive}
        aria-label={
          progressive
            ? "Draw flight during playback — click to change"
            : "Always show full route — click to change"
        }
        title={
          progressive
            ? "Draw flight during playback — click to change"
            : "Always show full route — click to change"
        }
        onClick={() => onTrackDisplay(progressive ? "full" : "elapsed")}
        className={cn(
          "grid h-7 w-7 place-items-center rounded border p-0 transition-colors disabled:opacity-50",
          progressive
            ? "border-[var(--replay-active-border)] [border-width:var(--replay-button-border-width)] bg-[var(--replay-active-bg)] text-[var(--replay-active-fg)]"
            : "border-[var(--replay-inactive-border)] [border-width:var(--replay-inactive-button-border-width)] bg-[var(--replay-inactive-bg)] text-[var(--replay-inactive-fg)] hover:brightness-95",
        )}
      >
        <PencilLine
          className={cn(
            "h-3.5 w-3.5",
            progressive
              ? "[stroke-width:var(--replay-button-icon-stroke)]"
              : "[stroke-width:var(--replay-inactive-button-icon-stroke)]",
          )}
          aria-hidden="true"
        />
      </button>
      <PlaybackSpeedPicker speed={speed} disabled={disabled} onSpeed={onSpeed} />
      <span className="w-[4.75rem] text-right font-mono text-xs tabular-nums text-gray-700">
        {disabled ? "--:--:--" : clock(time, takeoffMs, offsetMin)}
      </span>
    </Card>
  );
}
