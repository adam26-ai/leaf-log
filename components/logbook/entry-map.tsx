"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAPS, hasMapTiler, styleFor, type BasemapId } from "@/components/flight/basemaps";

export function EntryMap({ lat: latitude, lon: longitude, label = "Flying site", onPick }: { lat: number | null; lon: number | null; label?: string; onPick?: (lat: number, lon: number) => void }) {
  const lat = latitude != null && Number.isFinite(latitude) && Math.abs(latitude) <= 90 ? latitude : null;
  const lon = longitude != null && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? longitude : null;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const initial = useRef({ lat, lon });
  const [basemap, setBasemap] = useState<BasemapId>("streets");
  const [error, setError] = useState(false);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);
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
      return () => { observer.disconnect(); marker.current?.remove(); marker.current = null; instance.remove(); map.current = null; };
    } catch { queueMicrotask(() => setError(true)); }
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) { marker.current?.remove(); marker.current = null; return; }
    if (!marker.current) marker.current = new maplibregl.Marker({ color: "#0099ff" }).setLngLat([lon, lat]).addTo(instance);
    marker.current.setLngLat([lon, lat]);
    instance.easeTo({ center: [lon, lat], zoom: Math.max(instance.getZoom(), 11), duration: 350 });
  }, [lat, lon]);
  return <div className="overflow-hidden rounded-xl border border-gray-200">
    <div className="flex items-center justify-between gap-3 bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <span>{onPick ? "Click the map to set the site location" : `${label} · approximate site location`}</span>
      <select aria-label="Site map style" value={basemap} onChange={event => { const next = event.target.value as BasemapId; setBasemap(next); map.current?.setStyle(styleFor(next)); }} className="rounded border border-gray-300 bg-white p-1">
        {BASEMAPS.filter(item => !item.needsKey || hasMapTiler()).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </div>
    <div ref={container} aria-label="Flight site map" className="h-80 w-full bg-gray-100 sm:h-96" />
    {error && <p role="status" className="p-3 text-sm text-gray-600">The map is unavailable on this device. You can still enter coordinates below.</p>}
  </div>;
}
