import type { Map, GeoJSONSource, GeoJSONSourceSpecification } from "maplibre-gl";
import type { XcCandidate } from "@/lib/igc/xc-types";

export const XC_SOURCE = "xc-scored-route";
const LAYERS = ["xc-route-halo", "xc-route-line", "xc-route-points"];
type FeatureCollection = Extract<GeoJSONSourceSpecification["data"], { type: "FeatureCollection" }>;

export function xcRouteGeoJson(route: XcCandidate): FeatureCollection {
  const points = route.shape === "open"
    ? [route.start, ...route.vertices, route.finish].filter((point) => point != null)
    : route.vertices;
  const coordinates = points.map((point) => [point.lon, point.lat]);
  if (route.shape !== "open" && coordinates.length) coordinates.push(coordinates[0]);
  return {
    type: "FeatureCollection",
    features: [
      ...(coordinates.length >= 2 ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } }] : []),
      ...points.map((point) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: [point.lon, point.lat] } })),
    ],
  };
}

/** Native map layers drape over terrain rather than floating at flight altitude. */
export function syncXcMapRoute(map: Map, route?: XcCandidate | null) {
  if (!map.isStyleLoaded()) return;
  if (!route) {
    for (const id of [...LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(XC_SOURCE)) map.removeSource(XC_SOURCE);
    return;
  }
  const data = xcRouteGeoJson(route);
  const source = map.getSource(XC_SOURCE) as GeoJSONSource | undefined;
  if (source) source.setData(data);
  else map.addSource(XC_SOURCE, { type: "geojson", data });
  const before = map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;
  if (!map.getLayer(LAYERS[0])) map.addLayer({
    id: LAYERS[0], type: "line", source: XC_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#17232c", "line-width": 5, "line-opacity": 0.65 },
  }, before);
  if (!map.getLayer(LAYERS[1])) map.addLayer({
    id: LAYERS[1], type: "line", source: XC_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#d8ff00", "line-width": 1.25, "line-opacity": 0.9 },
  }, before);
  if (!map.getLayer(LAYERS[2])) map.addLayer({
    id: LAYERS[2], type: "circle", source: XC_SOURCE, filter: ["==", "$type", "Point"],
    paint: { "circle-radius": 4, "circle-color": "#d8ff00", "circle-stroke-color": "#17232c", "circle-stroke-width": 1.5, "circle-pitch-alignment": "map" },
  }, before);
}
