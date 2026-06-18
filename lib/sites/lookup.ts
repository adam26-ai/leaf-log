import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Match radii (metres): launches are tighter than landing zones.
const TAKEOFF_RADIUS_M = 600;
const LANDING_RADIUS_M = 900;

export interface SiteMatch {
  id: string;
  name: string;
}

/**
 * Nearest named site to a coordinate, within a kind-appropriate radius, via the
 * PostGIS `nearest_site` KNN function. Returns null when nothing is close enough
 * — we show an honest "Unknown site" rather than guessing a nearby town.
 */
export async function findSite(
  db: SupabaseClient<Database>,
  lat: number,
  lon: number,
  kind: "takeoff" | "landing",
): Promise<SiteMatch | null> {
  const { data, error } = await db.rpc("nearest_site", {
    in_lat: lat,
    in_lon: lon,
    max_m: kind === "takeoff" ? TAKEOFF_RADIUS_M : LANDING_RADIUS_M,
    in_kind: kind,
  });
  if (error || !data || data.length === 0) return null;
  const row = data[0];
  return { id: row.id, name: row.name };
}
