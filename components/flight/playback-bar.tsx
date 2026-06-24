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

/**
 * Shared replay transport — play/pause, scrubber, speed. Drives the one timeline
 * that both the 2D map and the 3D replay read from (lifted into FlightViz).
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
  hint,
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
  hint?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={disabled}
          className="h-9 w-16 rounded-md bg-amber font-condensed font-bold text-ink hover:bg-amber-strong disabled:opacity-50"
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
        <span className="w-20 text-right font-mono text-sm text-gray-600">
          {disabled ? "--:--:--" : clock(time, takeoffMs, offsetMin)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Speed</span>
        {[4, 8, 16, 32].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSpeed(s)}
            className={cn(
              "rounded px-2 py-0.5",
              speed === s ? "bg-ink text-paper" : "bg-gray-100 text-gray-600",
            )}
          >
            {s}×
          </button>
        ))}
        {hint && <span className="ml-auto text-right">{hint}</span>}
      </div>
    </Card>
  );
}
