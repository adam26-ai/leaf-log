"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleFor, type BasemapId } from "./basemaps";
import { photoUrl, isPinned, type FlightPhoto } from "./photos";

type LngLat = [number, number];

// A little camera marker (dark disc + white camera) for photo pins.
const CAMERA_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 34 34">' +
  '<circle cx="17" cy="17" r="14" fill="#272727" stroke="#ffffff" stroke-width="2.5"/>' +
  '<rect x="14.2" y="11.8" width="5.6" height="3" rx="1" fill="#ffffff"/>' +
  '<rect x="9.5" y="13.8" width="15" height="10.7" rx="2.2" fill="#ffffff"/>' +
  '<circle cx="17" cy="19.2" r="3.4" fill="#272727"/>' +
  '<circle cx="17" cy="19.2" r="1.6" fill="#ffffff"/></svg>';

export function TrackMap({
  line,
  bounds,
  basemap = "monochrome",
  cursor = null,
  flightId,
  photos = [],
  onClear,
  onPhotoHover,
  onPhotoOpen,
}: {
  line: LngLat[];
  bounds: [number, number, number, number];
  basemap?: BasemapId;
  /** Position of the shared playback/hover cursor, or null to hide it. */
  cursor?: LngLat | null;
  flightId?: string;
  /** Geotagged photos to pin on the track. */
  photos?: FlightPhoto[];
  /** Clicking the map clears the current selection. */
  onClear?: () => void;
  /** Hovering a photo pin moves the scrubber to its time-from-takeoff. */
  onPhotoHover?: (tSec: number) => void;
  /** Clicking a photo pin opens it (lightbox) and moves the scrubber. */
  onPhotoOpen?: (photoId: string, tSec: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  // Cursor + photos are DOM markers (reliable mouse events, controllable
  // z-order) rather than canvas layers — the cursor marker sits above the
  // camera markers, and markers survive basemap setStyle.
  const cursorMarkerRef = useRef<maplibregl.Marker | null>(null);
  const photoMarkersRef = useRef<maplibregl.Marker[]>([]);
  const cursorRef = useRef(cursor);
  const onClearRef = useRef(onClear);
  const basemapRef = useRef(basemap);
  const photosRef = useRef(photos);
  const flightIdRef = useRef(flightId);
  const onPhotoHoverRef = useRef(onPhotoHover);
  const onPhotoOpenRef = useRef(onPhotoOpen);
  const didInit = useRef(false);
  useEffect(() => {
    cursorRef.current = cursor;
    onClearRef.current = onClear;
    basemapRef.current = basemap;
    photosRef.current = photos;
    flightIdRef.current = flightId;
    onPhotoHoverRef.current = onPhotoHover;
    onPhotoOpenRef.current = onPhotoOpen;
  });

  function applyCursor(map: maplibregl.Map) {
    const c = cursorRef.current;
    if (!c) {
      cursorMarkerRef.current?.remove();
      cursorMarkerRef.current = null;
      return;
    }
    if (!cursorMarkerRef.current) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:14px;height:14px;border-radius:50%;background:#ffb459;border:2px solid #141414;box-sizing:border-box;z-index:5;pointer-events:none;";
      cursorMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat(c).addTo(map);
    } else {
      cursorMarkerRef.current.setLngLat(c);
    }
  }

  function applyPhotos(map: maplibregl.Map) {
    for (const m of photoMarkersRef.current) m.remove();
    photoMarkersRef.current = [];
    const fid = flightIdRef.current;
    for (const p of photosRef.current.filter(isPinned)) {
      const lon = p.lon as number;
      const lat = p.lat as number;
      const tSec = p.tSec ?? -1;
      const el = document.createElement("div");
      el.className = "leaf-photo-pin";
      el.style.cssText = "width:30px;height:30px;cursor:pointer;z-index:4;";
      el.innerHTML = CAMERA_SVG;
      el.addEventListener("mouseenter", () => {
        if (tSec >= 0) onPhotoHoverRef.current?.(tSec);
        if (!fid) return;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 18 })
          .setLngLat([lon, lat])
          .setHTML(
            `<img src="${photoUrl(fid, p.id, "thumb")}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:4px;display:block" />`,
          )
          .addTo(map);
      });
      el.addEventListener("mouseleave", () => {
        popupRef.current?.remove();
        popupRef.current = null;
      });
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onPhotoOpenRef.current?.(p.id, tSec >= 0 ? tSec : null);
      });
      photoMarkersRef.current.push(
        new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map),
      );
    }
  }

  // (Re)add the track line — needed on first load and after every basemap
  // setStyle (which wipes custom sources/layers). Markers are not style-bound.
  function addTrackLayers(map: maplibregl.Map) {
    if (!map.getSource("track")) {
      map.addSource("track", {
        type: "geojson",
        data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } },
      });
    }
    if (!map.getLayer("track-line")) {
      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffb459", "line-width": 3 },
      });
    }
  }

  // Build the map once per track.
  useEffect(() => {
    if (!ref.current || line.length < 2) return;

    const map = new maplibregl.Map({
      container: ref.current,
      style: styleFor(basemapRef.current),
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      addTrackLayers(map);
      new maplibregl.Marker({ color: "#6fae5e" }).setLngLat(line[0]).addTo(map);
      new maplibregl.Marker({ color: "#272727" }).setLngLat(line[line.length - 1]).addTo(map);
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 48, duration: 0 },
      );
      applyCursor(map);
      applyPhotos(map);
    });

    // Clicking the map (canvas, not a photo marker) clears the selection.
    map.on("click", () => onClearRef.current?.());

    return () => {
      popupRef.current?.remove();
      for (const m of photoMarkersRef.current) m.remove();
      photoMarkersRef.current = [];
      cursorMarkerRef.current?.remove();
      cursorMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, bounds]);

  // Swap basemap style (preserve camera; re-add the track line; markers persist).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!didInit.current) {
      didInit.current = true;
      return; // initial style already set at build time
    }
    const swap = () => {
      map.setStyle(styleFor(basemap));
      map.once("style.load", () => addTrackLayers(map));
    };
    if (map.isStyleLoaded()) swap();
    else map.once("load", swap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  // Move the cursor marker when the shared time changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map) applyCursor(map);
  }, [cursor]);

  // Refresh photo markers when the set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map && map.loaded()) applyPhotos(map);
  }, [photos]);

  return <div ref={ref} className="h-[420px] w-full rounded-lg" />;
}
