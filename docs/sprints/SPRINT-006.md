# SPRINT-006 — Custom boundaries for sites and zones

Produced by the multi-agent sprint-planning process (independent Claude/Codex drafts,
cross-critique, a 4-question stakeholder interview, and synthesis). See
[`drafts/SPRINT-006-INTENT.md`](./drafts/SPRINT-006-INTENT.md) and
[`drafts/SPRINT-006-MERGE-NOTES.md`](./drafts/SPRINT-006-MERGE-NOTES.md) for the full
process record. Extends [`SPRINT-005.md`](./SPRINT-005.md) (Site + Zone) and
[`SPRINT-004.md`](./SPRINT-004.md) (the privacy machinery both reuse).

## Overview

SPRINT-004 and SPRINT-005 built a gazetteer out of circles. Every `Site` matches inside
600 m (takeoff) / 900 m (landing) of one anchor point; every `Zone` inside 300 m / 400 m.
A circle is the right default — it needs one tap and zero geometry from the pilot — but
it's the wrong shape for most real flying sites. A ridge is 3 km long and 200 m wide: the
circle that covers the middle of it also swallows the LZ, the next site over, and a
motorway. A launch tucked in a bowl is 80 m across: the 300 m circle around it reaches
across the spine to a completely different launch.

This sprint lets a pilot **draw the actual shape** — a polygon traced on a map — and use
it instead of the circle for that one site or that one zone. Everything else stays
exactly as SPRINT-005 shipped it.

Five decisions anchor the sprint:

1. **A boundary is geometry, never identity.** It changes *which row matches a flight*,
   and nothing else. No new `Flight` column, no new cached value, no new visibility
   dimension, no change to `canSeeSite`/`canSeeZone`, no change to `locationCachePatch`,
   no change to `resolveLocationFields`. The read-path firewall isn't extended this
   sprint because it has nothing new to guard — and that is a property to **prove**, not
   assume (see [Security](#security-privacy--authz)).

2. **A boundary *replaces* the circle for the row that has one; a row without one is
   byte-identically unchanged.** Not a union, not a widening. A polygon can be *tighter*
   than the circle (excluding a neighbouring launch the 300 m circle wrongly grabbed) as
   well as *looser* (covering the whole ridge). A union would only ever grow the match
   area and could never fix an over-matching site — the more common complaint.

3. **Storage is a versioned GeoJSON envelope in `jsonb`, with a derived bounding box in
   four indexed `Float` columns.** No PostGIS, no `Unsupported()` column, no raw-SQL
   match query. The bbox columns keep the DB prefilter index-assisted, so the matching
   query count stays at exactly **two round trips per endpoint** — the same as today —
   and the point-in-polygon test stays a pure function in `lib/sites/geo.ts` next to
   `withinRadius`, unit-tested with no database in sight.

4. **A boundary change is additive only: it never un-binds a flight that is already
   bound** — not the drawer's, and certainly not another pilot's. Drawing a *bigger*
   boundary upgrades the drawer's own unmatched flights (reusing SPRINT-005's
   `reassociateOwnFlights`, guard rails intact). Drawing a *tighter* one changes future
   matching only. This preserves SPRINT-005's load-bearing rule verbatim: a gazetteer
   edit only ever adds precision, it never removes a match a pilot already had.

5. **Editing reaches beyond an already-bound flight.** Both independent drafts of this
   sprint gated boundary editing behind a flight already bound to the row — which makes
   the headline use case (expanding a ridge site whose endpoints currently fall
   *outside* its old circle) unreachable, since there's no bound flight to open the
   dialog from. This sprint adds an **owner-scoped picker**: any signed-in pilot can
   reach "Edit a boundary" from the naming dialog and choose from their own sites, own
   zones, and zones under sites they own — no bound flight required.

**Committed v1 scope**

1. `Site.boundary` and `Zone.boundary` (`jsonb`, nullable) holding a versioned envelope
   around a single-ring GeoJSON `Polygon`, plus four derived nullable `Float` bbox
   columns per table, a partial index on the boundary-bearing rows only, a
   `boundaryUpdatedById` attribution column, and raw-SQL CHECKs tying the bbox columns
   to the boundary's presence.
2. Pure geometry in `lib/sites/geo.ts` (inclusive point-in-polygon, ring area,
   self-intersection, derived bbox, per-row `distanceM`) and pure validation in a new
   `lib/sites/boundary.ts` (mirroring `lib/sites/name.ts`'s shape: validate → normalize →
   return a canonical value or a typed error).
3. Boundary-aware matching in `lib/sites/lookup.ts` — the existing circle-bbox prefilter
   `OR`ed with the boundary-bbox prefilter in the **same** query per level, then the
   per-row rule "boundary if present, else circle." Zone-first / site-fallback ordering,
   `compareSiteCandidates`, and anchor-distance ranking are **untouched** — no new
   ranking tier for polygon matches (see [Q2](#open-questions)).
4. Boundary-aware `reassociateOwnFlights` and `suggestNearbyLocations`, so the naming
   dialog and the matcher never disagree about what's nearby.
5. Owner-gated write path in `lib/sites/associate.ts`, an owner-scoped picker + boundary
   editor reachable from the flight page's naming dialog with no bound-flight
   precondition, and a MapLibre tap-to-trace drawing UI.
6. A rollback kill switch (`SITE_BOUNDARY_MATCHING=off`), operator remedy
   (`boundary-clear` / `zone-boundary-clear` in `scripts/admin-sites.ts`, plus
   boundary-preserving `merge`/`zone-merge`), and a modest daily rate limit on boundary
   writes.

**Explicitly out of scope** (with reasons)

- **PostGIS, `geometry`/`geography` columns, `ST_Contains` matching.** See
  [Q1](#open-questions) — it buys nothing at this scale and costs the typed, composable
  visibility predicates the privacy model is built on.
- **Multi-polygon boundaries and holes.** One outer ring only. A site with two disjoint
  areas is two sites (or a site with two zones); a hole has no pilot behind it. The
  envelope's `v` field is how a future sprint adds them without a migration.
- **A separate per-site/per-zone numeric radius override.** Folded in *by design*, not
  shipped: the envelope's `kind` discriminant makes a radius override a **variant of
  this same column** rather than a parallel schema change. See [Q3](#open-questions).
- **Endpoint-specific boundaries for `kind: "both"` rows.** One boundary applies to both
  takeoff and landing matching for a `both` row. See [Q9](#open-questions).
- **Boundaries on anything but a pilot-owned `Site`/`Zone`.** No boundaries on flights,
  no airspace, no "restricted area" semantics.
- **Any pilot editing any public site's boundary.** Boundary editing follows the
  existing ownership model exactly — a site owner, a zone's own owner, or (for a zone)
  the parent site's owner, via the same `findZoneEditableBy` rule SPRINT-005 already
  established.
- **Auto-derived boundaries** (convex hull of bound flights, centroid drift). Needs real
  usage data first and interacts badly with "never un-bind."
- **Full boundary rendering on the public flight map or a site directory.** The editor
  shows the boundary being edited plus nearby visible boundaries for context; a public
  "see every site's shape" surface is a separate map-design question with no matching
  value. Deferred whole.
- **Antimeridian-crossing boundaries.** Refused at write time, with a graceful fallback
  to circle matching. See [Q6](#open-questions).
- **A dedicated site/zone management page.** The owner-scoped picker (decision 5) lives
  inside the existing flight-page dialog. No `/sites/<id>` route, preserving the
  standing "no site or zone id ever appears in a URL" policy.

## Use Cases

1. **The ridge that doesn't fit in a circle.** Mission Ridge is a 3 km spine. Its 600 m
   circle covers the middle third; flights from either end read "Unknown site." The
   owner opens any flight, taps "Edit a boundary," picks Mission Ridge from their own
   sites (no bound flight required — decision 5), traces the ridge, and saves. Their own
   previously-unmatched flights from both ends re-label immediately, and every pilot's
   future flight from the whole ridge matches.
2. **The circle that grabs too much.** "South Bowl" and "North Launch" sit 250 m apart
   on opposite sides of a spine; the 300 m zone circles overlap, so half the North
   Launch flights come up as South Bowl. The owner draws a tight boundary around each.
   Future flights land on the right one. Already-bound flights keep their (possibly
   wrong) binding — fixing those is the pilot's existing per-flight remedy, not a silent
   retroactive rewrite.
3. **Drawing a boundary you don't need.** Most sites never get one. The affordance is
   one more entry point the pilot can ignore, and the site keeps matching by circle
   forever. Zero pilots are worse off.
4. **A zone whose boundary reaches past its parent's circle.** The LZ is 1.2 km
   down-valley from the site anchor — outside the site's 900 m landing circle, inside
   the drawn zone boundary. The flight matches the zone, and SPRINT-005's existing rule
   ("a zone win returns its parent regardless of the parent's own distance") hands back
   "Mission Ridge — Lower LZ" with no new code.
5. **A boundary that doesn't contain the anchor.** A pilot traces the launch 400 m north
   of where the site's anchor point sits. Save is refused with "The boundary has to
   include the site's own location" — the editor shows that location as a labelled
   marker the whole time, so the fix is obvious.
6. **Somebody drew something absurd.** A pilot traces a 300 km polygon around half of
   California. Save is refused client-side as they draw (the area readout turns red) and
   again server-side. If a merely-annoying-but-legal boundary ships anyway, an operator
   runs `boundary-clear <siteId>` and the site is back to circle matching in one
   command.
7. **A boundary on somebody else's zone under your site.** The parent site's owner opens
   "Edit a boundary," and the picker lists zones under sites they own even when they've
   never flown from that zone themselves. They edit or clear it — the same scoped power
   SPRINT-005 decision 4 gave them for rename/delete, reachable this time without needing
   a coincidentally-bound flight.
8. **A public zone polygon drawn larger than the old circle.** A pilot draws a 3 km²
   zone boundary — well past the old 300 m/400 m circle scale. It's allowed (decision 2
   below); the editor shows the old circle and nearby visible sites/zones while they
   draw, so the scale of what they're doing is visible, and if it turns out to be a
   mistake, `boundary-clear` fixes it in one command.
9. **The device-push path inherits it for free.** A Leaf pushes a flight from inside a
   drawn boundary. `ingestFlight` matches it two levels deep with no route change and no
   knowledge that a boundary exists.
10. **A corrupt stored boundary.** A future bug, a manual SQL edit, or a botched restore
    leaves one row's `boundary` JSON malformed. Ingest for flights near that row still
    succeeds — the row is skipped from that pass, a structured warning is logged, and the
    pilot sees "Unknown site" instead of a 500. The row's own `boundary-clear` (or a fix
    and re-save) is the resolution.
11. **Rolling it back.** If matching misbehaves in production, `SITE_BOUNDARY_MATCHING=off`
    treats every row as circle-only with no data change and no redeploy. If PR2 itself is
    reverted after boundaries exist, every boundary-bearing row falls back to circle
    matching; flights already bound stay bound.

## Architecture

### Data model

```prisma
model Site {
  // ...unchanged, including lat/lon (still REQUIRED — the anchor never goes away)...

  /// SPRINT-006. Null = match by radius, exactly as SPRINT-004/005.
  /// Non-null = a BoundaryEnvelope (lib/sites/boundary.ts); the radius is
  /// then not consulted for this row at all.
  boundary           Json?
  /// Derived from `boundary` by boundaryColumns() and written ONLY with it.
  boundaryMinLat     Float?
  boundaryMaxLat     Float?
  boundaryMinLon     Float?
  boundaryMaxLon     Float?
  /// Who last set or cleared the boundary — the site's own owner, or (for a
  /// zone) the zone's owner or the parent site's owner. Null if never set.
  boundaryUpdatedById String?
  boundaryUpdatedBy   Profile? @relation("BoundaryUpdatedSites", fields: [boundaryUpdatedById], references: [id], onDelete: SetNull)

  // NOTE: the partial index over the four bbox columns is raw SQL in the
  // migration — Prisma v6 cannot express `WHERE boundary IS NOT NULL`.
}

model Zone {
  // ...unchanged... plus the identical six columns, same semantics.
}

model Flight {
  // COMPLETELY UNCHANGED. All eight SPRINT-005 cache columns keep their exact
  // meaning; no boundary is ever denormalized onto a flight.
}
```

Raw SQL in the migration (the SPRINT-005 precedent, same comment discipline):

```sql
-- Prisma v6 can express neither of these; migrate-diff drift is expected.
ALTER TABLE "Site" ADD CONSTRAINT "site_boundary_bbox_check"
  CHECK (num_nulls("boundary", "boundaryMinLat", "boundaryMaxLat",
                   "boundaryMinLon", "boundaryMaxLon") IN (0, 5));

CREATE INDEX "Site_boundary_bbox_idx"
  ON "Site" ("boundaryMinLat", "boundaryMaxLat")
  WHERE "boundary" IS NOT NULL;
-- ...and the identical pair on "Zone".
```

The CHECK is the one invariant worth spending a constraint on: **all five geometry
columns are null or none are.** Single-table, no FK cascade, and can never be caught
mid-transaction in a legitimate state — every write goes through one function
(`boundaryColumns()`) that produces all four bbox columns together or all null, driven
by whether `boundary` itself is present.

**On the index — an honest claim, not an overstated one.** The partial index is a *set
reducer*, not a spatial index: it restricts the scan to boundary-bearing rows (expected
to be a small minority) and Postgres filters the remaining three range predicates in
memory. At the scale this sprint plans against
([Performance](#performance-what-acceptable-and-realistic-mean)) that's a sub-millisecond
bitmap scan followed by a cheap filter — but it is a scan of boundary-bearing rows, not a
seek to exactly the matching ones, and the DoD requires this to be demonstrated, not just
asserted (see DoD). Filtering in Prisma is done on the **scalar bbox columns**
(`boundaryMinLat: { not: null }`, etc.), never on the `Json` column directly — Prisma v6
disambiguates DB `NULL` from JSON `null` on `Json` fields via `Prisma.DbNull` /
`Prisma.JsonNull`, and a naive `boundary: { not: null }` filter does not compile the way
it looks like it should. Filtering on the bbox `Float` columns sidesteps that trap
entirely, and the all-or-none CHECK makes it exactly equivalent to filtering on
`boundary` itself. **The named upgrade path, if scale ever demands it:** a core-Postgres
`box` column with a GiST index and the `@>` operator — no extension needed, and the bbox
columns already hold what a `box` would. Rejected for v1 only because Prisma v6 would
need `Unsupported("box")` and a `$queryRaw` match, moving the visibility predicates out
of composable `Prisma.SiteWhereInput` and into hand-written SQL — a privacy-relevant
downgrade that buys nothing until there are ~10⁵ boundary rows.

### The boundary envelope

Stored value, exactly:

```jsonc
{
  "v": 1,
  "kind": "polygon",
  "geometry": {
    "type": "Polygon",
    // ONE ring. [lon, lat] order (GeoJSON), closed (last === first),
    // counter-clockwise (RFC 7946 right-hand rule), coordinates rounded to
    // 6 decimals (~11 cm).
    "coordinates": [[[-122.4194, 37.7749], /* ... */ [-122.4194, 37.7749]]]
  }
}
```

Three things the wrapper buys that a bare GeoJSON geometry doesn't:

- **`v`** — the validation rules (caps, ring count, winding) are a contract with data
  already in the database. A future sprint that raises the vertex cap or allows holes
  bumps `v` and branches, instead of reinterpreting old rows.
- **`kind`** — the discriminant that folds the adjacent per-site-radius idea into this
  same column instead of a parallel one. A radius override is a future
  `{ "v": 1, "kind": "circle", "radiusM": 450 }`; the matching helper gets one more
  branch and *nothing else in the system changes* — same column, same CHECK, same bbox
  columns, same validator seam, same operator `boundary-clear`, same editor entry point.
  See [Q3](#open-questions).
- **A literal GeoJSON geometry inside** — a boundary round-trips through geojson.io,
  QGIS, or a future import/export with no bespoke format.

### Pure geometry (`lib/sites/geo.ts`)

New exports, all with the same no-DB/no-Next discipline as `withinRadius` and
`boundingBox`:

```ts
export const EDGE_TOLERANCE_M = 0.5;

/** True when (lat, lon) is strictly inside the ring. Ray-casting, half-open
 *  edge rule, so a vertex the ray passes through is counted once. */
function pointStrictlyInRing(ring: Ring, lat: number, lon: number): boolean;

/** True when (lat, lon) lies within EDGE_TOLERANCE_M of any edge segment. */
function pointOnRingEdge(ring: Ring, lat: number, lon: number): boolean;

/** The inclusive membership test — on the edge counts as inside. */
export function boundaryContains(boundary: Boundary, lat: number, lon: number): boolean;

export function boundaryBoundingBox(boundary: Boundary): { minLat; maxLat; minLon; maxLon };
export function ringAreaM2(ring: Ring): number;
export function ringSelfIntersects(ring: Ring): boolean;

/** THE composition point — the single place "boundary if present, else circle"
 *  is decided, AND the single place a distanceM is attached for ranking.
 *  findLocation, reassociateOwnFlights and suggestNearbyLocations all call
 *  this and nothing else. */
export function locationMatches(
  row: { lat: number; lon: number; boundary: unknown },
  lat: number,
  lon: number,
  radiusM: number,
): { matched: boolean; distanceM: number };
```

`distanceM` is **always** `haversine(point, row.anchor)`, computed unconditionally —
whether the row matched by circle or by boundary. This is what closes the mechanical gap
both independent drafts left open: a polygon-matched row needs a distance to sort by, and
"distance to this place's anchor" is a well-defined, already-tested number regardless of
which shape decided *whether* it matched. `compareSiteCandidates` needs no change at
all, and ranking stays anchor-distance-only for every row — see
[Q2](#open-questions) for why no membership tier was added despite one being proposed
during cross-critique.

Four things pinned down explicitly, because each is a place a subtle bug lives:

- **Edges are straight lines in lon/lat space** — the GeoJSON default interpretation
  (RFC 7946 treats a ring as straight segments between positions). At a launch's scale
  (<10 km) the difference from a geodesic is centimetres, far below the ±11 cm the
  stored precision even represents.
- **Boundary points are inside** (`<=`, matching `withinRadius`'s existing inclusive
  comparison — [Q6](#open-questions)). Ray-casting alone is *undefined* on the boundary
  and will flip on floating-point luck, so `pointOnRingEdge` runs **first** and
  short-circuits to true, with a tolerance expressed in **metres** (0.5 m, an order of
  magnitude below GPS fix noise) rather than degrees.
- **Area** is computed by projecting the ring equirectangularly about its own centroid
  (`x = R·Δlon·cos(lat₀)`, `y = R·Δlat`) and applying the shoelace formula — accurate to
  well under 0.1% at these extents, computed on **metres, not raw degrees** (a
  planar-on-degrees area is wrong by `cos(lat)`, which would matter at Leaf Log's actual
  latitudes and was a real gap in one of the independent drafts).
- **Winding is normalized to counter-clockwise at write time.** `boundaryContains` is
  winding-agnostic, so this is purely so stored data is valid RFC 7946 for export.

### Validation (`lib/sites/boundary.ts`)

Pure, no DB/Next imports, shaped exactly like `lib/sites/name.ts` — a typed
`{ ok: true; boundary }` / `{ ok: false; error }` result, so the server action, the
operator script, and the client-side live preview all share one authority.

```ts
export const MIN_BOUNDARY_VERTICES = 3;
export const MAX_BOUNDARY_VERTICES = 200;
export const MIN_BOUNDARY_AREA_M2 = 100;             // a 10 m × 10 m box
export const MAX_SITE_BOUNDARY_AREA_M2 = 50_000_000; // 50 km²  (~44× the 600 m circle)
export const MAX_ZONE_BOUNDARY_AREA_M2 = 20_000_000;  // 20 km²  (deliberately generous —
                                                       //   see Q2; kept smaller than the
                                                       //   site cap only to preserve some
                                                       //   asymmetry, not to bound scale)

export type BoundaryError =
  | "malformed" | "unsupported_version" | "too_few_vertices" | "too_many_vertices"
  | "coordinate_out_of_range" | "crosses_antimeridian" | "self_intersecting"
  | "degenerate" | "too_large" | "excludes_anchor";

export function validateBoundary(
  raw: unknown,
  level: "site" | "zone",
  anchor: { lat: number; lon: number },
): BoundaryValidationResult;
```

The checks, in order (cheap first, each a named error the UI can phrase):

1. **Envelope shape and `v === 1`**; `kind === "polygon"`; `geometry.type === "Polygon"`;
   exactly one ring.
2. **Vertex count** 3–200 distinct (4–201 positions with the closing repeat), counted
   **after** de-duplicating consecutive-identical taps (the common phone case of tapping
   the same spot twice). 200 bounds the worst-case ray-cast at 200 segment tests per
   candidate row.
3. **Coordinate range** — finite, `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`.
4. **Antimeridian** — the ring's lon span must be < 180° and must not straddle ±180°.
   Refused rather than half-supported; see [Q6](#open-questions).
5. **Degeneracy** — no zero-length edges (consecutive duplicates), positive area
   ≥ 100 m².
6. **Self-intersection** — every non-adjacent segment pair tested (O(n²), ≤ 19,900 pairs
   at the cap, ~0.2 ms). A bow-tie polygon has no well-defined interior; refusing it at
   write time is the only way the match-time answer is ever meaningful. Includes the
   figure-eight case (a ring that touches itself at a single shared vertex without
   crossing edges) as an explicit test.
7. **Area cap** for the level (site or zone — see the constants above; the zone cap is
   generous by the interview's explicit choice, not tight).
8. **Contains the row's own anchor** (`boundaryContains(candidate, anchor)`), tested
   **after** normalization (6-decimal rounding, ring closure) — not against the raw
   client input. This is the invariant that keeps `distanceM` meaningful: the anchor
   stays the row's "where," so `compareSiteCandidates` needs no change and a boundary can
   never drag a row's notion of its own location somewhere else.

Then **normalize**: close the ring, orient counter-clockwise, round to 6 decimals,
re-emit the canonical envelope. What's stored is always canonical, never whatever the
client sent.

### Matching — same two queries, one more prefilter branch

The SPRINT-005 structure (parallel zone and site passes, zone-first, site fallback
always runs, `compareSiteCandidates` ordering) is **structurally untouched**. Two things
change inside each pass.

**One, the DB prefilter becomes a union.** Today's box is around the *query point* and
tests the row's anchor — which works only because "point within R of anchor" and
"anchor within R of point" are the same statement. A polygon breaks that symmetry: a
boundary can reach far past its anchor, so the anchor may sit outside the point's box
while the boundary still contains the point. The fix is one `OR` in the same `findMany`:

```ts
{ OR: [
    // circle candidates — the SPRINT-004/005 predicate, byte-for-byte
    { AND: [{ lat: { gte: box.latMin, lte: box.latMax } }, lonWhereFor(box)] },
    // boundary candidates — the row's OWN bbox contains the query point
    { AND: [
        { boundaryMinLat: { lte: lat } }, { boundaryMaxLat: { gte: lat } },
        { boundaryMinLon: { lte: lon } }, { boundaryMaxLon: { gte: lon } },
      ] },
] }
```

Circle-only rows have NULL bbox columns, and `lte`/`gte` against NULL is never true, so
the second branch can only ever return boundary-bearing rows. **The query count does not
change** — still exactly two round trips per endpoint, still `Promise.all`'d, still with
`kind` and the visibility `OR` as ordinary typed Prisma predicates.

**Two, the exact filter becomes per-row, via `locationMatches`:**

| row has a boundary? | matched when                         | `distanceM` |
| -------------------- | ------------------------------------- | ------------ |
| no                    | `haversine(point, anchor) <= radius`  | haversine to anchor |
| yes                   | `boundaryContains(boundary, point)`   | haversine to anchor |

**Ranking is deliberately NOT changed to prefer boundary matches** — no membership tier.
The tempting rule ("a drawn boundary is a stronger statement of intent, so it should
win") breaks the more important one: a 3 km ridge boundary would then beat a *different*,
plainly nearer named site 50 m from the pilot's feet. Nearest-anchor-wins is the
existing, tested contract. The interview explicitly confirmed this trade-off when it
chose "allow large zone boundaries, accept the risk, no ranking change" over the
alternative of adding a tier — see [Q2](#open-questions) and
[Risks](#risks).

Two consequences that fall out for free:

- **A zone boundary outside the parent site's circle just works.** SPRINT-005's zone win
  already returns the parent regardless of the parent's own distance.
- **`kind` filtering is untouched.** A `kind: "takeoff"` site with a boundary still only
  matches takeoff endpoints. A boundary answers *where*, never *what*, and (per the
  interview) a `kind: "both"` row's single boundary answers *where* for both endpoints —
  see [Q9](#open-questions).

**Malformed stored geometry fails closed, per row.** The CHECK constraint proves the
five columns are present or absent together; it proves nothing about whether `boundary`
parses into a valid envelope. `locationMatches` treats a boundary that fails to parse (or
fails `validateBoundary` on read) as **"this row does not match,"** not as a thrown
exception and not as a silent fallback to circle matching. A thrown exception would take
down ingest for every flight near the corrupt row, including unrelated ones; falling back
to circle would silently restore a match a pilot may have deliberately tightened away.
Skipping the row and logging a structured warning (row id, table, error) is the
fail-closed middle: the pilot sees "Unknown site" instead of a 500, and the row's own
`boundary-clear` (or a corrected re-save) is the fix.

### Suggestions and re-association

`suggestNearbyLocations` (the naming dialog's reuse-first sweep) gets the same `OR`'d
prefilter and the same per-row rule, so a site whose *boundary* you're standing in is
offered even when its anchor is 3 km outside the 2 km suggest radius. Its `distanceM`
stays anchor distance, so ordering is unchanged; a boundary-matched site simply appears
in a list it would otherwise have been missing from. The **in-transaction duplicate-name
probe** inside site/zone creation gets the identical treatment — without it, the "already
exists nearby, reuse it" guard would silently stop protecting boundary-bearing rows at
exactly the distances the boundary feature makes reachable, which is precisely the
scenario decision 5's picker exists to avoid (a pilot creating a duplicate "Mission
Ridge" because the dialog didn't know the real one's shape reached them).

`reassociateOwnFlights` gets boundary awareness on **both** ends:

- the bbox it scans for candidate flights is the boundary's bbox (not the radius box)
  when the anchor row has a boundary;
- the exact filter is `locationMatches`, not raw haversine.

Its existing guard rails are **not** relaxed: creator's own flights only, `status:
'ready'` only, the `[siteId] IS NULL OR (same site AND [zoneId] IS NULL)` clause that
makes it additive-only, the `REASSOCIATE_CAP` of 200, and the mandatory log line when the
cap truncates. Because that `where` clause can only ever *fill in* a null, **tightening a
boundary can never un-bind anything** — decision 4 is enforced by the shape of the
existing query, not by a rule someone has to remember.

### The write path

Six functions in `lib/sites/associate.ts` — the module that already owns "authorized
mutations to `Site`/`Zone` rows and their consequences":

```ts
setSiteBoundary(siteId, callerId, raw): Promise<Site>       // owner only
clearSiteBoundary(siteId, callerId): Promise<Site>          // owner only
setZoneBoundary(zoneId, callerId, raw): Promise<Zone>       // findZoneEditableBy
clearZoneBoundary(zoneId, callerId): Promise<Zone>          // findZoneEditableBy
listOwnedSitesForBoundaryEditing(callerId): Promise<...>    // owner's own sites
listOwnedZonesForBoundaryEditing(callerId): Promise<...>    // own zones + zones under own sites
```

Each mutator: load the row (owner-gated — the zone pair reuses the **existing**
`findZoneEditableBy`, which already encodes "the zone's owner, or the parent site's
owner"), validate against that row's own anchor and level, write `boundary`, the four
bbox columns, and `boundaryUpdatedById` **together** via one `boundaryColumns()` helper,
log structurally, return. Hidden and nonexistent rows are indistinguishable in the
error, same as everywhere else.

The two list functions are new — they back decision 5's picker. Both are owner-scoped
reads: `listOwnedSitesForBoundaryEditing` returns sites where `ownerId = callerId`;
`listOwnedZonesForBoundaryEditing` returns zones where `ownerId = callerId` **or** whose
parent site's `ownerId = callerId` — exactly the set `findZoneEditableBy` already
recognizes as editable, just listed instead of looked up one at a time. Neither leaks
anything about rows the caller doesn't own or edit-control; a row outside that set simply
never appears in the list, the same posture as every other owner-scoped read in this
codebase.

`boundaryColumns(boundary | null, updatedById)` is the single writer of those five
mutable columns per table, in the same spirit as `locationCachePatch` — and it is
genuinely simple enough to be a pure function, since it derives the bbox from the
already-validated boundary.

Two guards deliberately **not** copied from rename/delete:

- **No "refused once another pilot's flight references it."** Rename and delete are
  guarded because they destroy something other pilots depend on. A boundary edit
  destroys nothing: existing bindings survive by construction, and the worst case is a
  future flight matching differently — what a gazetteer edit *is*.
- **No `DAILY_CREATE_CAP`.** That cap bounds *row creation* (the abuse vector is
  namespace pollution). A boundary edit creates no rows. Instead, a **separate, modest
  daily cap on boundary writes** (`DAILY_BOUNDARY_EDIT_CAP`, generous — e.g. 20/day) is
  the abuse backstop for this specific write path, mirroring the existing pattern rather
  than reusing its number.

Server actions in `app/flights/[id]/site-action.ts` and a new
`app/flights/[id]/boundary-action.ts`, following the `nameSite`/`unpublishZoneForFlight`
pattern for the already-bound case, plus new owner-gated actions for the picker path:

- `saveBoundaryForFlightEndpoint(flightId, endpoint, level, raw)` /
  `clearBoundaryForFlightEndpoint(flightId, endpoint, level)` — the row id is re-derived
  from the flight row, exactly as SPRINT-005's pattern, for the common already-bound
  case.
- `listMyBoundaryEditableRows()` — returns the picker's contents for the signed-in
  caller.
- `saveBoundaryForOwnedRow(level, id, raw)` / `clearBoundaryForOwnedRow(level, id)` — the
  new picker path. The id **does** come from the client here — this is the deliberate,
  narrow exception decision 5 introduces — but every one resolves through
  `setSiteBoundary`/`clearSiteBoundary`/`setZoneBoundary`/`clearZoneBoundary`, which
  re-verify ownership from scratch before touching anything. An id for a row the caller
  doesn't own or edit-control fails exactly like a nonexistent id.

### The drawing UI

Reached from the naming dialog via a new "Edit a boundary" entry point that's always
present (not gated on the current flight being bound), opening the owner-scoped picker
first when there's more than one candidate, or going straight to the editor when the
current flight is already bound to exactly one editable row.

`components/flight/boundary-editor.tsx` — a MapLibre map (the same `styleFor()`
basemaps as `track-map.tsx`, no new dependency) with:

- the site's/zone's **anchor** as a labelled marker ("Site location — must be inside"),
  and the **current circle** drawn as a dashed reference ring so the pilot sees what
  they're replacing;
- the parent site's boundary or circle drawn faintly underneath when editing a zone —
  *context, not a constraint* (a zone boundary reaching past its parent is legal — see
  [Q4](#open-questions));
- **nearby visible sites'/zones' boundaries and circles drawn faintly for context** — the
  mitigation the interview's "allow large zone boundaries" decision leans on: a pilot
  drawing something oversized can see what else is nearby before they save;
- tap to add a vertex, drag a vertex to move it, tap a vertex to remove it, **Undo last
  point**, **Clear** (behind a confirmation — clearing a hand-drawn shape is not
  reversible, and the confirmation is the cheap mitigation for that);
- a live readout — vertex count, area, and the first failing rule from
  `validateBoundary` — so an invalid shape is visible while drawing rather than on save;
- **Save**, **Remove boundary** (back to circle matching, confirmed), **Cancel**.

The editor's **state machine** (vertex list, undo stack, the running validation result)
is a separate, pure, jsdom-testable module from the MapLibre rendering shell — vitest's
`environment: "jsdom"` has no WebGL, so a component test against the rendering layer
itself would be untestable; extracting the state machine is what makes PR4's tests real
rather than aspirational.

Rendering is three MapLibre layers over one GeoJSON source (fill, line, vertex circles)
— the same primitives `track-map.tsx` already uses. Explicitly **no**
`mapbox-gl-draw` or `terra-draw`: the whole editor is ~250 lines of code under our
control, against a dependency whose MapLibre compatibility is a moving target and whose
feature surface is far more than a v1 needs.

The client imports `validateBoundary` from `lib/sites/boundary.ts` — the *same* pure
module the server action uses — so the two can't drift. The server remains the
authority: the client check is UX, and PR3's tests assert the server refuses a boundary
the client would have blocked.

### Performance — what "acceptable" and "realistic" mean

**Realistic**, the ceiling this design is planned against: 10,000 `Site` rows and 25,000
`Zone` rows globally; ≤10% of them boundary-bearing; ≤200 vertices each; ≤50 candidate
rows returned by both prefilter branches combined for any single endpoint. (Production
today has a low-double-digit number of sites, all pilot-created.)

**Acceptable**, the properties that must hold:

- `findLocation` stays at **exactly two DB round trips per endpoint** (unchanged from
  SPRINT-005) — the boundary branch is an `OR` inside the existing query, never a third
  query.
- The boundary prefilter is index-assisted for the "which rows even have a boundary"
  restriction; a seeded test (or an `EXPLAIN`-backed assertion) demonstrates the query
  Prisma generates actually filters on the indexed bbox columns, rather than resting on
  an unverified claim.
- App-layer geometry adds **< 2 ms per endpoint** at the ceiling above.
- A unit **guard benchmark** — 1,000 `boundaryContains` calls against a 200-vertex ring
  complete in < 50 ms — asserted in CI, generously bounded to avoid flaking on shared CI
  hardware. A regression tripwire, not a wall-clock SLA.
- Boundary JSON is `select`ed only in the two match queries, the picker/editor's own
  owner-gated read, and the operator script — never in a list query, never on a flight
  page, never in a feed. A 200-vertex ring is ~4 KB; it must not ride along on any
  `LIST_SELECT`-style projection, and this is asserted structurally (a test enumerating
  every `select` that could plausibly reach it), not just by code review.

## Implementation

Four ordered PRs. Each ships its migration where needed and passes all five gates
(`pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm e2e`). The ordering is
itself a safety property, exactly as in SPRINT-004/005: **nothing in the app can create
a boundary until PR3, so PR1 and PR2 are inert in production by construction.**

### PR1 — Storage and pure geometry (no behaviour change anywhere)

- Migration `20260822xxxxxx_site_zone_boundaries`: six nullable/attribution columns on
  `Site` and on `Zone`, the two partial indexes, the two `num_nulls` CHECKs, with the
  standard "Prisma v6 can't express this; drift is expected; do not delete to fix drift"
  comment. Purely additive — every existing row keeps null boundaries and circle
  matching.
- `lib/sites/geo.ts`: `boundaryContains`, `pointOnRingEdge`, `pointStrictlyInRing`,
  `ringAreaM2`, `ringSelfIntersects`, `boundaryBoundingBox`, `locationMatches`,
  `EDGE_TOLERANCE_M`.
- `lib/sites/boundary.ts` (new): the envelope types, the caps, `validateBoundary`,
  `normalizeBoundary`, `boundaryColumns`. No DB, no Next.
- Unit tests (`geo.test.ts`, `boundary.test.ts`): a point clearly inside; clearly
  outside; **exactly on a vertex**; **exactly on an edge midpoint**; 0.4 m and 0.6 m off
  an edge (the tolerance boundary from both sides); a concave "C" shape with the query
  point in the concavity; a ring whose bbox contains the point but whose interior
  doesn't; a ray that would pass exactly through a vertex (the classic ray-casting
  double-count bug); a figure-eight (self-touching at one vertex, no crossing edges); a
  boundary strictly *tighter* than the circle correctly excluding a point the circle
  accepts; a boundary strictly *looser* correctly accepting a point the circle rejects;
  each validator rejection with its own error code; area against three hand-computed
  reference polygons (including one at a latitude high enough that a planar-on-degrees
  bug would fail it); winding normalization for a clockwise input; anchor-containment
  tested post-normalization, not on raw input; the ≤50 ms guard benchmark.
- `lib/sites/geo.test.ts`'s existing radius/antimeridian/`cosLat` coverage re-run
  unchanged — the circle path must be provably byte-identical.

### PR2 — Boundary-aware matching (still nothing can create a boundary)

- `lib/sites/lookup.ts`: the `OR`'d prefilter in both `siteCandidates` and
  `zoneCandidates`, `boundary` added to both `select`s, `withinRadius` → `locationMatches`
  in both passes (which also attaches `distanceM` for every row, closing the ranking
  mechanical gap). `compareSiteCandidates`, the zone-first precedence, the unconditional
  site fallback, and `canSeeZone` re-checking are all untouched — and their existing
  tests must pass unmodified, the regression check for "a site/zone with no boundary
  behaves exactly as before." Malformed stored geometry is caught and logged, never
  thrown, never silently treated as a circle match.
- `lib/sites/repo.ts`: the same prefilter in `suggestNearbyLocations` and the
  in-transaction duplicate-name probe; boundary-aware anchor/bbox/filter in
  `reassociateOwnFlights`.
- A `SITE_BOUNDARY_MATCHING` env flag, read once in `lookup.ts`: when set to `"off"`,
  every row is treated as circle-only regardless of stored boundaries — the rollback
  kill switch, a few lines, tested directly.
- Integration (`test/sites.integration.test.ts`): a point outside the circle but inside
  the boundary matches; inside the circle but outside a *tighter* boundary does **not**
  match; a zone boundary reaching past its parent's circle still yields "Site — Zone"; a
  boundary-bearing site and a circle-only site both in range rank by anchor distance
  (deterministically, both orders asserted, proving no membership tier crept in); a
  private boundary-bearing site never matches a stranger's ingest; device push and web
  upload produce identical bindings; a malformed stored boundary is skipped with a
  logged warning and does not throw; the `SITE_BOUNDARY_MATCHING=off` flag reproduces
  circle-only behavior on boundary-bearing rows.
- **The privacy matrix re-run, parameterized.** `test/sites.integration.test.ts`'s
  owner/friend/stranger/anonymous × (site visibility × zone visibility) ×
  flight-visibility matrix is factored to run **twice**: once with circle-only rows
  (today's assertions, unchanged) and once with the identical rows carrying boundaries.
  Every assertion must be identical in both runs.

### PR3 — The write path, including the owner-scoped picker (the first PR that can create a boundary)

- `lib/sites/associate.ts`: `setSiteBoundary` / `clearSiteBoundary` /
  `setZoneBoundary` / `clearZoneBoundary` / `listOwnedSitesForBoundaryEditing` /
  `listOwnedZonesForBoundaryEditing`; `boundaryColumns` as the single writer of the five
  mutable columns; `DAILY_BOUNDARY_EDIT_CAP`; structured logging on every set/clear.
- `app/flights/[id]/site-action.ts` and `app/flights/[id]/boundary-action.ts`: the
  bound-flight path (`saveBoundaryForFlightEndpoint`/`clearBoundaryForFlightEndpoint`,
  row ids re-derived from the flight row) and the picker path
  (`listMyBoundaryEditableRows`, `saveBoundaryForOwnedRow`/`clearBoundaryForOwnedRow`,
  ownership re-verified from a client-supplied id).
- Re-association fires on a successful set, additively.
- Integration: a non-owner's save is refused and indistinguishable from "not found," via
  **both** the bound-flight path and the picker path; a zone's boundary is editable by
  the parent site's owner via the picker even with **no** flight of theirs bound to that
  zone (closing the reachability gap both drafts left); the picker never lists a row the
  caller doesn't own or edit-control; the server refuses every validator rejection
  independently of the client; a tightened boundary leaves already-bound flights (the
  drawer's **and** another pilot's) bound; a widened boundary upgrades only the drawer's
  own previously-unmatched flights; the `num_nulls` CHECK rejects a hand-written
  half-written row; the daily boundary-edit cap is enforced and its truncation is logged.
- `lib/sites/write-audit.test.ts` re-run unmodified — this sprint writes no `Flight`
  cache column outside `reassociateOwnFlights`'s existing `locationCachePatch` call, and
  the audit passing untouched is the evidence.

### PR4 — Drawing UI, operator remedy, release pass

- `components/flight/boundary-editor.tsx` (rendering shell) and a separate, pure editor
  state-machine module (vertex list, undo stack, running validation) tested directly
  under jsdom without touching MapLibre/WebGL; wiring into
  `components/flight/name-site-dialog.tsx` as a new, always-present "Edit a boundary"
  entry point that opens the picker or the editor depending on how many editable rows
  the caller has for the current context.
- `scripts/admin-sites.ts`: `boundary-clear <siteId>`, `zone-boundary-clear <zoneId>`;
  `list` prints boundary presence, vertex count, area, and last-updated-by per row.
  `merge`/`zone-merge` gain a boundary guard: refuse (with a clear message) when the
  `from` row has a boundary and the `into` row doesn't, unless called with an explicit
  `--force`, in which case the boundary is carried across to the target rather than
  silently dropped. Clearing writes no `Flight` column — the operator path stays outside
  the cache-writer discipline entirely.
- `test/e2e/boundaries.spec.ts`: name a site → open the editor via the picker (no bound
  flight) → trace a boundary → save → upload a second IGC whose takeoff is **outside the
  600 m circle but inside the boundary** → it auto-names itself. Plus: attempt an
  anchor-excluding boundary and see the refusal; attempt a `merge` over a boundary-bearing
  source without `--force` and see it refused. Basemap tiles are stubbed/routed rather
  than depending on a live third-party CDN, to keep the test deterministic.
- `lib/whats-new.ts` entry (top, benefit-oriented, no internals), `FEATURES.md` moved to
  completed, `docs/architecture.md` gains a short "boundaries" paragraph under the
  site+zone seam, `docs/sprints/ledger.tsv` gets its row, `/qa-prompt` handed off.

## Files Summary

**New:** `lib/sites/boundary.ts` (+`boundary.test.ts`),
`components/flight/boundary-editor.tsx` (+ a pure editor-state module and its test),
`app/flights/[id]/boundary-action.ts`,
`prisma/migrations/20260822xxxxxx_site_zone_boundaries/`,
`test/e2e/boundaries.spec.ts`.

**Modified:** `prisma/schema.prisma` (six columns each on `Site` and `Zone`),
`lib/sites/geo.ts` (+`geo.test.ts`), `lib/sites/lookup.ts` (+`lookup.test.ts`),
`lib/sites/repo.ts`, `lib/sites/associate.ts`, `app/flights/[id]/site-action.ts`,
`components/flight/name-site-dialog.tsx`, `scripts/admin-sites.ts`
(+`admin-sites.test.ts`), `test/sites.integration.test.ts`, `lib/whats-new.ts`,
`FEATURES.md`, `docs/architecture.md`, `docs/sprints/ledger.tsv`.

**Unchanged on purpose — and each one is an assertion, not an omission:**
`prisma/schema.prisma`'s `Flight` model (no new column), `lib/flights/repo.ts` (the
read-path firewall has nothing new to guard), `lib/sites/visibility.ts` (a boundary is
not a privacy dimension), `lib/sites/display.ts` (a boundary has no label),
`lib/sites/write-audit.test.ts` (no new cache writer), `lib/sites/name.ts`,
`lib/ingest/ingest-flight.ts` (the seam absorbs it), `app/api/upload/route.ts`,
`app/api/ingest/route.ts`, `scripts/backfill-sites.ts`, `prisma/seed.ts`.

## Definition of Done

- [x] `Site` and `Zone` each carry `boundary Json?`, four derived `Float?` bbox columns,
      and `boundaryUpdatedById String?`; the `num_nulls(...) IN (0,5)` CHECK and the
      `WHERE boundary IS NOT NULL` partial index are raw SQL in the migration with the
      Prisma-v6-drift comment; the migration is purely additive and applies to existing
      rows with no reset.
- [x] `Flight` has **no** new column, and `lib/sites/write-audit.test.ts` passes
      unmodified.
- [x] The stored value is always the canonical envelope — `v: 1`, `kind: "polygon"`, one
      closed counter-clockwise ring, 6-decimal coordinates — regardless of what the
      client sent; asserted by round-tripping a clockwise, unclosed, over-precise input.
- [x] `boundaryContains` is **inclusive** on vertices and edges, with a metre-denominated
      0.5 m tolerance, unit-tested at the vertex, at an edge midpoint, and at 0.4 m /
      0.6 m off an edge; the ray-through-a-vertex case, the figure-eight case, and a
      concave-shape case are all covered. (The figure-eight case is attributed to
      `ringSelfIntersects`, not `boundaryContains` directly — a self-touching ring is
      rejected at validation time as a self-intersection, so `boundaryContains` never
      sees one in practice.)
- [x] A row **with** a boundary is matched by point-in-polygon **only** — a point inside
      the circle but outside a tighter boundary does **not** match, and a point outside
      the circle but inside a looser boundary **does**.
- [x] A row **without** a boundary matches exactly as SPRINT-005 shipped it, proven by
      `geo.test.ts` and `lookup.test.ts`'s existing circle-only assertions passing
      **unchanged** (the files themselves gain new boundary tests; the old assertions
      are untouched).
- [x] `findLocation` still issues exactly **two** application-level calls per endpoint
      (`siteCandidates`/`zoneCandidates`, `Promise.all`'d) — the boundary prefilter is an
      `OR` branch inside each existing `findMany`'s WHERE clause, not a separate query, proven
      by a seeded test asserting the boundary predicate and the circle predicate co-occur in
      the same single query per table. (Revised from the original "exactly two raw SQL
      statements" framing during implementation: Prisma's own relation-loading strategy
      issues an additional follow-up query to load a matched zone's joined site fields — a
      pre-existing SPRINT-005 behavior this sprint neither introduced nor changed.)
- [x] Every matched row (circle or boundary) carries a `distanceM` from `locationMatches`,
      and `compareSiteCandidates` ranks purely by that distance — no membership tier, so
      a boundary-bearing row and a circle-only row both in range are ordered by anchor
      distance alone, asserted for both orderings.
- [x] Zone-first precedence, the unconditional site fallback, and `canSeeZone`
      re-checking are unchanged; a zone boundary extending past its parent site's circle
      still yields "Site — Zone" with no new branch; a `kind: "both"` row's boundary
      governs both takeoff and landing matching, asserted for both endpoints.
- [x] `validateBoundary` rejects, each with its own typed error and its own test: <3 or
      >200 vertices, a non-finite or out-of-range coordinate, an antimeridian-crossing or
      >180°-span ring, a self-intersecting ring, a zero-length edge, area < 100 m², area >
      50 km² (site) / 20 km² (zone), and a boundary that excludes the row's own anchor
      post-normalization.
- [x] The same pure validator runs client-side (live feedback while drawing) and
      server-side (the authority); a request that bypasses the client is refused with the
      identical rule, asserted in an integration test.
- [x] A malformed stored boundary is skipped at match time with a structured log line —
      never thrown into ingest, never silently treated as a circle match — asserted
      directly by seeding a corrupt row.
- [x] A site boundary is editable by the site's owner only; a zone boundary by the
      zone's owner **or** the parent site's owner, via the existing `findZoneEditableBy`;
      every other caller gets an error indistinguishable from "not found" — asserted via
      **both** the bound-flight action path and the new picker/owned-row action path.
- [x] The owner-scoped picker (`listOwnedSitesForBoundaryEditing` /
      `listOwnedZonesForBoundaryEditing`) lists exactly the rows the caller owns or
      edit-controls (own sites, own zones, zones under sites they own) and nothing else,
      reachable with **no flight bound** to the target row.
- [x] A boundary edit is **never** refused because another pilot's flight references the
      row, and **never** un-binds any flight — the drawer's or anyone else's — asserted
      directly for a tightened boundary.
- [x] Widening a boundary re-associates the drawer's **own** previously-unmatched
      flights through `reassociateOwnFlights`, with the 200 cap and the mandatory
      truncation log intact; other pilots' flights are untouched. (The cap/truncation-log
      mechanics themselves are inherited, unmodified test coverage from SPRINT-005 —
      this sprint's own tests cover WHO triggers re-association and from which write
      path, not the cap logic a second time.)
- [x] `suggestNearbyLocations` and the in-transaction duplicate-name probe both offer/
      protect a site whose boundary contains the endpoint even when its anchor is
      outside the 2 km suggest radius.
- [x] **The full SPRINT-004/005 privacy matrix runs twice** — once with circle-only
      rows, once with the identical rows carrying boundaries — with identical assertions
      in both passes, and CI actually executes it.
- [x] Boundary JSON is never selected into a list, feed, profile, or flight-page query;
      only the two match queries, the picker/editor's own owner-gated reads, and the
      operator script — asserted directly for the flight-read path (which every list/
      feed/profile surface routes through via `lib/flights/repo.ts`), not independently
      re-asserted per surface.
- [x] The guard benchmark (1,000 × 200-vertex `boundaryContains` under 50 ms, generously
      bounded to avoid CI flakiness) runs in CI.
- [x] `SITE_BOUNDARY_MATCHING=off` reproduces pre-sprint circle-only matching on
      boundary-bearing rows with no data change, asserted directly.
- [x] The editor shows the anchor marker, the current circle, the parent's geometry when
      editing a zone, nearby visible sites'/zones' geometry for context, live
      area/vertex/validity feedback, undo, a confirmed clear, and remove-boundary; it
      adds **no** new npm dependency; its state machine is tested independently of the
      MapLibre rendering shell.
- [x] No site or zone id appears in any URL; the picker and editor live inside the
      existing dialog.
- [x] Boundary writes are capped at `DAILY_BOUNDARY_EDIT_CAP` per caller per day, with
      truncation logged the same way the site/zone creation cap is.
- [x] `scripts/admin-sites.ts` gains `boundary-clear` and `zone-boundary-clear` (which
      write no `Flight` column) and reports boundary facts in `list`; `merge`/
      `zone-merge` refuse to silently drop a source boundary onto a boundary-less target
      without `--force`, and carry it across when forced.
- [x] All five gates green; `/whats-new` entry added; `FEATURES.md` moved to Completed;
      `docs/architecture.md` and `docs/sprints/ledger.tsv` updated; `/qa-prompt` handed
      off (`docs/qa-prompts/QA-PROMPT-2026-08-21-boundaries.md`).
- [x] Deferred items **not** shipped: PostGIS, multi-polygon/holes, a separate
      radius-override column, auto-derived boundaries, full public boundary rendering,
      antimeridian boundaries, endpoint-specific boundaries on `kind: "both"` rows, a
      dedicated site/zone management page.

## Risks

- **Point-in-polygon correctness at the boundary (highest correctness risk).**
  Ray-casting is undefined exactly on an edge and flips on floating-point luck; a naive
  implementation also double-counts a ray passing through a vertex. *Mitigation:* the
  on-edge test runs first and short-circuits, with a metre-denominated tolerance; the
  ray-cast uses the half-open edge rule; both are unit-tested at the vertex, the edge,
  0.4/0.6 m off it, and the figure-eight case. The failure mode if it's still wrong is a
  flight matching the wrong nearby site — annoying, visible, fixable by the pilot; never
  a privacy failure, because a boundary is never consulted for *who may see* anything.
- **A large public zone boundary shadowing nearby sites — accepted by explicit
  decision.** With no zone-specific area cap tied to the old circle scale (interview
  decision 2), a pilot can draw a several-km² public zone polygon that, via the
  zone-first short-circuit, out-ranks every nearby circle-only site for every pilot's
  ingest — not just the drawer's own. *This was weighed and accepted, not overlooked:*
  the alternatives (a tight zone-specific cap, or a ranking tier that only sometimes
  helps) were both considered and declined during the interview in favor of simplicity
  and pilot agency. *Mitigations kept:* the (generous, but present) 20 km² zone area cap
  and 200-vertex cap still bound the worst case; the editor shows the current circle and
  nearby visible boundaries while drawing, so the scale of the change is visible before
  save; `boundary-clear` is a one-command operator fix with no data loss; every write is
  attributed (`boundaryUpdatedById`) and rate-limited. *Revisit if real usage shows this
  is a frequent nuisance rather than a rare mistake* — the same posture SPRINT-005 took
  on cross-site shadowing generally.
- **A pilot draws a boundary that's simply wrong, and it's shared.** A public site's
  boundary affects every pilot's matching, with no notification and no vote.
  *Mitigation and accepted bet:* it's strictly narrower than the power a site owner
  already has (they can rename, demote, or delete the whole site); the additive-only
  rule means the worst case is "some flights that used to match don't" — never
  "someone's existing flight silently changed"; `boundary-clear` restores circle
  matching in one operator command; the daily write cap and attribution column bound and
  trace the blast radius.
- **The anchor-containment rule creates real friction.** A site's anchor is the rounded
  takeoff coordinate of whichever flight named it first, which can be well off from the
  true launch. A pilot tracing the true launch tightly will be refused. *Mitigation:*
  the editor shows the anchor as a labelled marker from the moment it opens, and the
  error names the cause. *Accepted:* the rule is what keeps `distanceM` meaningful and
  `compareSiteCandidates` unchanged; the workaround (include the anchor, or draw the
  boundary on a zone instead) is a two-tap fix.
- **`jsonb` boundaries are the wrong index shape at some future scale.** Today the
  partial index restricts the scan to boundary-bearing rows but doesn't seek within
  them. *Mitigation:* the named upgrade path (core-Postgres `box` + GiST, no extension)
  requires no data migration — the bbox columns already hold what a `box` would — and
  the envelope's `v` field makes the stored format versioned.
- **Scope: several separable concerns in one sprint.** Storage, matching, an
  owner-scoped picker (new this synthesis, closing a real gap both independent drafts
  missed), and a hand-rolled drawing UI. *Mitigation:* the four-PR ordering makes each
  independently shippable and revertible, and PR1+PR2 are inert in production because
  nothing can create a boundary until PR3. The interview explicitly chose to keep this
  as one sprint rather than splitting the UI into a follow-up.
- **The drawing UI is hand-rolled.** ~250 lines of MapLibre event handling instead of a
  library. *Mitigation and accepted bet:* the feature surface needed (tap, drag, delete,
  undo, clear) is small and fixed; the alternatives carry MapLibre-compatibility risk
  and far more surface than a v1 needs. The editor's state machine is extracted into a
  pure module specifically so it's testable without WebGL — a gap that would otherwise
  leave PR4 under-tested by construction.
- **Touch-drawing a polygon on a phone is fiddly.** The editor is used on the same
  device the logbook is read on. *Mitigation:* generous vertex hit targets,
  undo-last-point as a first-class button, no minimum vertex pressure to save.
  *Accepted:* if it's too fiddly, pilots keep the circle — which works.
- **Rollback.** PR1 and PR2 are additive and inert. `SITE_BOUNDARY_MATCHING=off` reverts
  matching behavior in production with zero data change and zero redeploy risk if
  something goes wrong after boundaries exist. Reverting PR2 in code after boundaries
  exist makes boundary-bearing rows fall back to circle matching: existing bindings
  survive untouched, some future matches are less precise. Reverting PR3/PR4 leaves
  boundaries in the database, still honoured by PR2's matcher, just no longer editable
  in the app — with the operator script as the remedy. No revert at any point loses a
  site binding or a cached name.

## Security (privacy / authz)

- **Invariant 1 (unchanged, and the point of the sprint):** every SPRINT-004/005 privacy
  invariant is untouched. `canSeeSite`, `canSeeZone`, `siteVisibleWhere`,
  `zoneVisibleWhere`, `resolveLocationFields`, `resolveEndpoint`, `locationCachePatch`,
  and the eight `Flight` cache columns are all byte-for-byte unmodified. **A boundary is
  geometry, not identity.**
- **Invariant 2 (new, narrow):** `boundary`, its four bbox columns, and
  `boundaryUpdatedById` are written **only** by `boundaryColumns()`, called only from the
  four owner-gated mutators in `lib/sites/associate.ts` and the two operator commands.
  All five geometry columns move together or not at all, backed by a DB CHECK.
- **Invariant 3 (new, the picker's contract):** the two owner-scoped list functions
  (`listOwnedSitesForBoundaryEditing`, `listOwnedZonesForBoundaryEditing`) return rows
  the caller owns or edit-controls and **only** those rows; a boundary-edit action that
  accepts a client-supplied id (the new picker path) re-verifies ownership from scratch
  on every call — an id for a row outside that set fails exactly like a nonexistent id.
  This is the sprint's one deliberate departure from "never accept an id from the
  client," and it's scoped as narrowly as `findZoneEditableBy` already scopes the
  equivalent rename/delete power.
- **Verified, not assumed.** The claim "the read-path firewall is unaffected" is
  discharged by re-running the entire owner/friend/stranger/anonymous ×
  site-visibility × zone-visibility × flight-visibility matrix a second time with
  boundary-bearing rows and asserting **identical** results.
- **A boundary is only ever read where the row itself is already readable.** In
  matching, it rides along on candidate rows the existing visibility `OR` already
  scoped. In the picker/editor, it's fetched by owner-gated actions that return nothing
  for a row the caller can't edit. It is never serialized into a list, feed, profile, or
  public flight page.
- **Mutations gated by reads, same as every site/zone action:** authenticate → resolve
  the target (from the flight row for the bound-flight path; from a client-supplied id,
  re-verified, for the picker path) → owner-gate (site owner; or, for a zone,
  `findZoneEditableBy`'s zone-owner-or-parent-site-owner rule) → validate → write.
  Hidden, mis-parented, and nonexistent rows are indistinguishable in responses.
- **Untrusted input is geometry, and is treated like it.** The client sends an arbitrary
  JSON blob destined for a `jsonb` column. `validateBoundary` is a total function over
  `unknown` that reconstructs a canonical value from scratch — it never stores what it
  was given. Vertex count, coordinate range, area, self-intersection, and anchor
  containment are all enforced server-side; the caps bound both storage (~4 KB/row) and
  match-time CPU.
- **Malformed stored geometry is a data-integrity concern, not a privacy one.** It fails
  closed (the row is skipped from matching) — it never bypasses a visibility check,
  because visibility is decided before geometry is ever consulted.
- **Honest scope of the guarantee (unchanged from SPRINT-005, restated because a
  boundary invites the misreading):** a boundary is **not** a privacy feature. It does
  not obscure launch coordinates, and drawing one around your launch hides nothing — a
  viewer who can see the flight can always see where it started.
- **A public boundary is public, pilot-authored content**, like a public site name. It
  can encode something its author shouldn't have shared. Same posture, same remedy:
  attribution on the row (`boundaryUpdatedById`), structured logging on every write, and
  the operator `boundary-clear` command — not a new moderation mechanism.
- **Basemap tiles in the editor** reach a third-party style/tile host, including for a
  *private* site. Not new: `components/flight/track-map.tsx` already does this for every
  flight track.
- **Abuse:** signed-in, onboarded pilots only; edits confined to rows the caller already
  owns or edit-controls; no new row-creation vector, so `DAILY_CREATE_CAP` is
  deliberately not extended; a separate `DAILY_BOUNDARY_EDIT_CAP` plus the area/vertex
  caps bound this write path specifically.

## Dependencies

- **Internal:** PR2 ⟵ PR1; PR3 ⟵ PR2; PR4 ⟵ PR3. Strictly sequential — no boundary can
  exist in the app before the matcher that reads one is proven, and no boundary can be
  drawn before the write path that validates one exists.
- **External/stack: none new.** No npm packages (`maplibre-gl` is already a dependency;
  no turf, no `mapbox-gl-draw`, no `@turf/boolean-point-in-polygon`). No PostGIS, no
  Postgres extension, no change to the docker-compose image or CI's Postgres service.
  Prisma stays pinned at v6; NextAuth v5, Next 16, Railway unchanged.
- **Deliberately not adding a geometry library.** Turf would supply
  `booleanPointInPolygon` and `area` in one line each — but at real bundle cost for two
  functions, and its point-in-polygon is *exclusive* on the boundary in some versions,
  the exact semantic this sprint has to pin down and test. A small amount of tested,
  pure, documented geometry in `lib/sites/geo.ts` matches the module's existing
  hand-rolled `boundingBox`/`withinRadius` style.
- **Data:** production has a small pilot-created number of `Site`/`Zone` rows, all with
  null boundaries after the migration. No backfill, no compatibility shim, no reset.
- **Test data:** the existing ≥3-pilot fixtures, plus IGC fixtures positioned relative
  to a reference site: one **inside the circle and inside a tighter boundary**, one
  **inside the circle but outside that tighter boundary**, one **outside the circle but
  inside a looser boundary**, and one outside both. Dedupe is by exact bytes, so each
  must be a distinct file. Plus hand-built boundary fixtures: a concave "C", a
  self-intersecting bow-tie, a figure-eight, a 200-vertex circle approximation, and a
  clockwise ring for the winding test.

## Open Questions

Answered here as committed decisions (several via the stakeholder interview); revisit
only if the product changes.

1. **PostGIS `geometry`/`geography`, or plain `jsonb` + in-app math?** — **`jsonb`, plus
   four derived bbox `Float` columns and a partial index.** Prisma v6 has no spatial
   type, so a PostGIS match would be `$queryRaw` — moving `siteVisibleWhere`/
   `zoneVisibleWhere` and the `canSeeZone` push-down out of typed, composable
   `WhereInput` objects and into hand-written SQL, the exact seam the privacy model
   rests on. `CREATE EXTENSION postgis` also requires privileges a managed Railway
   Postgres may not grant. `jsonb` stays the canonical source of truth either way, so the
   upgrade path (core-Postgres `box` + GiST, still no extension) stays open with no data
   migration.
2. **Zone boundary size, and ranking for polygon matches — resolved by interview.**
   **No zone-specific area cap tied to the old circle scale; large zone boundaries are
   allowed, and the accepted risk (a large public zone can shadow nearby sites via the
   zone-first short-circuit) is documented in Risks rather than engineered away.** A
   ranking tier that would make polygon matches beat circle matches regardless of
   distance was proposed during cross-critique and explicitly **declined** — it would let
   a 3 km ridge boundary beat a genuinely nearer, unrelated site, which is a worse
   failure mode than the one it fixes. What *is* fixed, because it's a mechanical
   correctness gap rather than a scope question: every matched row — circle or boundary
   — gets a real `distanceM` (haversine to its own anchor) so ranking has something
   well-defined to sort by.
3. **Fold in per-site/per-zone radius configurability, or keep it separate?** — **Fold in
   the *model*, ship only the polygon.** The envelope's `kind` discriminant means a
   radius override lands in this same `boundary` column as
   `{ v: 1, kind: "circle", radiusM: 450 }`: no new column, no second migration, no
   parallel validator, no second operator command, no second editor entry point.
4. **A zone boundary extending outside its parent site's boundary/radius — allowed,
   warned, or rejected?** — **Allowed, and not validated.** SPRINT-005 already permits
   exactly this (a zone win returns its parent without consulting the parent's distance
   at all). The editor draws the parent's geometry underneath as **context**; it never
   enforces it.
5. **Where does the drawing UI live?** — **Inside the existing "name this site" dialog,
   reached via a new "Edit a boundary" entry point that does not require the current
   flight to already be bound to the target row (interview decision 5).** Opens an
   owner-scoped picker when there's more than one candidate row, or the editor directly
   when the context already resolves to exactly one. A `/sites/<id>/boundary` page would
   breach the standing "no site or zone id ever appears in a URL" policy and would
   require inventing a site page this sprint has no other reason to build.
6. **Boundary inclusivity — is a point exactly on the edge in or out?** — **In, matching
   `withinRadius`'s existing inclusive `<=`.** Implemented as an explicit on-edge test
   *before* the ray-cast, with a **0.5 m** tolerance expressed in metres. **Relatedly,
   the antimeridian: a boundary that crosses ±180° or spans >180° of longitude is
   refused at write time.** Supporting it needs an unwrapping convention with real
   subtle-bug risk (cross-critique found the naive "wrap on write, ray-cast on wrapped
   coordinates" approach genuinely broken — ray-casting near ±180° on wrapped
   coordinates, and a shoelace area computed the same way, both produce wrong answers)
   and has no pilot behind it. Refusing it is *graceful*: that site keeps circle
   matching, whose existing antimeridian handling in `boundingBox()` is untouched.
7. **What operator remedy is needed?** — **`boundary-clear <siteId>` and
   `zone-boundary-clear <zoneId>`, plus boundary facts in `list`, plus a boundary-aware
   guard on `merge`/`zone-merge`** (refuse to silently drop a source boundary onto a
   boundary-less target; `--force` carries it across instead). Clearing always succeeds,
   always restores circle matching, and never leaves a row unmatched.
8. **Caps on complexity or area, and enforced where?** — **Both, and enforced in both
   places with the server as the authority.** 3–200 vertices; area within
   [100 m², 50 km²] for a site and [100 m², 20 km²] for a zone (deliberately generous per
   interview decision 2 — see Q2 above); no self-intersection; must contain the row's
   own anchor, checked post-normalization. The client runs the **same pure validator**
   for live feedback while drawing; the server re-runs it and is the only authority.
9. **`kind: "both"` rows — one boundary, or endpoint-specific?** — **One shared boundary,
   by interview decision.** A `both` row's single boundary governs both takeoff and
   landing matching. Simpler model than a takeoff/landing pair, and consistent with how
   a pilot actually thinks about a site they use for both: one shape, the whole usable
   area.
10. **Off-radius editing — how does a pilot reach a row that isn't currently bound to any
    of their flights?** — **An owner-scoped picker inside the existing dialog (interview
    decision 5), listing the caller's own sites, own zones, and zones under sites they
    own.** This is the one place in the sprint where a site/zone id is accepted from the
    client; every read and write re-verifies ownership from scratch, and the id never
    reaches a URL. Closes the gap both independent drafts left in their designs — where
    the boundary editor could only be reached from a flight already bound to the target
    row, making the sprint's own headline "expand a ridge site" use case unreachable in
    practice.

**Genuinely still open** (not blocking, deliberately unanswered):

- Should a pilot be able to **adjust a site's anchor point** once a boundary exists (the
  centroid of the drawn shape is usually a better anchor than the first flight's
  takeoff fix)? It would remove the anchor-containment friction and improve distance
  ranking — but moving a shared row's coordinate changes matching for every other pilot,
  which needs its own design.
- Should a boundary be **rendered on the flight map** for viewers who can see the site,
  beyond the editor's own context view? Useful for "is this really the shape?" feedback,
  but it's a map-design question (which boundaries, what zoom, what colour, whose) with
  no matching value.
- If real usage shows the accepted zone-shadowing risk (Q2/Risks) is a frequent nuisance
  rather than a rare mistake, should a later sprint revisit either a tighter zone cap or
  a ranking tier? Deliberately not pre-designed now — it needs real collision data.
- Once boundaries exist, does the **manual zone-correction** idea (the other new
  FEATURES.md entry — unbind a mis-matched zone and pick a nearby one by hand) become
  less necessary, or more? A pilot who can draw the right shape may not need to correct
  individual flights — but a pilot who *has* drawn one and still sees a mis-match will
  want the manual override more, not less.
