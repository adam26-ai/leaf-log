"use client";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function clock(tSec: number, takeoffMs: number, offsetMin: number) {
  const d = new Date(takeoffMs + tSec * 1000 + offsetMin * 60_000);
  return `${d.getUTCHours().toString().padStart(2, "0")}:${d
    .getUTCMinutes()
    .toString()
    .padStart(2, "0")}:${d.getUTCSeconds().toString().padStart(2, "0")}`;
}

const SPEEDS = [4, 8, 16, 32];

/**
 * Shared replay transport — play/pause, scrubber, speed. Drives the 3D
 * replay's timeline (lifted into FlightViz). A single row so it fits as a
 * compact overlay on the map itself.
 */
export function PlaybackBar({
  playing,
  time,
  duration,
  speed,
  takeoffMs,
  offsetMin,
  disabled = false,
  onTogglePlay,
  onScrub,
  onSpeed,
}: {
  playing: boolean;
  time: number;
  duration: number;
  speed: number;
  takeoffMs: number;
  offsetMin: number;
  disabled?: boolean;
  onTogglePlay: () => void;
  onScrub: (t: number) => void;
  onSpeed: (s: number) => void;
}) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={disabled}
        className="h-9 w-16 shrink-0 rounded-md bg-amber font-condensed font-bold text-ink hover:bg-amber-strong disabled:opacity-50"
      >
        {playing ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.round(duration))}
        step={1}
        value={Math.min(Math.round(time), Math.round(duration))}
        onChange={(e) => onScrub(Number(e.target.value))}
        disabled={disabled}
        className="flex-1 accent-amber"
      />
      <span className="w-20 shrink-0 text-right font-mono text-sm text-gray-600">
        {disabled ? "--:--:--" : clock(time, takeoffMs, offsetMin)}
      </span>
      <select
        value={speed}
        onChange={(e) => onSpeed(Number(e.target.value))}
        disabled={disabled}
        className={cn(
          "h-9 shrink-0 rounded-md border border-gray-300 bg-paper px-2 font-condensed text-sm font-bold text-ink outline-none focus:border-amber disabled:opacity-50",
        )}
        title="Playback speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </Card>
  );
}
