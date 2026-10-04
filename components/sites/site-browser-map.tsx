"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleFor, type BasemapId } from "@/components/flight/basemaps";
import { SiteMapControls } from "@/components/flight/site-map-controls";
import { hasSitePoint, type SitePoint } from "@/lib/sites/model";
import type { Boundary } from "@/lib/sites/geo";
import { LocateFixed } from "lucide-react";

export type MapSite = { id: string; name: string; visibility: string; lat: number | null; lon: number | null; boundary?: Boundary | null };

export function SiteBrowserMap({ sites, selectedId, initialPoint, onSelect }: {
  sites: MapSite[]; selectedId: string | null; initialPoint: SitePoint | null;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const current = useRef({ sites, selectedId, onSelect });
  const initial = useRef(initialPoint);
  const previousSelection = useRef(selectedId);
  const redraw = useRef<(() => void) | null>(null);
  const redrawBoundaries = useRef<(() => void) | null>(null);
  const locate = useRef<(() => void) | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>("streets");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    current.current = { sites, selectedId, onSelect };
    redraw.current?.();
    redrawBoundaries.current?.();
    const map = mapRef.current;
    const selected = sites.find(site => site.id === selectedId);
    if (map && previousSelection.current !== selectedId && selected && hasSitePoint(selected)) {
      map.easeTo({ center: [selected.lon, selected.lat], zoom: Math.max(map.getZoom(), 12), duration: 350 });
    }
    previousSelection.current = selectedId;
  }, [sites, selectedId, onSelect]);

  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    let map: maplibregl.Map;
    let disposed = false;
    try {
      const point = initial.current;
      map = new maplibregl.Map({ container: element, style: styleFor("streets"),
        center: point ? [point.lon, point.lat] : [0, 25],
        zoom: point ? 11 : 1.5,
        attributionControl: { compact: true },
      });
    } catch { queueMicrotask(() => { if (!disposed) setFailed(true); }); return () => { disposed = true; }; }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const boundaryData = (): GeoJSON.FeatureCollection<GeoJSON.Polygon> => ({
      type: "FeatureCollection",
      features: current.current.sites.flatMap(site => site.boundary ? [{
        type: "Feature" as const, id: site.id, geometry: site.boundary.geometry,
        properties: { color: current.current.selectedId === site.id ? "#d8ff00" : site.visibility === "public" ? "#0099ff" : "#7c3aed",
          selected: current.current.selectedId === site.id },
      }] : []),
    });
    redrawBoundaries.current = () => {
      (map.getSource("site-boundaries") as maplibregl.GeoJSONSource | undefined)?.setData(boundaryData());
    };
    // Recreate overlays after switching between the map and satellite styles.
    map.on("style.load", () => {
      map.addSource("site-boundaries", { type: "geojson", data: boundaryData() });
      map.addLayer({ id: "site-boundaries-fill", type: "fill", source: "site-boundaries", minzoom: 11,
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.08 } });
      map.addLayer({ id: "site-boundaries-outline", type: "line", source: "site-boundaries", minzoom: 11,
        paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "selected"], 3, 2] } });
    });
    const markers = new Map<string, { marker: maplibregl.Marker; button: HTMLButtonElement }>();
    const paint = () => {
      const visible = new Set<string>();
      const bounds = map.getBounds();
      for (const site of current.current.sites) {
        if (!hasSitePoint(site)) continue;
        // Only mount DOM pins in the viewport; every accessible site remains
        // available as the user pans, without thousands of offscreen buttons.
        const lon = site.lon + 360 * Math.round((map.getCenter().lng - site.lon) / 360);
        if (!bounds.contains([lon, site.lat])) continue;
        visible.add(site.id);
        let pin = markers.get(site.id);
        if (!pin) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "h-6 w-6 rounded-full border-2 border-white shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black";
          button.addEventListener("click", event => { event.stopPropagation(); current.current.onSelect(site.id); });
          pin = { button, marker: new maplibregl.Marker({ element: button }).setLngLat([lon, site.lat]).addTo(map) };
          markers.set(site.id, pin);
        }
        pin.marker.setLngLat([lon, site.lat]);
        pin.button.title = site.name;
        pin.button.setAttribute("aria-label", `Select ${site.name}`);
        pin.button.setAttribute("aria-pressed", String(current.current.selectedId === site.id));
        pin.button.style.backgroundColor = site.visibility === "public" ? "#0099ff" : "#7c3aed";
        pin.button.style.boxShadow = current.current.selectedId === site.id ? "0 0 0 4px #d8ff00, 0 2px 6px #0006" : "0 2px 6px #0006";
        pin.button.style.zIndex = current.current.selectedId === site.id ? "2" : "1";
      }
      for (const [id, pin] of markers) if (!visible.has(id)) { pin.marker.remove(); markers.delete(id); }
    };
    redraw.current = paint;
    map.on("load", paint);
    map.on("moveend", paint);
    map.on("idle", () => { element.dataset.renderReady = "true"; });
    const observer = new ResizeObserver(() => { map.resize(); paint(); });
    observer.observe(element);
    let userMoved = false;
    map.on("movestart", event => { if (event.originalEvent) userMoved = true; });
    const requestLocation = (automatic: boolean) => {
      if (!navigator.geolocation) { if (!automatic) setMessage("Your browser cannot provide a location."); return; }
      if (!automatic) setMessage("Finding your location…");
      navigator.geolocation.getCurrentPosition(position => {
        if (disposed || (automatic && userMoved)) return;
        map.easeTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 11, duration: 350 });
        setMessage("");
      }, () => { if (!disposed && !automatic) setMessage("Location unavailable. You can still browse the map."); },
      { maximumAge: 300000, timeout: 8000, enableHighAccuracy: false });
    };
    locate.current = () => requestLocation(false);
    navigator.permissions?.query({ name: "geolocation" }).then(permission => {
      if (!disposed && permission.state === "granted") requestLocation(true);
    }).catch(() => {});
    return () => {
      disposed = true; observer.disconnect(); markers.forEach(pin => pin.marker.remove());
      map.remove(); mapRef.current = null; redraw.current = null; redrawBoundaries.current = null; locate.current = null;
    };
  }, []);

  return <>
    <div className="relative">
      <div ref={container} data-testid="site-browser-map" data-render-ready="false" className="aspect-[7/5] w-full bg-gray-100" />
      {failed ? <p role="status" className="absolute inset-0 grid place-content-center p-8 text-center text-gray-600">The map could not load. You can still browse sites in the list below.</p>
        : <div className="absolute left-3 top-3 flex flex-wrap gap-2 pr-12">
          <SiteMapControls value={basemap === "streets" ? "monochrome" : basemap} onChange={next => { setBasemap(next); mapRef.current?.setStyle(styleFor(next)); }} />
          <button type="button" aria-label="Use my location" title="Center map on my location" onClick={() => locate.current?.()} className="grid h-8 w-8 place-items-center rounded-md border border-gray-300 bg-paper shadow-sm hover:bg-gray-100"><LocateFixed aria-hidden="true" className="h-4 w-4" /></button>
        </div>}
    </div>
    {message && <p role="status" className="px-4 pt-3 text-sm text-gray-600">{message}</p>}
  </>;
}
