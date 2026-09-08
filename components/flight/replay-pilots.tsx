"use client";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { Avatar } from "@/components/avatar";
import type { useGroupReplay } from "./use-group-replay";
import type { ReplayPilot } from "@/lib/flights/group-replay";

export function ReplayPilots({ group, primaryOwnerId, viewerId, onSelect, onToggle, offsetMin }: {
  group: ReturnType<typeof useGroupReplay>;
  primaryOwnerId: string;
  viewerId: string | null;
  onSelect: (pilot: ReplayPilot, flightId?: string) => void;
  onToggle: (pilotId: string) => void;
  offsetMin: number;
}) {
  return <div className="absolute right-2 top-[120px] z-20 flex max-h-[calc(100%-170px)] max-w-[150px] flex-col gap-2 overflow-y-auto rounded-lg bg-paper/95 p-2 shadow-md sm:top-3 sm:max-h-[calc(100%-70px)]" aria-label="Pilots in this replay">
    {group.pilots.map((pilot) => {
      const shown = group.isVisible(pilot.id), selected = group.selected?.owner.id === pilot.id;
      const flights = group.candidates.filter((f) => f.owner.id === pilot.id);
      const loading = shown && !group.flights.some((f) => f.owner.id === pilot.id);
      const failed = flights.some((f) => group.failures.includes(f.id));
      return <div key={pilot.id} className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => onSelect(pilot)} aria-label={`Follow ${pilot.displayName}`} aria-pressed={selected}
            className={`rounded-full p-1 ${selected ? "bg-ink outline-2 outline-offset-1 outline-ink" : ""}`} title={`${pilot.displayName}${pilot.id === primaryOwnerId ? " · Primary flight" : ""}`}>
            <span className={`block rounded-full border-[3px] ${shown ? "" : "opacity-40"}`} style={{ borderColor: pilot.id === primaryOwnerId ? "#d8ff00" : "#0099ff" }}>
              <Avatar {...pilot} className="h-9 w-9 text-sm" />
            </span>
          </button>
          <button type="button" aria-label={`${shown ? "Hide" : "Show"} ${pilot.displayName}`} title={`${shown ? "Hide" : "Show"} ${pilot.displayName}`}
            onClick={() => onToggle(pilot.id)} disabled={shown && !group.visibleFlights.some((f) => f.owner.id !== pilot.id)} className="grid h-10 w-10 place-items-center rounded hover:bg-gray-200 disabled:opacity-30">
            {shown ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
        </div>
        <span className="max-w-full truncate text-[11px] font-medium" title={pilot.displayName}>{pilot.displayName}{pilot.id === viewerId ? " · You" : ""}</span>
        {pilot.id === primaryOwnerId && <span className="text-[10px] text-gray-600">Primary flight</span>}
        {loading && <span className="text-[10px] text-gray-600">{failed ? "Unavailable" : "Loading…"}</span>}
        {flights.length > 1 && <select aria-label={`${pilot.displayName} flight`} className="w-full max-w-[125px] rounded border text-[10px]" value={selected ? group.selected!.id : "auto"}
          onChange={(event) => onSelect(pilot, event.target.value)}>
          <option value="auto">Follow pilot</option>
          {flights.map((f) => <option key={f.id} value={f.id}>{new Date(f.takeoffMs + offsetMin * 60_000).toISOString().slice(11, 16)} takeoff</option>)}
        </select>}
      </div>;
    })}
    {viewerId && <button type="button" aria-label="Refresh friends" disabled={group.discovering} onClick={() => void group.discover()} className="flex items-center justify-center gap-1 rounded py-2 text-[11px] hover:bg-gray-200"><RefreshCw className={`h-3 w-3 ${group.discovering ? "animate-spin" : ""}`} />Refresh friends</button>}
    {group.nextCursor && <button type="button" disabled={group.discovering} onClick={() => void group.discover(true)} className="text-[11px] underline">Find more flights</button>}
    {(group.failures.length > 0 || group.photoFailures.length > 0) && <button type="button" onClick={group.retry} className="text-[11px] underline">Retry flight / photos</button>}
    <span role="status" className="text-center text-[10px] text-gray-600">{group.discoveryError ? "Could not refresh friends" : group.discovering ? "Finding nearby flights…" : ""}</span>
  </div>;
}
