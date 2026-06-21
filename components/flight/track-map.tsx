"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { basemapStyleUrl } from "./map-style";

type LngLat = [number, number];
type Sample = [number, number, number, number]; // lon, lat, alt, t

export function TrackMap({
  line,
  bounds,
  cursor = null,
  samples = null,
  onHoverTime,
}: {
  line: LngLat[];
  bounds: [number, number, number, number];
  /** Position [lon,lat] of the linked cursor, or null. */
  cursor?: LngLat | null;
  /** Time-aligned samples for hover→time lookup. */
  samples?: Sample[] | null;
  onHoverTime?: (t: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const samplesRef = useRef(samples);
  const onHoverRef = useRef(onHoverTime);
  // Keep the imperative handlers pointed at the latest props.
  useEffect(() => {
    samplesRef.current = samples;
    onHoverRef.current = onHoverTime;
  });

  // Build the map once per track.
  useEffect(() => {
    if (!ref.current || line.length < 2) return;

    const map = new maplibregl.Map({
      container: ref.current,
      style: basemapStyleUrl(),
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource("track", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: line },
        },
      });
      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffb459", "line-width": 3 },
      });

      // Linked-cursor marker (driven by the barograph / replay).
      map.addSource("cursor", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
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

      new maplibregl.Marker({ color: "#6fae5e" }).setLngLat(line[0]).addTo(map);
      new maplibregl.Marker({ color: "#272727" })
        .setLngLat(line[line.length - 1])
        .addTo(map);

      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 48, duration: 0 },
      );
    });

    // Hover → nearest sample (by screen distance) → report its time.
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
  }, [line, bounds]);

  // Update the cursor marker when the linked time changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("cursor") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      src.setData(
        cursor
          ? {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "Point", coordinates: cursor },
                },
              ],
            }
          : { type: "FeatureCollection", features: [] },
      );
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [cursor]);

  return <div ref={ref} className="h-[420px] w-full rounded-lg" />;
}
