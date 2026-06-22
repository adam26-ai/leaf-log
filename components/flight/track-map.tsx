"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleFor, type BasemapId } from "./basemaps";

type LngLat = [number, number];
type Sample = [number, number, number, number]; // lon, lat, alt, t

export function TrackMap({
  line,
  bounds,
  basemap = "monochrome",
  cursor = null,
  samples = null,
  onHoverTime,
}: {
  line: LngLat[];
  bounds: [number, number, number, number];
  basemap?: BasemapId;
  cursor?: LngLat | null;
  samples?: Sample[] | null;
  onHoverTime?: (t: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const samplesRef = useRef(samples);
  const onHoverRef = useRef(onHoverTime);
  const cursorRef = useRef(cursor);
  const basemapRef = useRef(basemap);
  const didInit = useRef(false);
  useEffect(() => {
    samplesRef.current = samples;
    onHoverRef.current = onHoverTime;
    cursorRef.current = cursor;
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

    const onMove = (e: maplibregl.MapMouseEvent) => {
      const s = samplesRef.current;
      const cb = onHoverRef.current;
      if (!s || s.length === 0 || !cb) return;
      const { x, y } = e.point;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < s.length; i++) {
        const p = map.project([s[i][0], s[i][1]]);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      cb(best >= 0 && bestD < 28 * 28 ? s[best][3] : null);
    };
    const onOut = () => onHoverRef.current?.(null);
    map.on("mousemove", onMove);
    map.on("mouseout", onOut);

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

  // Update the cursor marker when the linked time changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) applyCursor(map);
    else map.once("load", () => applyCursor(map));
  }, [cursor]);

  return <div ref={ref} className="h-[420px] w-full rounded-lg" />;
}
