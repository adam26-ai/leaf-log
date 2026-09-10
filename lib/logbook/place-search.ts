import { z } from "zod";

export type MapPlace = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  bounds?: [number, number, number, number];
};

const longitude = z.number().min(-180).max(180);
const latitude = z.number().min(-90).max(90);
const featureSchema = z.object({
  id: z.string(),
  place_name: z.string().min(1),
  center: z.tuple([longitude, latitude]),
  bbox: z.tuple([longitude, latitude, longitude, latitude])
    .refine(([west, south, east, north]) => west < east && south < north).optional().catch(undefined),
});

/** Browser-only search; provider results are used for navigation and never persisted. */
export async function searchPlaces(query: string, key: string, signal: AbortSignal): Promise<MapPlace[]> {
  const params = new URLSearchParams({ key, limit: "5", autocomplete: "false" });
  const response = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?${params}`, { signal });
  if (!response.ok) throw new Error("Place search failed");
  const data = z.object({ features: z.array(z.unknown()) }).parse(await response.json());
  return data.features.flatMap(feature => {
    const parsed = featureSchema.safeParse(feature);
    if (!parsed.success) return [];
    const { id, place_name, center, bbox } = parsed.data;
    return [{ id, name: place_name, lon: center[0], lat: center[1], bounds: bbox }];
  }).slice(0, 5);
}
