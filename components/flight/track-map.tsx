"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { basemapStyleUrl } from "./map-style";

type LngLat = [number, number];

export function TrackMap({
  line,
  bounds,
}: {
  line: LngLat[];
  bounds: [number, number, number, number];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || line.length < 2) return;

    const map = new maplibregl.Map({
      container: ref.current,
      style: basemapStyleUrl(),
      attributionControl: { compact: true },
    });
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
      // Signature amber track line.
      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffb459", "line-width": 3 },
      });

      const takeoff = line[0];
      const landing = line[line.length - 1];
      new maplibregl.Marker({ color: "#6fae5e" }).setLngLat(takeoff).addTo(map);
      new maplibregl.Marker({ color: "#272727" }).setLngLat(landing).addTo(map);

      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        { padding: 48, duration: 0 },
      );
    });

    return () => map.remove();
  }, [line, bounds]);

  return <div ref={ref} className="h-[420px] w-full rounded-lg" />;
}
