"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { EntrySite } from "@/lib/logbook/options";
import { searchPlaces, type MapPlace } from "@/lib/logbook/place-search";

export function EntryMapSearch({ sites, onLocate }: { sites: EntrySite[]; onLocate: (place: MapPlace) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [siteMatches, setSiteMatches] = useState<EntrySite[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  useEffect(() => () => request.current?.abort(), []);

  function reset() {
    request.current?.abort();
    request.current = null;
    setPending(false);
    setPlaces([]);
    setSiteMatches([]);
    setMessage("");
  }

  async function search() {
    reset();
    const text = query.trim();
    if (text.length < 2) { setMessage("Enter at least two characters to search."); return; }
    const normalize = (name: string) => name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
    const matches = sites.filter(site => normalize(site.name).includes(normalize(text))).slice(0, 5);
    setSiteMatches(matches);
    if (!key) {
      setMessage("City and landmark search is unavailable. You can search known flying sites or move the map.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const results = await searchPlaces(text, key, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      setPlaces(results);
      if (!results.length && !matches.length) setMessage("No places found. Try a nearby city or a different spelling.");
    } catch {
      if (request.current === controller) setMessage("Place search is unavailable right now. Try again, choose a known site, or move the map.");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) setPending(false);
    }
  }

  function locate(place: MapPlace) {
    reset();
    onLocate(place);
    setMessage(`Map moved to ${place.name}.`);
  }

  return <div className="space-y-2 border-b border-gray-200 p-3">
    <label htmlFor={id} className="block text-sm font-medium text-gray-700">Find a place</label>
    <div className="flex gap-2">
      <input id={id} type="search" value={query} maxLength={200} placeholder="City, landmark, or flying site" autoComplete="off"
        onChange={event => { reset(); setQuery(event.target.value); }}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (!event.nativeEvent.isComposing && !pending) void search();
          }
        }}
        className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25" />
      <button type="button" disabled={pending || query.trim().length < 2} onClick={() => void search()}
        className="shrink-0 rounded-md bg-brand-blue px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "Searching…" : "Search"}</button>
    </div>
    <p className="text-xs text-gray-500">Find a nearby place, then click the map to set the exact location.</p>
    {siteMatches.length > 0 && <div>
      <p className="py-1 text-xs font-medium text-gray-500">Flying sites</p>
      <ul className="divide-y divide-gray-100">
        {siteMatches.map(site => <li key={site.id}><button type="button" onClick={() => locate(site)} className="w-full rounded px-2 py-2 text-left text-sm text-ink hover:bg-gray-50 focus-visible:bg-gray-50">
          {site.name}{" "}<span className="ml-2 text-xs text-gray-500">{site.previous ? "From your logbook" : "Known site"}</span>
        </button></li>)}
      </ul>
    </div>}
    {places.length > 0 && <div>
      <p className="py-1 text-xs font-medium text-gray-500">Places</p>
      <ul className="divide-y divide-gray-100">
        {places.map(place => <li key={place.id}><button type="button" onClick={() => locate(place)} className="w-full rounded px-2 py-2 text-left text-sm text-ink hover:bg-gray-50 focus-visible:bg-gray-50">{place.name}</button></li>)}
      </ul>
      <p className="pt-1 text-xs text-gray-500">Search: <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noreferrer" className="underline">© MapTiler</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">© OpenStreetMap contributors</a></p>
    </div>}
    <p role="status" className="text-xs text-gray-600">{pending ? "Searching places…" : message || (places.length + siteMatches.length > 0 ? `${places.length + siteMatches.length} ${places.length + siteMatches.length === 1 ? "result" : "results"}. Choose a place to move the map.` : "")}</p>
  </div>;
}
