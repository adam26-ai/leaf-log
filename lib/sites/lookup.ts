import type { Db } from "@/lib/prisma";
import { haversineM } from "@/lib/geo/distance";

// Match radii (metres): launches are tighter than landing zones.
const TAKEOFF_RADIUS_M = 600;
const LANDING_RADIUS_M = 900;

export interface SiteMatch {
  id: string;
  name: string;
}

/**
 * Nearest named site to a coordinate within a kind-appropriate radius. Prefilters
 * by a lat/lon bounding box (indexed), then ranks by true haversine distance.
 * Returns null when nothing is close enough — we show an honest "Unknown site".
 */
export async function findSite(
  db: Pick<Db, "site">,
  lat: number,
  lon: number,
  kind: "takeoff" | "landing",
): Promise<SiteMatch | null> {
  const radius = kind === "takeoff" ? TAKEOFF_RADIUS_M : LANDING_RADIUS_M;
  // Pad the box a little beyond the radius before exact filtering.
  const dLat = (radius / 111_320) * 1.5;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = (radius / (111_320 * cosLat)) * 1.5;

  const candidates = await db.site.findMany({
    where: {
      lat: { gte: lat - dLat, lte: lat + dLat },
      lon: { gte: lon - dLon, lte: lon + dLon },
      OR: [{ kind }, { kind: "both" }],
    },
  });

  let best: SiteMatch | null = null;
  let bestDist = Infinity;
  for (const s of candidates) {
    const d = haversineM(lat, lon, s.lat, s.lon);
    if (d <= radius && d < bestDist) {
      bestDist = d;
      best = { id: s.id, name: s.name };
    }
  }
  return best;
}
