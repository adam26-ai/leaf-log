"use client";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Mountain, Trophy, ChevronDown, CalendarDays, Users } from "lucide-react";
import { WingIcon } from "@/components/icons/wing-icon";
import type { FlightListItem } from "@/lib/flights/repo";
import type { FlightTrophy } from "@/lib/flights/trophies";
import { EMPTY_FILTERS, flightCalendarDate, matchesDateRange, readLogbookFilters, siteKey, wingKey, type LogbookFilters } from "@/lib/flights/logbook-filters";
import { listHighlights } from "@/lib/flights/list-highlights";
import { formatDuration } from "@/lib/flights/format";
import { FlightRow } from "./flight-row";
import { StatsBar } from "./stats-bar";

function FilterChoices({ label, icon, options = [], selected = null, active = selected !== null, allIncludesEveryFlight = true, onChange, open, onOpenChange, children }: { label: string; icon: ReactNode; options?: { key: string; label: string }[]; selected?: string[] | null; active?: boolean; allIncludesEveryFlight?: boolean; onChange?: (keys: string[] | null) => void; open: boolean; onOpenChange: (open: boolean) => void; children?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onOpenChange(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onOpenChange]);
  return <div ref={root} className="static sm:relative">
    <button ref={trigger} type="button" aria-label={`Select ${label}`} aria-expanded={open} aria-controls={panelId} onClick={() => onOpenChange(!open)} className={`flex h-9 touch-manipulation items-center gap-1.5 rounded-md border px-2 text-xs ${active ? "border-brand-blue bg-brand-blue text-white" : "border-gray-300 bg-white text-gray-600"}`}>{icon}{label}<ChevronDown className="h-3 w-3" /></button>
    {open && <div id={panelId} role="group" aria-label={`${label} choices`} className="absolute right-0 top-full z-40 mt-1 max-h-72 w-64 max-w-[85vw] overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-lg">
      {onChange && <><div className="mb-2 flex gap-3"><button type="button" onClick={() => onChange(null)} className="underline">{allIncludesEveryFlight ? "All" : "Clear"}</button>{allIncludesEveryFlight && <button type="button" onClick={() => onChange([])} className="underline">None</button>}</div>
      {options.map(o => <label key={o.key} className="flex min-h-9 cursor-pointer touch-manipulation items-center gap-2 py-1"><input type="checkbox" checked={selected === null ? allIncludesEveryFlight : selected.includes(o.key)} onChange={e => {
        const current = selected ?? (allIncludesEveryFlight ? options.map(option => option.key) : []);
        const next = e.target.checked ? [...current, o.key] : current.filter(k => k !== o.key);
        onChange((allIncludesEveryFlight ? options.every(option => next.includes(option.key)) : next.length === 0) ? null : next);
      }} />{o.label}</label>)}</>}
      {children}
    </div>}
  </div>;
}

export function LogbookList({ flights, trophies, ownerId }: { flights: FlightListItem[]; trophies: Record<string, FlightTrophy[]>; ownerId?: string }) {
  const sites = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    flights.forEach(f => { const key = siteKey(f), entry = counts.get(key) ?? { name: f.takeoffSiteName ?? "Unknown site", count: 0 }; entry.count++; counts.set(key, entry); });
    return [...counts].sort((a,b) => a[1].name.localeCompare(b[1].name)).map(([key, entry]) => ({ key, label: `${entry.name} (${entry.count})` }));
  }, [flights]);
  const wings = useMemo(() => {
    const counts = new Map<string, number>();
    flights.forEach(f => counts.set(wingKey(f), (counts.get(wingKey(f)) ?? 0) + (f.durationS ?? 0)));
    return [...counts].sort((a,b) => a[0].localeCompare(b[0])).map(([key, seconds]) => ({ key, label: `${key} (${formatDuration(seconds)})` }));
  }, [flights]);
  const storageKey = ownerId ? `leaf-logbook-filters:v1:${ownerId}` : null;
  const [filters, setFilters] = useState<LogbookFilters>(EMPTY_FILTERS);
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const [openChoices, setOpenChoices] = useState<"sites" | "wings" | "friends" | "dates" | null>(null);
  const [friends, setFriends] = useState<{ key: string; label: string; flightIds: string[] }[] | null>(null);
  const [friendError, setFriendError] = useState(false);
  const [retryFriends, setRetryFriends] = useState(0);
  useEffect(() => {
    // Browser-only storage is restored after hydration, scoped to the signed-in pilot.
    let saved = EMPTY_FILTERS;
    try { if (storageKey) saved = readLogbookFilters(sessionStorage.getItem(storageKey)); } catch { /* Storage may be disabled. */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize external browser session state after hydration.
    setFilters(saved);
    setRestoredKey(storageKey);
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || restoredKey !== storageKey) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(filters)); } catch { /* Filtering still works without storage. */ }
  }, [filters, storageKey, restoredKey]);
  // Companion matches now power both the Friends filter and the per-flight badge.
  const needsFriends = Boolean(ownerId) || openChoices === "friends" || Boolean(filters.friends?.length);
  useEffect(() => {
    if (!needsFriends || friends !== null) return;
    const controller = new AbortController();
    fetch("/api/logbook/companions", { signal: controller.signal, cache: "no-store" })
      .then(response => { if (!response.ok) throw new Error("Could not load friends"); return response.json(); })
      .then(data => { if (!controller.signal.aborted) { setFriends(data.friends); setFriendError(false); } })
      .catch(() => { if (!controller.signal.aborted) setFriendError(true); });
    return () => controller.abort();
  }, [needsFriends, friends, retryFriends]);
  const update = (patch: Partial<LogbookFilters>) => setFilters(current => ({ ...current, ...patch }));
  const friendFlightIds = new Set(friends?.filter(friend => filters.friends?.includes(friend.key)).flatMap(friend => friend.flightIds));
  const sharedFlightIds = new Set(friends?.flatMap(friend => friend.flightIds));
  const visible = flights.filter(f =>
    (filters.sites === null || filters.sites.includes(siteKey(f))) &&
    (filters.wings === null || filters.wings.includes(wingKey(f))) &&
    (filters.friends === null || friendFlightIds.has(f.id)) &&
    (!filters.trophiesOnly || Boolean(trophies[f.id]?.length)) &&
    matchesDateRange(flightCalendarDate(f), filters.from, filters.until));
  const ready = visible.filter(f => f.status === "ready");
  const { highlightScore, distanceScore } = listHighlights(flights);
  return <>
    <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
      <StatsBar stats={{ totalSeconds: ready.reduce((s,f) => s + (f.durationS ?? 0), 0), flightCount: ready.length, unknownDurationCount: ready.filter(f => f.durationS == null).length, siteCount: new Set(ready.map(siteKey).filter(key => key !== "unknown")).size }} />
      <div className="relative max-w-full pt-6">
        {Object.values(filters).some(value => value !== null && value !== "" && value !== false) && <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="absolute right-0 top-0 text-xs text-gray-600 underline">Clear filters</button>}
        <div className="relative flex flex-wrap items-center gap-2" aria-label="Logbook filters">
        <FilterChoices icon={<Mountain className="h-4 w-4" />} open={openChoices === "sites"} onOpenChange={open => setOpenChoices(open ? "sites" : null)} label="Sites" options={sites} selected={filters.sites} onChange={sites => update({ sites })} />
        <FilterChoices icon={<WingIcon aria-hidden="true" className="h-5 w-5" />} open={openChoices === "wings"} onOpenChange={open => setOpenChoices(open ? "wings" : null)} label="Wings" options={wings} selected={filters.wings} onChange={wings => update({ wings })} />
        <FilterChoices icon={<Users className="h-4 w-4" />} open={openChoices === "friends"} onOpenChange={open => setOpenChoices(open ? "friends" : null)} label="Friends" options={friends ?? []} selected={filters.friends} allIncludesEveryFlight={false} onChange={friends => update({ friends })}>
          <p className="mt-2 text-xs text-gray-500">Flights with overlapping airtime and nearby routes.</p>
          {friends === null && <p role="status" className="mt-2 text-xs">{friendError ? <button type="button" className="underline" onClick={() => { setFriendError(false); setRetryFriends(value => value + 1); }}>Could not load friends. Retry</button> : "Finding shared flights…"}</p>}
          {friends?.length === 0 && <p className="mt-2 text-xs text-gray-500">No shared flights found.</p>}
        </FilterChoices>
        <button type="button" aria-label="Trophies" aria-pressed={filters.trophiesOnly} onClick={() => { setOpenChoices(null); update({ trophiesOnly: !filters.trophiesOnly }); }} className={`flex h-9 touch-manipulation items-center gap-1.5 rounded-md border px-2 text-xs ${filters.trophiesOnly ? "border-brand-blue bg-brand-blue text-white" : "border-gray-300 bg-white text-gray-600"}`}><Trophy className="h-4 w-4" aria-hidden="true" />Trophies</button>
        <FilterChoices icon={<CalendarDays className="h-4 w-4" />} open={openChoices === "dates"} onOpenChange={open => setOpenChoices(open ? "dates" : null)} label="Dates" active={Boolean(filters.from || filters.until)}>
          <div className="mb-2 flex gap-3"><button type="button" onClick={() => update({ from: "", until: "" })} className="underline">Clear</button></div>
          <div className="flex flex-col gap-3 p-1">
            <label className="flex flex-col gap-1 text-xs">From<input type="date" value={filters.from} max={filters.until || undefined} onChange={event => update({ from: event.target.value })} className="min-w-0 rounded border border-gray-300 px-2 py-2 text-sm" /></label>
            <label className="flex flex-col gap-1 text-xs">Until<input type="date" value={filters.until} min={filters.from || undefined} onChange={event => update({ until: event.target.value })} className="min-w-0 rounded border border-gray-300 px-2 py-2 text-sm" /></label>
          </div>
        </FilterChoices>
        </div>
      </div>
    </div>
    <p className="mt-3 text-xs text-gray-500" role="status">{visible.length} of {flights.length} {flights.length === 1 ? "flight" : "flights"}</p>
    <ul className="mt-3 flex flex-col gap-1">
      {visible.map(f => <li key={f.id}><FlightRow flight={f} compact showAnalysis friendFlightsFound={sharedFlightIds.has(f.id)} trophies={trophies[f.id] ?? []} highlightScore={highlightScore(f)} distanceScore={distanceScore(f)} /></li>)}
    </ul>
    {!visible.length && <p className="py-8 text-center text-gray-500">{Boolean(filters.friends?.length) && friends === null ? friendError ? "Could not load shared flights. Open Friends to retry." : "Finding shared flights…" : "No flights match these filters."}</p>}
  </>;
}
