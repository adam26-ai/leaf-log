"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleFor, type BasemapId } from "./basemaps";

type LngLat = [number, number];

export function TrackMap({
  line,
  bounds,
  basemap = "monochrome",
  cursor = null,
  onClear,
}: {
  line: LngLat[];
  bounds: [number, number, number, number];
  basemap?: BasemapId;
  /** Position of the shared playback/hover cursor, or null to hide it. */
  cursor?: LngLat | null;
  /** Clicking the map clears the current selection. */
  onClear?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const cursorRef = useRef(cursor);
  const onClearRef = useRef(onClear);
  const basemapRef = useRef(basemap);
  const didInit = useRef(false);
  useEffect(() => {
    cursorRef.current = cursor;
    onClearRef.current = onClear;
    basemapRef.current = basemap;
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
    applyCursor(map);
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

    // Clicking the map clears the current selection (cursor/readout).
    map.on("click", () => onClearRef.current?.());

    return () => {
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

  return <div ref={ref} className="h-[420px] w-full rounded-lg" />;
}
