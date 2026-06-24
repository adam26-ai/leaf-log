"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleFor, type BasemapId } from "./basemaps";
import { photoUrl, isPinned, type FlightPhoto } from "./photos";

type LngLat = [number, number];

export function TrackMap({
  line,
  bounds,
  basemap = "monochrome",
  cursor = null,
  flightId,
  photos = [],
  onClear,
  onPhotoSelect,
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
  /** Clicking a photo pin reports its time-from-takeoff (for the replay). */
  onPhotoSelect?: (tSec: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const cursorRef = useRef(cursor);
  const onClearRef = useRef(onClear);
  const basemapRef = useRef(basemap);
  const photosRef = useRef(photos);
  const flightIdRef = useRef(flightId);
  const onPhotoSelectRef = useRef(onPhotoSelect);
  const didInit = useRef(false);
  useEffect(() => {
    cursorRef.current = cursor;
    onClearRef.current = onClear;
    basemapRef.current = basemap;
    photosRef.current = photos;
    flightIdRef.current = flightId;
    onPhotoSelectRef.current = onPhotoSelect;
  });

  function applyCursor(map: maplibregl.Map) {
    const src = map.getSource("cursor") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const c = cursorRef.current;
    src.setData(
      c
        ? {
            type: "FeatureCollection",
            features: [
              { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } },
            ],
          }
        : { type: "FeatureCollection", features: [] },
    );
  }

  // (Re)add the track + cursor sources/layers — needed on first load and after
  // every basemap setStyle (which wipes custom sources/layers).
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
    if (!map.getSource("cursor")) {
      map.addSource("cursor", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!map.getLayer("cursor")) {
      map.addLayer({
        id: "cursor",
        type: "circle",
        source: "cursor",
        paint: {
          "circle-radius": 6,
          "circle-color": "#ffb459",
          "circle-stroke-color": "#141414",
          "circle-stroke-width": 2,
        },
      });
    }
    if (!map.getSource("photos")) {
      map.addSource("photos", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    }
    if (!map.getLayer("photo-pins")) {
      map.addLayer({
        id: "photo-pins",
        type: "circle",
        source: "photos",
        paint: {
          "circle-radius": 7,
          "circle-color": "#272727",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
    }
    applyCursor(map);
    applyPhotos(map);
  }

  function applyPhotos(map: maplibregl.Map) {
    const src = map.getSource("photos") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const fid = flightIdRef.current;
    src.setData({
      type: "FeatureCollection",
      features: photosRef.current.filter(isPinned).map((p) => ({
        type: "Feature",
        properties: {
          id: p.id,
          tSec: p.tSec ?? -1,
          thumb: fid ? photoUrl(fid, p.id, "thumb") : "",
        },
        geometry: { type: "Point", coordinates: [p.lon as number, p.lat as number] },
      })),
    });
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
    });

    // Clicking the map clears the current selection — unless a photo pin was hit.
    map.on("click", (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["photo-pins"] });
      if (hit.length === 0) onClearRef.current?.();
    });

    // Photo pins: hover shows the thumbnail; click scrubs the replay.
    map.on("mouseenter", "photo-pins", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const f = e.features?.[0];
      const thumb = f?.properties?.thumb as string | undefined;
      const geom = f?.geometry;
      if (!thumb || !geom || geom.type !== "Point") return;
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
        .setLngLat(geom.coordinates as [number, number])
        .setHTML(`<img src="${thumb}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:4px;display:block" />`)
        .addTo(map);
    });
    map.on("mouseleave", "photo-pins", () => {
      map.getCanvas().style.cursor = "";
      popupRef.current?.remove();
      popupRef.current = null;
    });
    map.on("click", "photo-pins", (e) => {
      const t = e.features?.[0]?.properties?.tSec;
      if (typeof t === "number" && t >= 0) onPhotoSelectRef.current?.(t);
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, bounds]);

  // Swap basemap style (preserve camera; re-add custom layers afterward).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!didInit.current) {
      didInit.current = true;
      return; // initial style already set at build time
    }
    const reAdd = () => addTrackLayers(map);
    const swap = () => {
      map.setStyle(styleFor(basemap));
      map.once("style.load", reAdd);
    };
    if (map.isStyleLoaded()) swap();
    else map.once("load", swap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  // Move the cursor marker when the shared time changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) applyCursor(map);
    else map.once("load", () => applyCursor(map));
  }, [cursor]);

  // Refresh photo pins when the set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) applyPhotos(map);
    else map.once("load", () => applyPhotos(map));
  }, [photos]);

  return <div ref={ref} className="h-[420px] w-full rounded-lg" />;
}
