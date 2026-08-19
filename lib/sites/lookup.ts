import type { Db } from "@/lib/prisma";
import {
  radiusForKind,
  boundingBox,
  withinRadius,
  compareSiteCandidates,
  type MatchKind,
} from "./geo";
import { normalizeSiteVisibility, type SiteVisibility } from "./visibility";

export interface SiteMatch {
  id: string;
  name: string;
  visibility: SiteVisibility;
  ownerId: string | null;
  kind: string;
  distanceM: number;
}

export interface FindSiteOptions {
  lat: number;
  lon: number;
  kind: MatchKind;
  /**
   * Required and defaultless on purpose — every call site is a compile error
   * until it states who is asking. `null` means "anonymous / no viewer": only
   * public sites match. A concrete id also unlocks that viewer's own private
   * sites. Never widen this to match every private site regardless of owner —
   * that would leak every other pilot's private launch to everyone.
   */
  viewerId: string | null;
}

/**
 * Nearest site visible to `viewerId`, within a kind-appropriate radius.
 * Prefilters by a lat/lon bounding box (indexed), then ranks by true
 * haversine distance with deterministic tie-breaking. Returns null when
 * nothing visible is close enough — callers show an honest "Unknown site".
 */
export async function findSite(
  db: Pick<Db, "site">,
  options: FindSiteOptions,
): Promise<SiteMatch | null> {
  const { lat, lon, kind, viewerId } = options;
  const radius = radiusForKind(kind);
  const box = boundingBox(lat, lon, radius);

  const lonWhere =
    box.lonRanges.length === 1
      ? { lon: { gte: box.lonRanges[0].min, lte: box.lonRanges[0].max } }
      : {
          OR: box.lonRanges.map((r) => ({ lon: { gte: r.min, lte: r.max } })),
        };

  // The private branch is OMITTED ENTIRELY when viewerId is null — Prisma
  // compiles `{ ownerId: null }` to `IS NULL`, which would otherwise match
  // every orphaned private site for an anonymous caller.
  const visibilityOr =
    viewerId !== null
      ? [{ visibility: "public" }, { visibility: "private", ownerId: viewerId }]
      : [{ visibility: "public" }];

  const candidates = await db.site.findMany({
    where: {
      AND: [
        { lat: { gte: box.latMin, lte: box.latMax } },
        lonWhere,
        { OR: [{ kind }, { kind: "both" }] },
        { OR: visibilityOr },
      ],
    },
    select: {
      id: true,
      name: true,
      lat: true,
      lon: true,
      kind: true,
      visibility: true,
      ownerId: true,
      license: true,
    },
  });

  const ranked = withinRadius(candidates, lat, lon, radius).sort(
    compareSiteCandidates,
  );
  const best = ranked[0];
  if (!best) return null;

  return {
    id: best.id,
    name: best.name,
    visibility: normalizeSiteVisibility(best.visibility),
    ownerId: best.ownerId,
    kind: best.kind,
    distanceM: best.distanceM,
  };
}
