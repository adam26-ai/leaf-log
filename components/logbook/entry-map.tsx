"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS, hasMapTiler, styleFor, type BasemapId } from "@/components/flight/basemaps";
import type { EntrySite } from "@/lib/logbook/options";
import { EntryMapSearch } from "./entry-map-search";

export function EntryMap({ lat: latitude, lon: longitude, landingLat: landingLatitude = null, landingLon: landingLongitude = null, label = "Flying site", sites = [], onPick, onPickLanding, draggable = false }: {
  lat: number | null; lon: number | null; landingLat?: number | null; landingLon?: number | null;
  label?: string; sites?: EntrySite[];
  onPick?: (lat: number, lon: number) => void; onPickLanding?: (lat: number, lon: number) => void;
  draggable?: boolean;
}) {
  const lat = latitude != null && Number.isFinite(latitude) && Math.abs(latitude) <= 90 ? latitude : null;
  const lon = longitude != null && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? longitude : null;
  const landingLat = landingLatitude != null && Number.isFinite(landingLatitude) && Math.abs(landingLatitude) <= 90 ? landingLatitude : null;
  const landingLon = landingLongitude != null && Number.isFinite(landingLongitude) && Math.abs(landingLongitude) <= 180 ? landingLongitude : null;
  const [placement, setPlacement] = useState<"takeoff" | "landing">("takeoff");
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const landingMarker = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const onTakeoffPickRef = useRef(onPick);
  const onLandingPickRef = useRef(onPickLanding);
  const initial = useRef(lat != null && lon != null ? { lat, lon } : { lat: landingLat, lon: landingLon });
  const [basemap, setBasemap] = useState<BasemapId>("streets");
  const [error, setError] = useState(false);
  useEffect(() => {
    onPickRef.current = placement === "landing" && onPickLanding ? onPickLanding : onPick;
    onTakeoffPickRef.current = onPick;
    onLandingPickRef.current = onPickLanding;
  }, [onPick, onPickLanding, placement]);
  useEffect(() => {
    if (!container.current) return;
    try {
      const { lat: y, lon: x } = initial.current;
      const instance = new maplibregl.Map({ container: container.current, style: styleFor("streets"), center: x != null && y != null ? [x, y] : [0, 25], zoom: x != null && y != null ? 11 : 1 });
      map.current = instance;
      instance.addControl(new maplibregl.NavigationControl(), "top-left");
      instance.on("click", event => onPickRef.current?.(Number(event.lngLat.lat.toFixed(6)), Number(event.lngLat.wrap().lng.toFixed(6))));
      const observer = new ResizeObserver(() => instance.resize());
      observer.observe(container.current);
      return () => { observer.disconnect(); marker.current?.remove(); marker.current = null; landingMarker.current?.remove(); landingMarker.current = null; instance.remove(); map.current = null; };
    } catch { queueMicrotask(() => setError(true)); }
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    function updateMarker(ref: typeof marker, y: number | null, x: number | null, color: string, name: string, picker: typeof onTakeoffPickRef) {
      if (y == null || x == null) { ref.current?.remove(); ref.current = null; return; }
      if (!ref.current) {
        ref.current = new maplibregl.Marker({ color, draggable: draggable && Boolean(picker.current) }).setLngLat([x, y]).addTo(instance!);
        if (draggable && picker.current) {
          ref.current.on("dragend", () => {
            const point = ref.current?.getLngLat();
            if (point) picker.current?.(Number(point.lat.toFixed(6)), Number(point.wrap().lng.toFixed(6)));
          });
        }
        ref.current.getElement().setAttribute("role", "img");
        ref.current.getElement().setAttribute("aria-label", name);
        ref.current.getElement().title = name;
      }
      ref.current.setLngLat([x, y]);
    }
    updateMarker(marker, lat, lon, "#0099ff", "Flying site pin (blue)", onTakeoffPickRef);
    updateMarker(landingMarker, landingLat, landingLon, "#ea580c", "Landing pin (orange)", onLandingPickRef);
    if (lat != null && lon != null && landingLat != null && landingLon != null) {
      // Fit the shorter span when a flight crosses the antimeridian.
      const endLon = landingLon + 360 * Math.round((lon - landingLon) / 360);
      instance.fitBounds([Math.min(lon, endLon), Math.min(lat, landingLat), Math.max(lon, endLon), Math.max(lat, landingLat)], { padding: 50, maxZoom: 13, duration: 350 });
    } else {
      const point: [number, number] | null = lat != null && lon != null ? [lon, lat] : landingLat != null && landingLon != null ? [landingLon, landingLat] : null;
      if (point) instance.easeTo({ center: point, zoom: Math.max(instance.getZoom(), 11), duration: 350 });
    }
  }, [lat, lon, landingLat, landingLon, draggable]);
  return <div className="overflow-hidden rounded-xl border border-gray-200">
    {onPick && onPickLanding && <div role="group" aria-label="Location to place" className="flex flex-wrap gap-2 border-b border-gray-200 p-3">
      <button type="button" aria-pressed={placement === "takeoff"} onClick={() => setPlacement("takeoff")} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${placement === "takeoff" ? "border-brand-blue bg-blue-50 text-ink" : "border-gray-200 text-gray-600"}`}>
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-brand-blue" />Flying site
      </button>
      <button type="button" aria-pressed={placement === "landing"} onClick={() => setPlacement("landing")} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${placement === "landing" ? "border-orange-600 bg-orange-50 text-ink" : "border-gray-200 text-gray-600"}`}>
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-orange-600" />Landing
      </button>
    </div>}
    {onPick && !error && <EntryMapSearch sites={sites} onLocate={place => {
      const instance = map.current;
      if (!instance) return;
      if (place.bounds) instance.fitBounds(place.bounds, { padding: 40, maxZoom: 13, duration: 350 });
      else instance.easeTo({ center: [place.lon, place.lat], zoom: 12, duration: 350 });
      instance.getCanvas().focus();
    }} />}
    <div className="flex items-center justify-between gap-3 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <span>{onPick ? `${draggable ? "Drag the pin or click the map" : "Click the map"} to set the ${placement === "landing" ? "landing location" : "flying site"}` : `${label} · approximate site location`}</span>
      <select aria-label="Site map style" value={basemap} onChange={event => { const next = event.target.value as BasemapId; setBasemap(next); map.current?.setStyle(styleFor(next)); }} className="rounded border border-gray-300 bg-white p-1">
        {BASEMAPS.filter(item => !item.needsKey || hasMapTiler()).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </div>
    <div ref={container} aria-label="Flight site map" className="h-80 w-full bg-gray-100 sm:h-96" />
    {error && <p role="status" className="p-3 text-sm text-gray-600">The map is unavailable on this device. You can still enter coordinates in the fields.</p>}
  </div>;
}
