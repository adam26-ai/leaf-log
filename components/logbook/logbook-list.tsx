"use client";
import { useMemo, useState } from "react";
import { Mountain, Triangle, Trophy, ChevronDown } from "lucide-react";
import type { FlightListItem } from "@/lib/flights/repo";
import type { FlightTrophy } from "@/lib/flights/trophies";
import { matchesLogbookFilters, siteKey, wingKey } from "@/lib/flights/logbook-filters";
import { listHighlights } from "@/lib/flights/list-highlights";
import { formatDuration } from "@/lib/flights/format";
import { FlightRow } from "./flight-row";
import { StatsBar } from "./stats-bar";

function FilterChoices({ label, options, selected, onChange }: { label: string; options: { key: string; label: string }[]; selected: string[]; onChange: (keys: string[]) => void }) {
  return <details className="static sm:relative">
    <summary aria-label={`Select ${label}`} className="flex h-9 cursor-pointer list-none items-center gap-1 rounded-md border border-gray-300 px-2 text-xs">{label}<ChevronDown className="h-3 w-3" /></summary>
    <div className="absolute right-0 top-full z-40 mt-1 max-h-72 w-64 max-w-[85vw] overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 text-sm shadow-lg">
      <div className="mb-2 flex gap-3"><button type="button" onClick={() => onChange(options.map(o => o.key))} className="underline">All</button><button type="button" onClick={() => onChange([])} className="underline">None</button></div>
      {options.map(o => <label key={o.key} className="flex items-center gap-2 py-1"><input type="checkbox" checked={selected.includes(o.key)} onChange={e => onChange(e.target.checked ? [...selected, o.key] : selected.filter(k => k !== o.key))} />{o.label}</label>)}
    </div>
  </details>;
}

export function LogbookList({ flights, trophies }: { flights: FlightListItem[]; trophies: Record<string, FlightTrophy[]> }) {
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
  const [siteFilter, setSiteFilter] = useState(false), [wingFilter, setWingFilter] = useState(false), [trophyFilter, setTrophyFilter] = useState(false);
  const [selectedSites, setSelectedSites] = useState<string[]>(sites.map(s => s.key));
  const [selectedWings, setSelectedWings] = useState<string[]>(wings.map(w => w.key));
  const trophyIds = new Set(Object.keys(trophies));
  const visible = flights.filter(f => matchesLogbookFilters(f, siteFilter ? selectedSites : null, wingFilter ? selectedWings : null, trophyFilter, trophyIds));
  const ready = visible.filter(f => f.status === "ready");
  const { highlightScore, distanceScore } = listHighlights(flights);
  const toggleClass = (active: boolean) => `grid h-9 w-9 place-items-center rounded-md border ${active ? "border-brand-blue bg-brand-blue text-white" : "border-gray-300 bg-white text-gray-600"}`;
  return <>
    <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
      <StatsBar stats={{ totalSeconds: ready.reduce((s,f) => s + (f.durationS ?? 0), 0), flightCount: ready.length, siteCount: new Set(ready.map(siteKey).filter(key => key !== "unknown")).size }} />
      <div className="relative flex flex-wrap items-center gap-2" aria-label="Logbook filters">
        <div className="flex gap-1"><button type="button" aria-label="Filter by site" aria-pressed={siteFilter} onClick={() => setSiteFilter(!siteFilter)} className={toggleClass(siteFilter)}><Mountain className="h-4 w-4" /></button><FilterChoices label="Sites" options={sites} selected={selectedSites} onChange={keys => { setSelectedSites(keys); setSiteFilter(true); }} /></div>
        <div className="flex gap-1"><button type="button" aria-label="Filter by wing" aria-pressed={wingFilter} onClick={() => setWingFilter(!wingFilter)} className={toggleClass(wingFilter)}><Triangle className="h-4 w-4" /></button><FilterChoices label="Wings" options={wings} selected={selectedWings} onChange={keys => { setSelectedWings(keys); setWingFilter(true); }} /></div>
        <button type="button" aria-label="Only flights with trophies" aria-pressed={trophyFilter} onClick={() => setTrophyFilter(!trophyFilter)} className={toggleClass(trophyFilter)}><Trophy className="h-4 w-4" /></button>
      </div>
    </div>
    <p className="mt-3 text-xs text-gray-500" role="status">{visible.length} of {flights.length} flights · Trophies rank your full logbook</p>
    <ul className="mt-3 flex flex-col gap-1">
      {visible.map(f => <li key={f.id}><FlightRow flight={f} compact trophies={trophies[f.id] ?? []} highlightScore={highlightScore(f)} distanceScore={distanceScore(f)} /></li>)}
    </ul>
    {!visible.length && <p className="py-8 text-center text-gray-500">No flights match these filters.</p>}
  </>;
}
