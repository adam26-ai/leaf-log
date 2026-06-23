// Selectable basemaps for the flight map + 3D replay. Monochrome and Streets are
// keyless (OpenFreeMap); Satellite/Hybrid/Topo use MapTiler (NEXT_PUBLIC_MAPTILER_KEY).
// Every basemap is a MapLibre style URL, so swapping is just map.setStyle().

export type BasemapId = "monochrome" | "satellite" | "hybrid" | "topo" | "streets";

export interface BasemapDef {
  id: BasemapId;
  label: string;
  /** Requires NEXT_PUBLIC_MAPTILER_KEY. */
  needsKey: boolean;
}

export const BASEMAPS: BasemapDef[] = [
  { id: "monochrome", label: "Map", needsKey: false },
  { id: "satellite", label: "Satellite", needsKey: true },
  { id: "hybrid", label: "Hybrid", needsKey: true },
  { id: "topo", label: "Topo", needsKey: true },
  { id: "streets", label: "Streets", needsKey: false },
];

export function hasMapTiler(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_MAPTILER_KEY);
}

/** A satellite/imagery basemap shows terrain naturally — skip the hillshade overlay. */
export function isImagery(id: BasemapId): boolean {
  return id === "satellite" || id === "hybrid";
}

/** The MapLibre style URL for a basemap (falls back to keyless monochrome). */
export function styleFor(id: BasemapId): string {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const mt = (name: string) =>
    `https://api.maptiler.com/maps/${name}/style.json?key=${key}`;
  switch (id) {
    case "satellite":
      return key ? mt("satellite") : styleFor("monochrome");
    case "hybrid":
      return key ? mt("hybrid") : styleFor("monochrome");
    case "topo":
      return key ? mt("outdoor-v2") : styleFor("monochrome");
    case "streets":
      return "https://tiles.openfreemap.org/styles/liberty";
    case "monochrome":
    default:
      return "https://tiles.openfreemap.org/styles/positron";
  }
}
