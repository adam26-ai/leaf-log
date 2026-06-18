/**
 * Basemap style URL. Defaults to OpenFreeMap's keyless monochrome "positron"
 * style (on-brand, no API key needed). If a MapTiler key is configured, use
 * MapTiler's vector tiles instead.
 */
export function basemapStyleUrl(): string {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) {
    return `https://api.maptiler.com/maps/dataviz/style.json?key=${key}`;
  }
  return "https://tiles.openfreemap.org/styles/positron";
}
