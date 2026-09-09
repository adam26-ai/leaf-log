"use client";
import { Eye, EyeOff, PlaneTakeoff, RefreshCw, Users } from "lucide-react";
import { Avatar } from "@/components/avatar";
import type { useGroupReplay } from "./use-group-replay";
import type { ReplayPilot } from "@/lib/flights/group-replay";

export function ReplayPilots({ group, primaryOwnerId, viewerId, onSelect, onToggle, onTakeoff, offsetMin }: {
  group: ReturnType<typeof useGroupReplay>;
  primaryOwnerId: string;
  viewerId: string | null;
  onSelect: (pilot: ReplayPilot, flightId?: string) => void;
  onToggle: (pilotId: string) => void;
  onTakeoff: (pilot: ReplayPilot) => void;
  offsetMin: number;
}) {
  if (!group.pilots.some((pilot) => pilot.id !== primaryOwnerId)) {
    return viewerId ? <button type="button" aria-label="Refresh friends" disabled={group.discovering}
      title={group.discoveryError ? "Could not find friends' flights. Try again." : "Find nearby friends' flights"}
      onClick={() => void group.discover()}
      className="absolute right-2 top-[95px] z-20 inline-flex h-9 items-center gap-2 rounded-full px-3 text-[var(--replay-group-card-text)] shadow-md hover:bg-[var(--replay-group-card-hover)] disabled:opacity-60 sm:top-3"
      style={{ background: "color-mix(in srgb, var(--replay-group-card-bg) calc(var(--replay-group-card-alpha) * 100%), transparent)" }}>
      <Users className="h-4 w-4" /><RefreshCw className={`h-3.5 w-3.5 ${group.discovering ? "animate-spin" : ""}`} />
      <span role="status" className="sr-only">{group.discoveryError ? "Could not refresh friends" : group.discovering ? "Finding nearby flights" : ""}</span>
    </button> : null;
  }
  return <div className="absolute right-2 top-[95px] z-20 flex max-h-[calc(100%-145px)] w-[150px] flex-col gap-2 overflow-y-auto rounded-lg p-2 text-[var(--replay-group-card-text)] shadow-md sm:top-3 sm:max-h-[calc(100%-70px)]" style={{ background: "color-mix(in srgb, var(--replay-group-card-bg) calc(var(--replay-group-card-alpha) * 100%), transparent)" }} aria-label="Pilots in this replay">
    {group.pilots.map((pilot) => {
      const shown = group.isVisible(pilot.id), selected = group.selected?.owner.id === pilot.id;
      const pilotColor = pilot.id === primaryOwnerId ? "var(--replay-group-primary)" : "var(--replay-group-companion)";
      const flights = group.candidates.filter((f) => f.owner.id === pilot.id);
      const loading = shown && !group.flights.some((f) => f.owner.id === pilot.id);
      const failed = flights.some((f) => group.failures.includes(f.id));
      return <div key={pilot.id} className="flex min-w-0 flex-col items-center gap-1">
        <div className="flex w-full items-center justify-between gap-1">
          <button type="button" onClick={() => onSelect(pilot)} aria-label={`Follow ${pilot.displayName}`} aria-pressed={selected}
            className={`shrink-0 rounded-full p-1 ${selected ? "outline-2 outline-offset-1" : ""}`}
            style={selected ? { backgroundColor: pilotColor, outlineColor: pilotColor } : undefined}
            title={`${pilot.displayName}${pilot.id === primaryOwnerId ? " · Primary flight" : ""}`}>
            <span className={`block rounded-full border-[3px] ${shown ? "" : "opacity-40"}`} style={{ borderColor: pilotColor }}>
              <Avatar {...pilot} className="h-7 w-7 bg-[var(--replay-group-avatar-bg)] text-xs text-[var(--replay-group-avatar-text)]" />
            </span>
          </button>
          <button type="button" aria-label={`Jump to ${pilot.displayName}'s takeoff`} title={`Jump to ${pilot.displayName}'s takeoff`}
            onClick={() => onTakeoff(pilot)} className="grid h-10 w-10 shrink-0 place-items-center rounded hover:bg-[var(--replay-group-card-hover)]">
            <PlaneTakeoff className="h-4 w-4" />
          </button>
          <button type="button" aria-label={`${shown ? "Hide" : "Show"} ${pilot.displayName}`} title={`${shown ? "Hide" : "Show"} ${pilot.displayName}`}
            onClick={() => onToggle(pilot.id)} disabled={shown && !group.visibleFlights.some((f) => f.owner.id !== pilot.id)} className="grid h-10 w-10 shrink-0 place-items-center rounded hover:bg-[var(--replay-group-card-hover)] disabled:opacity-30">
            {shown ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>
        <span className="line-clamp-2 w-full text-center text-[11px] leading-tight font-medium [overflow-wrap:anywhere]" title={pilot.displayName}>{pilot.displayName}{pilot.id === viewerId ? " · You" : ""}</span>
        {pilot.id === primaryOwnerId && <span className="text-[10px] text-[var(--replay-group-card-muted)]">Primary flight</span>}
        {loading && <span className="text-[10px] text-[var(--replay-group-card-muted)]">{failed ? "Unavailable" : "Loading…"}</span>}
        {flights.length > 1 && <select aria-label={`${pilot.displayName} flight`} className="w-full max-w-[125px] rounded border bg-[var(--replay-group-card-bg)] text-[10px]" value={selected ? group.selected!.id : "auto"}
          onChange={(event) => onSelect(pilot, event.target.value)}>
          <option value="auto">Follow pilot</option>
          {flights.map((f) => <option key={f.id} value={f.id}>{new Date(f.takeoffMs + offsetMin * 60_000).toISOString().slice(11, 16)} takeoff</option>)}
        </select>}
      </div>;
    })}
    {viewerId && <button type="button" aria-label="Refresh friends" disabled={group.discovering} onClick={() => void group.discover()} className="flex items-center justify-center gap-1 rounded py-2 text-[11px] hover:bg-[var(--replay-group-card-hover)]"><RefreshCw className={`h-3 w-3 ${group.discovering ? "animate-spin" : ""}`} />Refresh friends</button>}
    {group.nextCursor && <button type="button" disabled={group.discovering} onClick={() => void group.discover(true)} className="text-[11px] underline">Find more flights</button>}
    {(group.failures.length > 0 || group.photoFailures.length > 0) && <button type="button" onClick={group.retry} className="text-[11px] underline">Retry flight / photos</button>}
    <span role="status" className="text-center text-[10px] text-[var(--replay-group-card-muted)]">{group.discoveryError ? "Could not refresh friends" : group.discovering ? "Finding nearby flights…" : ""}</span>
  </div>;
}
