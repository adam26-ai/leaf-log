import type { Db } from "@/lib/prisma";
import { haversineM } from "@/lib/geo/distance";
import {
  radiusForKind,
  zoneRadiusForKind,
  boundingBox,
  compareSiteCandidates,
  kindMatches,
  locationMatches,
  isValidBoundaryShape,
  boundaryPrefilterWhere,
  type MatchKind,
} from "./geo";
import { normalizeSiteVisibility, canSeeZone, type SiteVisibility } from "./visibility";

/**
 * SPRINT-006 rollback kill switch: SITE_BOUNDARY_MATCHING=off treats every
 * row as circle-only regardless of stored boundaries, with no data change
 * and no redeploy — a matching-engine change on the ingest hot path needs a
 * lever that isn't "revert and redeploy." Read fresh (not cached at module
 * load) so it's also trivially testable.
 */
function boundaryMatchingEnabled(): boolean {
  return process.env.SITE_BOUNDARY_MATCHING !== "off";
}

export interface SiteMatch {
  id: string;
  name: string;
  visibility: SiteVisibility;
  ownerId: string | null;
  kind: string;
  distanceM: number;
}

export interface ZoneMatch {
  id: string;
  name: string;
  visibility: SiteVisibility;
  ownerId: string | null;
  kind: string;
  siteId: string;
  distanceM: number;
}

/**
 * The resolved pair a location lookup returns. `zone` is non-null only when
 * an endpoint-compatible zone was found within its (tighter) radius; `site`
 * is always the parent — its own name/visibility/ownerId, present whether or
 * not a zone won, and its `distanceM` is always the distance to the SITE's
 * own coordinate (not the zone's), for a consistent meaning across both
 * shapes of result.
 */
export interface LocationMatch {
  site: SiteMatch;
  zone: ZoneMatch | null;
}

export interface FindSiteOptions {
  lat: number;
  lon: number;
  kind: MatchKind;
  /**
   * Required and defaultless on purpose — every call site is a compile error
   * until it states who is asking. `null` means "anonymous / no viewer": only
   * public sites/zones match. A concrete id also unlocks that viewer's own
   * private sites/zones. Never widen this to match every private row
   * regardless of owner — that would leak every other pilot's private launch
   * to everyone.
   */
  viewerId: string | null;
}

function siteVisibilityOr(viewerId: string | null) {
  // The private branch is OMITTED ENTIRELY when viewerId is null — Prisma
  // compiles `{ ownerId: null }` to `IS NULL`, which would otherwise match
  // every orphaned private row for an anonymous caller.
  return viewerId !== null
    ? [{ visibility: "public" }, { visibility: "private", ownerId: viewerId }]
    : [{ visibility: "public" }];
}

function lonWhereFor(box: ReturnType<typeof boundingBox>) {
  return box.lonRanges.length === 1
    ? { lon: { gte: box.lonRanges[0].min, lte: box.lonRanges[0].max } }
    : { OR: box.lonRanges.map((r) => ({ lon: { gte: r.min, lte: r.max } })) };
}

interface SiteRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: string;
  visibility: string;
  ownerId: string | null;
  boundary: unknown;
  // Only meaningful for the site-only pass's tie-break (compareSiteCandidates);
  // the zone pass's joined parent doesn't select it since a zone win never
  // ranks its parent against another site.
  license?: string | null;
}

async function siteCandidates(
  db: Pick<Db, "site">,
  lat: number,
  lon: number,
  kind: MatchKind,
  viewerId: string | null,
): Promise<SiteRow[]> {
  const box = boundingBox(lat, lon, radiusForKind(kind));
  const locationOr = boundaryMatchingEnabled()
    ? [
        { AND: [{ lat: { gte: box.latMin, lte: box.latMax } }, lonWhereFor(box)] },
        boundaryPrefilterWhere(lat, lon),
      ]
    : [{ AND: [{ lat: { gte: box.latMin, lte: box.latMax } }, lonWhereFor(box)] }];

  return db.site.findMany({
    where: {
      AND: [
        { OR: locationOr },
        { OR: [{ kind }, { kind: "both" }] },
        { OR: siteVisibilityOr(viewerId) },
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
      boundary: true,
    },
  });
}

interface ZoneRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: string;
  visibility: string;
  ownerId: string | null;
  siteId: string;
  boundary: unknown;
  site: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    kind: string;
    visibility: string;
    ownerId: string | null;
  };
}

async function zoneCandidates(
  db: Pick<Db, "zone">,
  lat: number,
  lon: number,
  kind: MatchKind,
  viewerId: string | null,
): Promise<ZoneRow[]> {
  const box = boundingBox(lat, lon, zoneRadiusForKind(kind));
  const locationOr = boundaryMatchingEnabled()
    ? [
        { AND: [{ lat: { gte: box.latMin, lte: box.latMax } }, lonWhereFor(box)] },
        boundaryPrefilterWhere(lat, lon),
      ]
    : [{ AND: [{ lat: { gte: box.latMin, lte: box.latMax } }, lonWhereFor(box)] }];

  return db.zone.findMany({
    where: {
      AND: [
        { OR: locationOr },
        { OR: [{ kind }, { kind: "both" }] },
        // Own visibility AND the parent's, pushed down for efficiency — the
        // exact canSeeZone() re-check below is the actual authority (it also
        // catches a siteId/site-relation mismatch, which can't occur via
        // this join but CAN occur when the same predicate logic is reused
        // against a stale Flight-cached zone id elsewhere).
        { OR: siteVisibilityOr(viewerId) },
        { site: { OR: siteVisibilityOr(viewerId) } },
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
      siteId: true,
      boundary: true,
      site: {
        select: { id: true, name: true, lat: true, lon: true, kind: true, visibility: true, ownerId: true },
      },
    },
  });
}

/**
 * Applies locationMatches to every candidate, logging (once per row) and
 * skipping any row whose stored boundary doesn't even parse — fail closed,
 * never thrown into ingest, never silently re-checked against the circle
 * (which would undo a pilot's deliberate tightening).
 */
function matchAll<T extends { id: string; lat: number; lon: number; boundary: unknown }>(
  rows: readonly T[],
  lat: number,
  lon: number,
  radiusM: number,
  table: "Site" | "Zone",
): Array<T & { distanceM: number }> {
  const out: Array<T & { distanceM: number }> = [];
  for (const row of rows) {
    if (row.boundary != null && !isValidBoundaryShape(row.boundary)) {
      console.warn(`[sites] malformed stored boundary on ${table} id=${row.id}; skipped at match time`);
      continue;
    }
    const { matched, distanceM } = locationMatches(row, lat, lon, radiusM);
    if (matched) out.push({ ...row, distanceM });
  }
  return out;
}

function toSiteMatch(
  row: Pick<SiteRow, "id" | "name" | "visibility" | "ownerId" | "kind">,
  distanceM: number,
): SiteMatch {
  return {
    id: row.id,
    name: row.name,
    visibility: normalizeSiteVisibility(row.visibility),
    ownerId: row.ownerId,
    kind: row.kind,
    distanceM,
  };
}

/**
 * Nearest location visible to `viewerId`, zone-first with a site fallback
 * that ALWAYS runs — whether or not the winning site has zones. Both bbox
 * prefilters run concurrently; a winning zone is returned with its parent
 * regardless of whether that parent also won the (separate, wider) site
 * pass, and regardless of the parent's own distance — the zone is the more
 * precise fix by construction. Returns null when nothing visible is close
 * enough at either level — callers show an honest "Unknown site".
 *
 * An earlier design excluded a site from the fallback the moment it had ANY
 * endpoint-compatible zone, regardless of that zone's distance. Rejected:
 * naming one zone at an already-flown site would silently un-label every
 * other pilot's nearby flight — a regression against "no dead ends," not an
 * improvement on it. The site pass here is unconditional.
 */
export async function findLocation(
  db: Pick<Db, "site" | "zone">,
  options: FindSiteOptions,
): Promise<LocationMatch | null> {
  const { lat, lon, kind, viewerId } = options;

  const [siteRows, zoneRows] = await Promise.all([
    siteCandidates(db, lat, lon, kind, viewerId),
    zoneCandidates(db, lat, lon, kind, viewerId),
  ]);

  const zoneRanked = matchAll(zoneRows, lat, lon, zoneRadiusForKind(kind), "Zone")
    .filter((z) => kindMatches(z.kind, kind))
    .filter((z) =>
      canSeeZone(
        { visibility: normalizeSiteVisibility(z.visibility), ownerId: z.ownerId, siteId: z.siteId },
        { id: z.site.id, visibility: normalizeSiteVisibility(z.site.visibility), ownerId: z.site.ownerId },
        viewerId,
      ),
    )
    .sort(compareSiteCandidates);

  const zoneWinner = zoneRanked[0];
  if (zoneWinner) {
    const siteDistanceM = haversineM(lat, lon, zoneWinner.site.lat, zoneWinner.site.lon);
    return {
      site: toSiteMatch(zoneWinner.site, siteDistanceM),
      zone: {
        id: zoneWinner.id,
        name: zoneWinner.name,
        visibility: normalizeSiteVisibility(zoneWinner.visibility),
        ownerId: zoneWinner.ownerId,
        kind: zoneWinner.kind,
        siteId: zoneWinner.siteId,
        distanceM: zoneWinner.distanceM,
      },
    };
  }

  const siteRanked = matchAll(siteRows, lat, lon, radiusForKind(kind), "Site").sort(compareSiteCandidates);
  const siteWinner = siteRanked[0];
  if (!siteWinner) return null;

  return { site: toSiteMatch(siteWinner, siteWinner.distanceM), zone: null };
}
