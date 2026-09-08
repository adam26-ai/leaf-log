"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronUp, Pause, PencilLine, Play } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function clock(tSec: number, takeoffMs: number, offsetMin: number) {
  const d = new Date(takeoffMs + tSec * 1000 + offsetMin * 60_000);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}`;
}

const SPEEDS = [1, 4, 8, 16, 32, 64, 128];

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
        className="flex h-7 min-w-[3.5rem] items-center justify-between gap-1 rounded border border-gray-300 bg-paper px-1.5 font-condensed text-xs font-bold text-ink outline-none hover:border-gray-400 focus:border-amber disabled:opacity-50"
      >
        <span>{speed}×</span>
        <ChevronUp className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
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
        "relative h-9 touch-none select-none outline-none",
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
}: {
  playing: boolean;
  time: number;
  duration: number;
  disabled?: boolean;
  onTogglePlay: () => void;
  onScrub: (time: number) => void;
}) {
  const Icon = playing ? Pause : Play;
  const label = playing ? "Pause" : "Play";

  return (
    <>
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="flex h-9 w-16 items-center justify-center gap-1 rounded-md border [border-width:var(--replay-button-border-width)] border-[var(--replay-active-border)] bg-[var(--replay-active-bg)] font-condensed text-sm font-bold text-[var(--replay-active-fg)] hover:brightness-95 disabled:opacity-50"
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
            ? "Show flight so far during playback"
            : "Keep the full route visible during playback"
        }
        title={
          progressive
            ? "Show flight so far: on (click to keep full route visible)"
            : "Show flight so far: off (click to draw route during playback)"
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
