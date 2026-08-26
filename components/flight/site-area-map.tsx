"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { styleFor } from "./basemaps";
import type { Boundary } from "@/lib/sites/geo";

type LngLat = [number, number];

/** Mirrors boundary-editor.tsx's own circleRing — duplicated rather than
 *  shared since this is a read-only viewer with no editing state to keep
 *  in sync, and the two are small enough that sharing isn't worth the
 *  coupling. */
function circleRing(lat: number, lon: number, radiusM: number, steps = 48): LngLat[] {
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * cosLat);
  const pts: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (2 * Math.PI * i) / steps;
    pts.push([lon + Math.sin(angle) * dLon, lat + Math.cos(angle) * dLat]);
  }
  return pts;
}

function ringGeoJson(coords: LngLat[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [coords] },
  };
}

function boundsOfPoints(points: LngLat[]): [LngLat, LngLat] | null {
  if (points.length === 0) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ];
}

/**
 * Read-only preview for the site-overview step: the site's own area (its
 * drawn boundary if it has one, else the reference circle for this
 * endpoint's kind) highlighted, plus a marker for the flight's own
 * takeoff/landing fix — so a pilot can see at a glance whether their point
 * sits centrally or near the edge before deciding to edit or pick a
 * different site. No editing affordance of any kind; that's the boundary
 * editor's job, reached separately via "Edit boundary."
 */
export function SiteAreaMap({
  anchor,
  radiusM,
  boundary,
  flightPoint,
}: {
  anchor: { lat: number; lon: number };
  radiusM: number;
  boundary: Boundary | null;
  flightPoint: { lat: number; lon: number } | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: styleFor("monochrome"),
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      const areaRing = boundary ? boundary.geometry.coordinates[0] : circleRing(anchor.lat, anchor.lon, radiusM);

      map.addSource("area", { type: "geojson", data: ringGeoJson(areaRing) });
      map.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#ffb459", "fill-opacity": 0.2 } });
      map.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#ffb459", "line-width": 2 } });

      new maplibregl.Marker({ color: "#272727" }).setLngLat([anchor.lon, anchor.lat]).addTo(map);

      if (flightPoint) {
        const el = document.createElement("div");
        el.style.cssText =
          "width:14px;height:14px;border-radius:50%;background:#ffb459;border:2px solid #141414;box-sizing:border-box;";
        new maplibregl.Marker({ element: el }).setLngLat([flightPoint.lon, flightPoint.lat]).addTo(map);
      }

      const boundsPoints: LngLat[] = [...areaRing, [anchor.lon, anchor.lat]];
      if (flightPoint) boundsPoints.push([flightPoint.lon, flightPoint.lat]);
      const bounds = boundsOfPoints(boundsPoints);
      if (bounds) map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 16 });
    });

    return () => map.remove();
    // Mounted fresh per site-overview visit (see NameSiteDialog) — a
    // one-time render, not a reactive viewer, so an empty dep array is
    // deliberate rather than a missed dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} className="h-[420px] w-full rounded-md" data-testid="site-area-map" />;
}
