# SPRINT-006 (draft) — Custom boundaries for sites and zones

> Independent draft. Intent:
> [`SPRINT-006-INTENT.md`](./SPRINT-006-INTENT.md). Extends
> [`../SPRINT-005.md`](../SPRINT-005.md) (Site + Zone) and
> [`../SPRINT-004.md`](../SPRINT-004.md) (the privacy machinery both reuse). The eight
> open questions in the intent are **answered here as committed decisions**, not
> restated — see [Open Questions](#open-questions).

## Overview

SPRINT-004 and SPRINT-005 built a gazetteer out of circles. Every `Site` matches inside
600 m (takeoff) / 900 m (landing) of one anchor point; every `Zone` inside 300 m / 400 m.
A circle is the right default — it needs one tap and zero geometry from the pilot — but it
is the wrong shape for most real flying sites. A ridge is 3 km long and 200 m wide: the
circle that covers the whole thing also swallows the LZ, the next site over, and a
motorway. A launch tucked in a bowl is 80 m across: the 300 m circle around it reaches
across the spine to a completely different launch.

This sprint lets a pilot **draw the actual shape** — a polygon traced on a map — and use it
instead of the circle for that one site or that one zone. Everything else stays exactly as
SPRINT-005 shipped it.

Four decisions anchor the sprint:

1. **A boundary is geometry, never identity.** It changes *which row matches a flight*, and
   nothing else. No new `Flight` column, no new cached value, no new visibility dimension,
   no change to `canSeeSite`/`canSeeZone`, no change to `locationCachePatch`, no change to
   `resolveLocationFields`. The read-path firewall isn't extended this sprint because it
   has nothing new to guard — and that is a property to **prove**, not assume (see
   [Security](#security-privacy--authz)).

2. **A boundary *replaces* the circle for the row that has one; a row without one is
   byte-identically unchanged.** Not a union, not a widening. This is what makes the
   feature useful in both directions: a polygon can be *tighter* than the circle (excluding
   the neighbouring launch the 300 m circle wrongly grabbed) as well as *looser* (covering
   the whole ridge). A union would only ever grow the match area and could never fix an
   over-matching site — which is the more common complaint.

3. **Storage is a versioned GeoJSON envelope in `jsonb`, with a derived bounding box in
   four indexed `Float` columns.** No PostGIS, no `Unsupported()` column, no raw-SQL match
   query. The bbox columns are what keep the DB prefilter index-assisted, so the matching
   query count stays at exactly **two round trips per endpoint** — the same as today — and
   the point-in-polygon test stays a pure function in `lib/sites/geo.ts` next to
   `withinRadius`, unit-tested with no database in sight. Full reasoning and the rejected
   alternatives are in [Q1](#open-questions).

4. **A boundary change is additive only: it never un-binds a flight that is already
   bound** — not the drawer's, and certainly not another pilot's. Drawing a *bigger*
   boundary upgrades the drawer's own unmatched flights (reusing SPRINT-005's
   `reassociateOwnFlights`, guard rails intact). Drawing a *tighter* one changes future
   matching only; already-bound flights keep their binding. This preserves SPRINT-005's
   load-bearing rule verbatim: **a change to the gazetteer only ever adds precision, it
   never removes a match a pilot already had.**

**Committed v1 scope**

1. `Site.boundary` and `Zone.boundary` (`jsonb`, nullable) holding a versioned envelope
   around a single-ring GeoJSON `Polygon`, plus four derived nullable `Float` bbox columns
   per table, a partial index on the boundary-bearing rows only, and raw-SQL CHECKs tying
   the bbox columns to the boundary's presence.
2. Pure geometry in `lib/sites/geo.ts` (inclusive point-in-polygon, ring area,
   self-intersection, derived bbox) and pure validation in a new `lib/sites/boundary.ts`
   (mirroring `lib/sites/name.ts`'s shape: validate → normalize → return a canonical
   value or a typed error).
3. Boundary-aware matching in `lib/sites/lookup.ts` — the existing circle-bbox prefilter
   `OR`ed with the boundary-bbox prefilter in the **same** query per level, then the
   per-row rule "boundary if present, else circle." Zone-first / site-fallback ordering and
   `compareSiteCandidates` are **untouched**.
4. Boundary-aware `reassociateOwnFlights` and `suggestNearbyLocations` (so the naming
   dialog can offer a site whose boundary you're standing in even when its anchor is 3 km
   away).
5. Owner-gated write path in `lib/sites/associate.ts` (`setSiteBoundary`,
   `setZoneBoundary`, `clearSiteBoundary`, `clearZoneBoundary`), server actions on the
   flight page, and a MapLibre tap-to-trace **drawing UI** as a third step of the existing
   "name this site" dialog — no new page, no site/zone id in any URL.
6. Operator remedy: `boundary-clear` / `zone-boundary-clear` in `scripts/admin-sites.ts`,
   plus boundary facts in `list`.

**Explicitly out of scope** (with reasons)

- **PostGIS, `geometry`/`geography` columns, `ST_Contains` matching.** See
  [Q1](#open-questions) — it buys nothing at this scale and costs the typed, composable
  visibility predicates the privacy model is built on.
- **Multi-polygon boundaries and holes.** One outer ring only. A site with two disjoint
  areas is two sites (or a site with two zones); a hole ("everything but the reservoir")
  has no pilot behind it. Rejecting them keeps the validator, the editor, and the
  point-in-polygon test each a third the size, and the envelope's `v` field is how we add
  them later without a migration.
- **A separate per-site/per-zone numeric radius override** (the adjacent FEATURES.md
  idea). Folded in *by design*, not shipped: the envelope's `kind` discriminant makes a
  radius override a **variant of this same column** rather than a parallel schema change.
  See [Q3](#open-questions).
- **Boundaries on anything but a pilot-owned `Site`/`Zone`.** No boundaries on flights, no
  airspace, no "restricted area" semantics. A boundary answers "is this flight from here,"
  full stop — it is not an airspace or a warning.
- **Any pilot editing any public site's boundary.** Boundary editing follows the existing
  ownership model exactly (SPRINT-004's no-moderation stance, plus SPRINT-005 decision 4's
  scoped site-owner override for zones). A wiki-style shared boundary is a moderation
  design, not a geometry one.
- **Auto-derived boundaries** (convex hull of bound flights, centroid drift). The
  self-correcting-gazetteer follow-up SPRINT-005 already parked; it needs real data first
  and it interacts badly with "never un-bind."
- **Boundary display on the flight map or anywhere outside the editor.** Rendering a
  site's shape on the public flight page is a nice map feature with its own design
  questions (which boundaries, at what zoom, in what colour, for which viewer) and zero
  matching value. Deferred whole.
- **Antimeridian-crossing boundaries.** Refused at write time, with a graceful fallback to
  circle matching. See [Q6](#open-questions).

## Use Cases

1. **The ridge that doesn't fit in a circle.** Mission Ridge is a 3 km spine. Its 600 m
   circle covers the middle third; flights from either end read "Unknown site." The owner
   opens a flight, taps the site name, chooses **Edit boundary**, traces the ridge in nine
   taps, and saves. Their own previously-unmatched flights from both ends re-label
   immediately, and every pilot's future flight from the whole ridge matches.
2. **The circle that grabs too much.** "South Bowl" and "North Launch" sit 250 m apart on
   opposite sides of a spine; the 300 m zone circles overlap, so half the North Launch
   flights come up as South Bowl. The owner draws a tight 12-point boundary around each.
   Future flights land on the right one. Already-bound flights keep their (possibly wrong)
   binding — fixing those is the pilot's existing per-flight remedy, not a silent
   retroactive rewrite.
3. **Drawing a boundary you don't need.** Most sites never get one. The affordance is one
   more entry in a dialog the pilot already opened for something else, and the site keeps
   matching by circle forever if they ignore it. Zero pilots are worse off.
4. **A zone whose boundary reaches past its parent's circle.** The LZ is 1.2 km down-valley
   from the site anchor — outside the site's 900 m landing circle, inside the drawn zone
   boundary. The flight matches the zone, and SPRINT-005's existing rule ("a zone win
   returns its parent regardless of the parent's own distance") hands back
   **"Mission Ridge — Lower LZ"** with no new code. This is a *consequence* of the
   SPRINT-005 design, not an exception carved into it.
5. **A boundary that doesn't contain the anchor.** A pilot traces the launch 400 m north of
   where the site's anchor point sits. Save is refused with "The boundary has to include
   the site's own location" — and the editor has been showing that location as a labelled
   marker the whole time, so the fix is obvious: include it, or draw the boundary on the
   zone instead.
6. **Somebody drew something absurd.** A pilot traces a 300 km polygon around half of
   California. Save is refused client-side as they draw (the area readout turns red) and
   again server-side. If a merely-annoying-but-legal boundary ships anyway, an operator
   runs `boundary-clear <siteId>` and the site is back to circle matching in one command —
   no moderation queue, no data loss.
7. **A boundary on somebody else's zone under your site.** The same scoped override
   SPRINT-005 decision 4 established for rename/delete: the parent site's owner may edit or
   clear a zone's boundary. They can already delete the whole zone; this is finer
   granularity of a power they hold, not a new one.
8. **The device-push path inherits it for free.** A Leaf pushes a flight from inside a
   drawn boundary. `ingestFlight` matches it two levels deep with no route change and no
   knowledge that a boundary exists — the ingestion seam absorbs this exactly as it
   absorbed zones.
9. **Rolling it back.** If PR2 is reverted after boundaries exist in production, every
   boundary-bearing row falls back to circle matching. Flights already bound stay bound
   (the `Flight` cache is untouched by this sprint); some future flights match less
   precisely. A degradation, not a break.

## Architecture

### Data model

```prisma
model Site {
  // ...unchanged, including lat/lon (still REQUIRED — the anchor never goes away)...

  /// SPRINT-006. Null = match by radius, exactly as SPRINT-004/005.
  /// Non-null = a BoundaryEnvelope (lib/sites/boundary.ts); the radius is
  /// then not consulted for this row at all.
  boundary        Json?
  /// Derived from `boundary` by boundaryColumns() and written ONLY with it.
  /// Present purely so the match query can prefilter on an index instead of
  /// deserializing every polygon in the table.
  boundaryMinLat  Float?
  boundaryMaxLat  Float?
  boundaryMinLon  Float?
  boundaryMaxLon  Float?

  // NOTE: the partial index over the four bbox columns is raw SQL in the
  // migration — Prisma v6 cannot express `WHERE boundary IS NOT NULL`.
}

model Zone {
  // ...unchanged... plus the identical five columns, same semantics.
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

The CHECK is the one invariant worth spending a constraint on: **all five columns are null
or none are.** Unlike SPRINT-005's rejected `zoneId ⇒ siteId` CHECK, this one is
single-table, involves no FK cascade, and can never be caught mid-transaction in a
legitimate state — every write goes through one function that produces all five together
or all five as null.

The partial index is deliberately a *set reducer*, not a spatial index: it restricts the
scan to boundary-bearing rows (expected to be a small minority for the foreseeable future)
and Postgres filters the remaining three range predicates. At the stated scale
([Performance](#performance-what-acceptable-and-realistic-mean)) that is a sub-millisecond
bitmap scan. **The named upgrade path, if it ever isn't:** a core-Postgres `box` column
with a GiST index and the `@>` operator — no extension needed. It's rejected for v1 only
because Prisma v6 would need `Unsupported("box")` and a `$queryRaw` match, which would move
the visibility predicates out of composable `Prisma.SiteWhereInput` and into hand-written
SQL. That is a privacy-relevant downgrade, and it buys nothing until there are ~10⁵
boundary rows.

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
  already in the database. A future sprint that raises the vertex cap or allows holes bumps
  `v` and branches, instead of reinterpreting old rows.
- **`kind`** — the discriminant that folds the adjacent per-site-radius idea into this same
  column instead of a parallel one. A radius override is a future
  `{ "v": 1, "kind": "circle", "radiusM": 450 }`; `boundaryContains()` gets one more branch
  and *nothing else in the system changes* — same column, same CHECK, same bbox columns,
  same validator seam, same operator `boundary-clear`, same editor entry point. See
  [Q3](#open-questions).
- **A literal GeoJSON geometry inside** — so a boundary round-trips through geojson.io,
  QGIS, or a future import/export with no bespoke format.

### Pure geometry (`lib/sites/geo.ts`)

New exports, all with the same no-DB/no-Next discipline as `withinRadius` and
`boundingBox`:

```ts
export const EDGE_TOLERANCE_M = 0.5;

/** True when (lat, lon) is strictly inside the ring. Ray-casting, half-open
 *  edge rule — deliberately NOT the authority on boundary points. */
function pointStrictlyInRing(ring: Ring, lat: number, lon: number): boolean;

/** True when (lat, lon) lies within EDGE_TOLERANCE_M of any edge segment. */
function pointOnRingEdge(ring: Ring, lat: number, lon: number): boolean;

/** The inclusive membership test — on the edge counts as inside. */
export function boundaryContains(boundary: Boundary, lat: number, lon: number): boolean;

export function boundaryBoundingBox(boundary: Boundary): { minLat; maxLat; minLon; maxLon };
export function ringAreaM2(ring: Ring): number;
export function ringSelfIntersects(ring: Ring): boolean;

/** THE composition point — the single place "boundary if present, else circle"
 *  is decided. findLocation, reassociateOwnFlights and suggestNearbyLocations
 *  all call this and nothing else. */
export function locationMatches(
  row: { lat: number; lon: number; boundary: unknown },
  lat: number,
  lon: number,
  radiusM: number,
): { matched: boolean; distanceM: number };
```

Four things pinned down explicitly, because each is a place a subtle bug lives:

- **Edges are straight lines in lon/lat space** — the GeoJSON default interpretation
  (RFC 7946 treats a ring as straight segments between positions). At a launch's scale
  (<10 km) the difference from a geodesic is centimetres, far below the ~11 cm the
  stored precision even represents. Not an approximation we're getting away with; the
  stated definition of what a boundary *is*.
- **Boundary points are inside** (`<=`, matching `withinRadius`'s existing inclusive
  comparison — [Q6](#open-questions)). Ray-casting alone is *undefined* on the boundary and
  will flip on floating-point luck, so `pointOnRingEdge` runs **first** and short-circuits
  to true, with a tolerance expressed in **metres** (0.5 m, an order of magnitude below GPS
  fix noise) rather than degrees, so the rule means the same thing at every latitude and is
  directly testable.
- **Area** is computed by projecting the ring equirectangularly about its own centroid
  (`x = R·Δlon·cos(lat₀)`, `y = R·Δlat`) and applying the shoelace formula — accurate to
  well under 0.1% at these extents, and pure. Not accurate enough to bill someone for; more
  than accurate enough to enforce a 50 km² cap.
- **Winding is normalized to counter-clockwise at write time.** `boundaryContains` is
  winding-agnostic (ray-casting doesn't care), so this is purely so stored data is valid
  RFC 7946 for export. Canonicalize once at the boundary of the system, never branch on it
  downstream.

### Validation (`lib/sites/boundary.ts`)

Pure, no DB/Next imports, shaped exactly like `lib/sites/name.ts` — a typed
`{ ok: true; boundary }` / `{ ok: false; error }` result, so the server action, the operator
script, and the client-side live preview all share one authority.

```ts
export const MIN_BOUNDARY_VERTICES = 3;
export const MAX_BOUNDARY_VERTICES = 200;
export const MIN_BOUNDARY_AREA_M2 = 100;            // a 10 m × 10 m box
export const MAX_SITE_BOUNDARY_AREA_M2 = 50_000_000; // 50 km²  (~44× the 600 m circle)
export const MAX_ZONE_BOUNDARY_AREA_M2 = 5_000_000;  //  5 km²  (~18× the 300 m circle)

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

The checks, in order (cheap first, and each one a named error the UI can phrase):

1. **Envelope shape and `v === 1`**; `kind === "polygon"`; `geometry.type === "Polygon"`;
   exactly one ring.
2. **Vertex count** 3–200 distinct (4–201 positions with the closing repeat). 200 bounds
   the worst-case ray-cast at 200 segment tests per candidate row and is ~7× the largest
   hand-traced ridge anyone has drawn in testing.
3. **Coordinate range** — finite, `lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`.
4. **Antimeridian** — the ring's lon span must be < 180° and must not straddle ±180°.
   Refused rather than half-supported; see [Q6](#open-questions).
5. **Degeneracy** — no zero-length edges (consecutive duplicates), positive area
   ≥ 100 m².
6. **Self-intersection** — every non-adjacent segment pair tested (O(n²), ≤ 19,900 pairs at
   the cap, ~0.2 ms). A bow-tie polygon has no well-defined interior; refusing it at write
   time is the only way the match-time answer is ever meaningful.
7. **Area cap** for the level.
8. **Contains the row's own anchor** (`boundaryContains(candidate, anchor)`). This is the
   invariant that keeps `distanceM` meaningful: the anchor stays the row's "where," so
   `compareSiteCandidates` needs no change and a boundary can never drag a row's notion of
   its own location somewhere else. An honest boundary always contains the anchor — the
   anchor was set from a real flight endpoint at that place.

Then **normalize**: close the ring, orient counter-clockwise, round to 6 decimals,
re-emit the canonical envelope. What's stored is always canonical, never whatever the
client sent.

### Matching — same two queries, one more prefilter branch

The SPRINT-005 structure (parallel zone and site passes, zone-first, site fallback always
runs, `compareSiteCandidates` ordering) is **structurally untouched**. Two things change
inside each pass.

**One, the DB prefilter becomes a union.** Today's box is around the *query point* and
tests the row's anchor — which works only because "point within R of anchor" and "anchor
within R of point" are the same statement. A polygon breaks that symmetry: a boundary can
reach far past its anchor, so the anchor may sit outside the point's box while the boundary
still contains the point. The fix is one `OR` in the same `findMany`:

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

Circle-only rows have NULL bbox columns, and `lte`/`gte` against NULL is never true, so the
second branch can only ever return boundary-bearing rows. **The query count does not
change** — still exactly two round trips per endpoint, still `Promise.all`'d, still with
`kind` and the visibility `OR` as ordinary typed Prisma predicates.

**Two, the exact filter becomes per-row.** `withinRadius` is replaced by
`locationMatches`, applied to each candidate:

| row has a boundary? | matched when                        | `distanceM` |
| ------------------- | ----------------------------------- | ----------- |
| no                  | `haversine(point, anchor) <= radius` | haversine to anchor |
| yes                 | `boundaryContains(boundary, point)` | haversine to anchor |

`distanceM` keeps meaning "how far from this place's anchor," for both shapes — which is
why **`compareSiteCandidates` needs no change at all**, and why `suggestNearbyLocations`'s
and SPRINT-005's tie-break semantics carry over verbatim.

**Ranking is deliberately NOT changed to prefer boundary matches.** The tempting rule ("a
drawn boundary is a stronger statement of intent than a default circle, so it should win")
breaks the more important one: a 3 km ridge boundary would then beat a *different*, plainly
nearer named site 50 m from the pilot's feet. Nearest-anchor-wins is the existing, tested
contract, and it degrades sensibly in both directions. The residual case — a large boundary
shadowing a nearer bare site — is the exact cross-site shadowing SPRINT-005 already named,
accepted, and tested; this sprint widens it slightly and re-tests it rather than inventing a
new precedence rule for it. See [Risks](#risks).

Two consequences worth stating because they fall out for free:

- **A zone boundary outside the parent site's circle just works.** SPRINT-005's zone win
  already returns the parent regardless of the parent's own distance ("the zone is the more
  precise fix by construction"). Use case 4 needs no new code and no exception.
- **`kind` filtering is untouched.** A `kind: "takeoff"` site with a boundary still only
  matches takeoff endpoints. A boundary answers *where*, never *what*.

### Suggestions and re-association

`suggestNearbyLocations` (the naming dialog's reuse-first sweep) gets the same `OR`'d
prefilter and the same per-row rule, so a site whose *boundary* you're standing in is
offered even when its anchor is 3 km outside the 2 km suggest radius. Its `distanceM` stays
anchor distance, so ordering is unchanged; a boundary-matched site simply appears in a list
it would otherwise have been missing from. Without this, the dialog and the matcher would
disagree about which sites exist near you — a coherence bug, not just a nicety.

`reassociateOwnFlights` gets boundary awareness on **both** ends:

- the bbox it scans for candidate flights is the boundary's bbox (not the radius box)
  when the anchor row has a boundary;
- the exact filter is `locationMatches`, not raw haversine.

Its existing guard rails are what make this safe and are **not** relaxed: creator's own
flights only, `status: 'ready'` only, the `[siteId] IS NULL OR (same site AND [zoneId] IS
NULL)` clause that makes it additive-only, the `REASSOCIATE_CAP` of 200, and the mandatory
log line when the cap truncates. Because that `where` clause can only ever *fill in* a null,
**tightening a boundary can never un-bind anything** — decision 4 is enforced by the shape
of the existing query, not by a new rule someone has to remember.

### The write path

Four functions in `lib/sites/associate.ts` — the module that already owns "authorized
mutations to `Site`/`Zone` rows and their consequences":

```ts
setSiteBoundary(siteId, ownerId, raw): Promise<Site>       // owner only
clearSiteBoundary(siteId, ownerId): Promise<Site>          // owner only
setZoneBoundary(zoneId, callerId, raw): Promise<Zone>      // findZoneEditableBy
clearZoneBoundary(zoneId, callerId): Promise<Zone>         // findZoneEditableBy
```

Each one: load the row (owner-gated — the zone pair reuses the **existing**
`findZoneEditableBy`, which already encodes "the zone's owner, or the parent site's owner"),
validate against that row's own anchor and level, write `boundary` and the four bbox columns
**together** via one `boundaryColumns()` helper, log structurally, return. Hidden and
nonexistent rows are indistinguishable in the error, same as everywhere else.

`boundaryColumns(boundary | null)` is the single writer of those five columns per table, in
the same spirit as `locationCachePatch` — and it is genuinely simple enough to be a pure
function, since it derives the bbox from the already-validated boundary.

Two guards deliberately **not** copied from rename/delete:

- **No "refused once another pilot's flight references it."** Rename and delete are guarded
  because they destroy something other pilots depend on. A boundary edit destroys nothing:
  existing bindings survive by construction (above), and the worst case is that a future
  flight matches differently — which is what a gazetteer edit *is*. Adding the guard would
  make the feature unusable at exactly the sites that need it most (the popular ones).
- **No daily cap.** `DAILY_CREATE_CAP` bounds *row creation* (the abuse vector is
  namespace pollution). A boundary edit creates no rows and is confined to rows the caller
  already owns; the area and vertex caps are the abuse bound here.

Server actions in `app/flights/[id]/site-action.ts`, following the exact
`nameSite`/`unpublishZoneForFlight` pattern: authenticate → re-derive the target row id
**from the flight row** (never from the client) for the given endpoint and level →
call the `associate.ts` function → `revalidateSiteSurfaces`. The client sends a boundary and
an endpoint; it never sends a site id, zone id, or coordinate.

### The drawing UI

A third step of the existing dialog, not a new page — `/sites/<id>` still doesn't exist and
this sprint doesn't create it, keeping the "no site or zone id ever appears in a URL" policy
closed ([Q5](#open-questions)).

`components/flight/boundary-editor.tsx` — a MapLibre map (the same `styleFor()` basemaps as
`track-map.tsx`, no new dependency, no deck.gl) with:

- the site's/zone's **anchor** as a labelled marker ("Site location — must be inside"), and
  the **current circle** drawn as a dashed reference ring so the pilot sees what they're
  replacing;
- the parent site's boundary or circle drawn faintly underneath when editing a zone —
  *context, not a constraint* (a zone boundary reaching past its parent is legal — see
  [Q4](#open-questions));
- tap to add a vertex, drag a vertex to move it, tap a vertex to remove it, **Undo last
  point**, **Clear**;
- a live readout — vertex count, area, and the first failing rule from
  `validateBoundary` — so an invalid shape is visible while drawing rather than on save;
- **Save**, **Remove boundary** (back to circle matching), **Cancel**.

Rendering is three MapLibre layers over one GeoJSON source (fill, line, vertex circles) —
the same primitives `track-map.tsx` already uses. Explicitly **no** `mapbox-gl-draw` or
`terra-draw`: the whole editor is ~250 lines of code we control, against a dependency whose
MapLibre compatibility is a moving target and whose feature surface is 20× what's needed.

The client imports `validateBoundary` from `lib/sites/boundary.ts` — the *same* pure module
the server action uses — so the two can't drift. The server remains the authority: the
client check is UX, and PR3's tests assert the server refuses a boundary the client would
have blocked.

### Performance — what "acceptable" and "realistic" mean

The intent asks for numbers instead of adjectives.

**Realistic**, the ceiling this design is planned against: 10,000 `Site` rows and 25,000
`Zone` rows globally; ≤10% of them boundary-bearing; ≤200 vertices each; ≤50 candidate rows
returned by both prefilter branches combined for any single endpoint. (For calibration:
production today has a low-double-digit number of sites, all pilot-created, and the whole
world has on the order of 15,000 known paragliding launches.)

**Acceptable**, the properties that must hold:

- `findLocation` stays at **exactly two DB round trips per endpoint** (unchanged from
  SPRINT-005) — the boundary branch is an `OR` inside the existing query, never a third
  query.
- The boundary prefilter is index-assisted: the partial index restricts the scan to
  boundary-bearing rows.
- App-layer geometry adds **< 2 ms per endpoint** at the ceiling above (50 candidates ×
  200 segments ≈ 10⁴ float operations).
- A unit **guard benchmark** — 1,000 `boundaryContains` calls against a 200-vertex ring
  complete in < 50 ms — asserted in CI. Not a wall-clock SLA (CI machines vary); a
  regression tripwire that fails loudly if someone makes the point-in-polygon test
  accidentally O(n²) or starts re-parsing JSON per call.
- Boundary JSON is `select`ed only in the two match queries and the editor's own read —
  never in a list query, never on a flight page, never in a feed. A 200-vertex ring is
  ~4 KB; it must not ride along on `LIST_SELECT`.

## Implementation

Four ordered PRs. Each ships its migration where needed and passes all five gates
(`pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm e2e`). The ordering is
itself a safety property, exactly as in SPRINT-004/005: **nothing in the app can create a
boundary until PR3, so PR1 and PR2 are inert in production by construction.**

### PR1 — Storage and pure geometry (no behaviour change anywhere)

- Migration `20260822xxxxxx_site_zone_boundaries`: five nullable columns on `Site` and on
  `Zone`, the two partial indexes, the two `num_nulls` CHECKs, with the standard
  "Prisma v6 can't express this; drift is expected; do not delete to fix drift" comment.
  Purely additive — every existing row keeps null boundaries and circle matching.
- `lib/sites/geo.ts`: `boundaryContains`, `pointOnRingEdge`, `pointStrictlyInRing`,
  `ringAreaM2`, `ringSelfIntersects`, `boundaryBoundingBox`, `locationMatches`,
  `EDGE_TOLERANCE_M`.
- `lib/sites/boundary.ts` (new): the envelope types, the caps, `validateBoundary`,
  `normalizeBoundary`, `boundaryColumns`. No DB, no Next.
- Unit tests (`geo.test.ts`, `boundary.test.ts`): a point clearly inside; clearly outside;
  **exactly on a vertex**; **exactly on an edge midpoint**; 0.4 m and 0.6 m off an edge
  (the tolerance boundary from both sides); a concave "C" shape with the query point in the
  concavity (the case a bbox or convex-hull test gets wrong); a ring whose bbox contains
  the point but whose interior doesn't; a ray that would pass exactly through a vertex (the
  classic ray-casting double-count bug); a boundary strictly *tighter* than the circle
  correctly excluding a point the circle accepts; a boundary strictly *looser* correctly
  accepting a point the circle rejects; each validator rejection with its own error code;
  area against three hand-computed reference polygons; winding normalization for a
  clockwise input; the ≤50 ms guard benchmark.
- `lib/sites/geo.test.ts`'s existing radius/antimeridian/`cosLat` coverage re-run unchanged
  — the circle path must be provably byte-identical.

### PR2 — Boundary-aware matching (still nothing can create a boundary)

- `lib/sites/lookup.ts`: the `OR`'d prefilter in both `siteCandidates` and `zoneCandidates`,
  `boundary` added to both `select`s, `withinRadius` → `locationMatches` in both passes.
  `compareSiteCandidates`, the zone-first precedence, the unconditional site fallback, and
  `canSeeZone` re-checking are all untouched — and their existing tests must pass
  unmodified, which is the regression check for "a site/zone with no boundary behaves
  exactly as before."
- `lib/sites/repo.ts`: the same prefilter in `suggestNearbyLocations`; boundary-aware
  anchor/bbox/filter in `reassociateOwnFlights`.
- Integration (`test/sites.integration.test.ts`): a point outside the circle but inside the
  boundary matches; inside the circle but outside a *tighter* boundary does **not** match; a
  zone boundary reaching past its parent's circle still yields "Site — Zone"; a
  boundary-bearing site and a circle-only site both in range rank by anchor distance
  (deterministically, both orders asserted); a private boundary-bearing site never matches a
  stranger's ingest; device push and web upload produce identical bindings.
- **The privacy matrix re-run, parameterized.** `test/sites.integration.test.ts`'s
  owner/friend/stranger/anonymous × (site visibility × zone visibility) × flight-visibility
  matrix is factored to run **twice**: once with circle-only rows (today's assertions,
  unchanged) and once with the identical rows carrying boundaries. Every assertion must be
  identical in both runs. This is the intent's "provably unaffected, confirmed not assumed"
  criterion, discharged concretely — and if a single cell differs, decision 1 is wrong and
  we find out here rather than in production.

### PR3 — The write path (the first PR that can create a boundary)

- `lib/sites/associate.ts`: `setSiteBoundary` / `clearSiteBoundary` /
  `setZoneBoundary` / `clearZoneBoundary`; `boundaryColumns` as the single writer of the
  five columns; structured logging on every set/clear.
- `app/flights/[id]/site-action.ts`: `saveBoundaryForFlight(flightId, endpoint, level, raw)`
  and `clearBoundaryForFlight(flightId, endpoint, level)`; row ids re-derived from the
  flight row; `getBoundaryForFlightEndpoint` for the editor's initial state (returns the
  boundary and the anchor for a row the caller may edit, and nothing otherwise).
- Re-association fires on a successful set, additively.
- Integration: a non-owner's save is refused and indistinguishable from "not found"; a
  zone's boundary is editable by the parent site's owner but not by an unrelated pilot; the
  server refuses every validator rejection independently of the client; a tightened
  boundary leaves already-bound flights (the drawer's **and** another pilot's) bound; a
  widened boundary upgrades only the drawer's own previously-unmatched flights; the
  `num_nulls` CHECK rejects a hand-written half-written row.
- `lib/sites/write-audit.test.ts` re-run unmodified — this sprint writes no `Flight` cache
  column outside `reassociateOwnFlights`'s existing `locationCachePatch` call, and the audit
  passing untouched is the evidence.

### PR4 — Drawing UI, operator remedy, release pass

- `components/flight/boundary-editor.tsx` and its wiring into
  `components/flight/name-site-dialog.tsx` as a third step reachable from the bound state,
  for the site and (when one is bound) the zone.
- `scripts/admin-sites.ts`: `boundary-clear <siteId>`, `zone-boundary-clear <zoneId>`;
  `list` prints boundary presence, vertex count, and area per row. Clearing writes no
  `Flight` column — a boundary is geometry, not identity — so the operator path stays
  outside the cache-writer discipline entirely.
- `test/e2e/boundaries.spec.ts`: name a site → open the editor → trace a boundary → save →
  upload a second IGC whose takeoff is **outside the 600 m circle but inside the boundary**
  → it auto-names itself. Plus: attempt an anchor-excluding boundary and see the refusal.
- `lib/whats-new.ts` entry (top, benefit-oriented, no internals), `FEATURES.md` moved to
  completed, `docs/architecture.md` gains a short "boundaries" paragraph under the site+zone
  seam, `/qa-prompt` handed off.

## Files Summary

**New:** `lib/sites/boundary.ts` (+`boundary.test.ts`),
`components/flight/boundary-editor.tsx`,
`prisma/migrations/20260822xxxxxx_site_zone_boundaries/`,
`test/e2e/boundaries.spec.ts`.

**Modified:** `prisma/schema.prisma` (five columns each on `Site` and `Zone`),
`lib/sites/geo.ts` (+`geo.test.ts`), `lib/sites/lookup.ts` (+`lookup.test.ts`),
`lib/sites/repo.ts`, `lib/sites/associate.ts`, `app/flights/[id]/site-action.ts`,
`components/flight/name-site-dialog.tsx`, `scripts/admin-sites.ts`,
`test/sites.integration.test.ts`, `lib/whats-new.ts`, `FEATURES.md`,
`docs/architecture.md`.

**Unchanged on purpose — and each one is an assertion, not an omission:**
`prisma/schema.prisma`'s `Flight` model (no new column), `lib/flights/repo.ts` (the
read-path firewall has nothing new to guard), `lib/sites/visibility.ts` (a boundary is not a
privacy dimension), `lib/sites/display.ts` (a boundary has no label),
`lib/sites/write-audit.test.ts` (no new cache writer), `lib/sites/name.ts`,
`lib/ingest/ingest-flight.ts` (the seam absorbs it), `app/api/upload/route.ts`,
`app/api/ingest/route.ts`, `scripts/backfill-sites.ts`, `statsFrom`, `prisma/seed.ts`.

## Definition of Done

- [ ] `Site` and `Zone` each carry `boundary Json?` plus four derived `Float?` bbox columns;
      the `num_nulls(...) IN (0,5)` CHECK and the `WHERE boundary IS NOT NULL` partial index
      are raw SQL in the migration with the Prisma-v6-drift comment; the migration is purely
      additive and applies to existing rows with no reset.
- [ ] `Flight` has **no** new column, and `lib/sites/write-audit.test.ts` passes unmodified.
- [ ] The stored value is always the canonical envelope — `v: 1`, `kind: "polygon"`, one
      closed counter-clockwise ring, 6-decimal coordinates — regardless of what the client
      sent; asserted by round-tripping a clockwise, unclosed, over-precise input.
- [ ] `boundaryContains` is **inclusive** on vertices and edges, with a metre-denominated
      0.5 m tolerance, unit-tested at the vertex, at an edge midpoint, and at 0.4 m / 0.6 m
      off an edge; the ray-through-a-vertex case and a concave-shape case are both covered.
- [ ] A row **with** a boundary is matched by point-in-polygon **only** — a point inside the
      circle but outside a tighter boundary does **not** match, and a point outside the
      circle but inside a looser boundary **does**.
- [ ] A row **without** a boundary matches exactly as SPRINT-005 shipped it, proven by
      `geo.test.ts` and `lookup.test.ts` passing **unmodified**.
- [ ] `findLocation` still issues exactly **two** queries per endpoint; the boundary
      prefilter is an `OR` branch inside the existing `findMany`, not a third query.
- [ ] Zone-first precedence, the unconditional site fallback, `compareSiteCandidates`, and
      `canSeeZone` re-checking are unchanged; a zone boundary extending past its parent
      site's circle still yields "Site — Zone" with no new branch.
- [ ] `validateBoundary` rejects, each with its own typed error and its own test: <3 or >200
      vertices, a non-finite or out-of-range coordinate, an antimeridian-crossing or
      >180°-span ring, a self-intersecting ring, a zero-length edge, area < 100 m², area >
      50 km² (site) / 5 km² (zone), and a boundary that excludes the row's own anchor.
- [ ] The same pure validator runs client-side (live feedback while drawing) and
      server-side (the authority); a request that bypasses the client is refused with the
      identical rule, asserted in an integration test.
- [ ] A site boundary is editable by the site's owner only; a zone boundary by the zone's
      owner **or** the parent site's owner, via the existing `findZoneEditableBy`; every
      other caller gets an error indistinguishable from "not found."
- [ ] A boundary edit is **never** refused because another pilot's flight references the
      row, and **never** un-binds any flight — the drawer's or anyone else's — asserted
      directly for a tightened boundary.
- [ ] Widening a boundary re-associates the drawer's **own** previously-unmatched flights
      through `reassociateOwnFlights`, with the 200 cap and the mandatory truncation log
      intact; other pilots' flights are untouched.
- [ ] `suggestNearbyLocations` offers a site whose boundary contains the endpoint even when
      its anchor is outside the 2 km suggest radius, so the dialog and the matcher never
      disagree about what's nearby.
- [ ] **The full SPRINT-004/005 privacy matrix runs twice** — once with circle-only rows,
      once with the identical rows carrying boundaries — with identical assertions in both
      passes, and CI actually executes it (throws, does not skip).
- [ ] Boundary JSON is never selected into a list, feed, profile, or flight-page query;
      only the two match queries and the editor's own owner-gated read.
- [ ] The guard benchmark (1,000 × 200-vertex `boundaryContains` under 50 ms) runs in CI.
- [ ] The editor shows the anchor marker, the current circle, the parent's geometry when
      editing a zone, live area/vertex/validity feedback, undo, clear, and remove-boundary;
      it adds **no** new npm dependency.
- [ ] No site or zone id appears in any URL; the editor lives inside the existing dialog.
- [ ] `scripts/admin-sites.ts` gains `boundary-clear` and `zone-boundary-clear` (which write
      no `Flight` column) and reports boundary facts in `list`.
- [ ] All five gates green; `/whats-new` entry added; `FEATURES.md` and
      `docs/architecture.md` updated; `/qa-prompt` handed off.
- [ ] Deferred items **not** shipped: PostGIS, multi-polygon/holes, a separate radius-override
      column, auto-derived boundaries, boundary rendering outside the editor, antimeridian
      boundaries, cross-pilot boundary editing.

## Risks

- **Point-in-polygon correctness at the boundary (highest correctness risk).** Ray-casting
  is undefined exactly on an edge and flips on floating-point luck; a naive implementation
  also double-counts a ray passing through a vertex. *Mitigation:* the on-edge test runs
  first and short-circuits, with a metre-denominated tolerance; the ray-cast uses the
  half-open edge rule so a vertex is counted once; both are unit-tested at the vertex, the
  edge, and 0.4/0.6 m off it. The failure mode if it's still wrong is a flight matching the
  wrong nearby site — annoying, visible, and fixable by the pilot; never a privacy failure,
  because a boundary is never consulted for *who may see* anything.
- **A larger boundary shadowing a nearer named site.** A 3 km ridge boundary can win over a
  bare site 50 m from the pilot, because ranking is by anchor distance and the ridge's
  anchor may be nearer than the neighbour's. *Accepted, and deliberately not "fixed" with a
  boundary-first precedence rule* — that rule breaks the far more common case (see
  Architecture § Matching). This is the same cross-site shadowing SPRINT-005 named and
  accepted; this sprint widens it, re-tests it explicitly, and leaves the remedy where
  SPRINT-005 left it (deterministic ordering, operator merge, and a documented follow-up if
  real usage says it's a nuisance rather than an edge case).
- **A pilot draws a boundary that's simply wrong, and it's shared.** A public site's
  boundary affects every pilot's matching, with no notification and no vote. *Mitigation and
  accepted bet:* it's strictly narrower than the power a site owner already has (they can
  rename, demote, or delete the whole site); the additive-only rule means the worst case is
  "some flights that used to match don't" — never "someone's existing flight silently
  changed"; and `boundary-clear` restores circle matching in one operator command. The area
  and vertex caps bound the blast radius.
- **The anchor-containment rule creates real friction.** A site's anchor is the rounded
  takeoff coordinate of whichever flight named it first, which can be 200 m from the true
  launch. A pilot tracing the true launch tightly will be refused. *Mitigation:* the editor
  shows the anchor as a labelled marker from the moment it opens, and the error names the
  cause. *Accepted:* the rule is what keeps `distanceM` meaningful and
  `compareSiteCandidates` unchanged, and the workaround (include the anchor, or draw the
  boundary on a zone instead) is a two-tap fix. Revisit with an "adjust the anchor" affordance
  if it bites in practice.
- **`jsonb` boundaries are the wrong index shape at some future scale.** Today the partial
  index is a set reducer, not a spatial index. *Mitigation:* the named upgrade path
  (core-Postgres `box` + GiST, no extension) requires no data migration — the bbox columns
  already hold exactly what a `box` would — and the envelope's `v` field makes the stored
  format versioned. The decision is deliberately reversible; PostGIS is not.
- **Scope: three separable concerns in one sprint (storage, matching, drawing UI).**
  *Mitigation:* the four-PR ordering makes each independently shippable and revertible, and
  PR1+PR2 are inert in production because nothing can create a boundary until PR3. If PR4
  slips, PR1–PR3 are still coherent (boundaries settable by operators, matched correctly) —
  they just aren't worth a `/whats-new` entry yet, and shouldn't get one.
- **The drawing UI is hand-rolled.** ~250 lines of MapLibre event handling instead of a
  library. *Mitigation and accepted bet:* the feature surface needed (tap, drag, delete,
  undo, clear) is small and fixed; the alternatives (`mapbox-gl-draw`, `terra-draw`) carry
  MapLibre-compatibility risk and 20× the surface for a v1 that doesn't need holes,
  multi-polygons, or snapping. Revisit if v2 wants those.
- **Touch-drawing a polygon on a phone is fiddly.** The editor is used on the same device
  the logbook is read on. *Mitigation:* generous vertex hit targets, undo-last-point as a
  first-class button, no minimum vertex pressure to save (draw four points and stop). *Accepted:*
  if it's too fiddly, pilots keep the circle — which works — and we learn that from usage.
- **Rollback.** PR1 and PR2 are additive and inert. Reverting PR2 after boundaries exist
  makes boundary-bearing rows fall back to circle matching: existing bindings survive
  untouched (no `Flight` column changed all sprint), some future matches are less precise.
  Reverting PR3/PR4 leaves boundaries in the database, still honoured by PR2's matcher, just
  no longer editable in the app — with the operator script as the remedy. No revert at any
  point loses a site binding or a cached name.

## Security (privacy / authz)

- **Invariant 1 (unchanged, and the point of the sprint):** every SPRINT-004/005 privacy
  invariant is untouched. `canSeeSite`, `canSeeZone`, `siteVisibleWhere`, `zoneVisibleWhere`,
  `resolveLocationFields`, `resolveEndpoint`, `locationCachePatch`, and the eight `Flight`
  cache columns are all byte-for-byte unmodified. **A boundary is geometry, not identity.**
- **Invariant 2 (new, narrow):** `boundary` and its four bbox columns are written **only**
  by `boundaryColumns()`, called only from the four owner-gated functions in
  `lib/sites/associate.ts` and the two operator commands. All five columns move together or
  not at all, backed by a DB CHECK.
- **Verified, not assumed.** The claim "the read-path firewall is unaffected" is discharged
  by re-running the entire owner/friend/stranger/anonymous × site-visibility ×
  zone-visibility × flight-visibility matrix a second time with boundary-bearing rows and
  asserting **identical** results. If any cell differs, the sprint's first decision is
  wrong.
- **A boundary is only ever read where the row itself is already readable.** In matching, it
  rides along on candidate rows the existing visibility `OR` already scoped. In the editor,
  it's fetched by an owner-gated action that returns nothing for a row the caller can't
  edit. It is never serialized into a list, feed, profile, or public flight page.
- **Mutations gated by reads, same as every site/zone action:** authenticate → resolve the
  target from the *flight row* for the given endpoint and level (never from a client-supplied
  id) → owner-gate (site owner; or, for a zone, `findZoneEditableBy`'s zone-owner-or-parent-
  site-owner rule) → validate → write. Hidden, mis-parented, and nonexistent rows are
  indistinguishable in responses.
- **Untrusted input is geometry, and is treated like it.** The client sends an arbitrary
  JSON blob destined for a `jsonb` column. `validateBoundary` is a total function over
  `unknown` that reconstructs a canonical value from scratch — it never stores what it was
  given. Vertex count, coordinate range, area, self-intersection, and anchor containment are
  all enforced server-side; the caps bound both storage (~4 KB/row) and match-time CPU.
  This is the same posture `lib/sites/name.ts` takes on untrusted text.
- **Honest scope of the guarantee (unchanged from SPRINT-005, restated because a boundary
  invites the misreading):** a boundary is **not** a privacy feature. It does not obscure
  launch coordinates, and drawing one around your launch hides nothing — a viewer who can
  see the flight can always see where it started. Launch-coordinate obfuscation remains the
  deferred item it has been since SPRINT-001.
- **A public boundary is public, pilot-authored content**, like a public site name. It can
  encode something its author shouldn't have shared (tracing a private landowner's field,
  say). Same posture, same remedy: attribution on the row, structured logging on every
  write, and the operator `boundary-clear` command — not a new moderation mechanism.
- **Basemap tiles in the editor** reach a third-party style/tile host (OpenFreeMap or
  MapTiler) centred on the site's coordinates, including for a *private* site. Not new:
  `components/flight/track-map.tsx` already does exactly this for every flight track. Noted
  so it isn't rediscovered as a finding; unchanged in posture.
- **Abuse:** signed-in, onboarded pilots only; edits confined to rows the caller already
  owns; no new row-creation vector, so `DAILY_CREATE_CAP` is deliberately not extended; area
  and vertex caps are the bound.

## Dependencies

- **Internal:** PR2 ⟵ PR1; PR3 ⟵ PR2; PR4 ⟵ PR3. Strictly sequential, and the ordering is
  a safety property: no boundary can exist in the app before the matcher that reads one is
  proven, and no boundary can be drawn before the write path that validates one exists.
- **External/stack: none new.** No npm packages (`maplibre-gl` is already a dependency; no
  turf, no `mapbox-gl-draw`, no `@turf/boolean-point-in-polygon`). No PostGIS, no Postgres
  extension, no change to the docker-compose image or CI's Postgres service. Prisma stays
  pinned at v6; NextAuth v5, Next 16, Railway unchanged.
- **Deliberately not adding a geometry library.** Turf would supply
  `booleanPointInPolygon` and `area` in one line each — but it would also bring ~40 kB into
  a bundle for two functions, and its point-in-polygon is *exclusive* on the boundary in
  some versions, which is the exact semantic this sprint has to pin down and test. Sixty
  lines of tested, pure, documented geometry in `lib/sites/geo.ts` is the smaller
  long-term liability, and it matches the module's existing hand-rolled `boundingBox`/
  `withinRadius` style.
- **Data:** production has a small pilot-created number of `Site`/`Zone` rows, all with null
  boundaries after the migration. No backfill, no compatibility shim, no reset — local dev
  and production both migrate forward in place.
- **Test data:** the existing ≥3-pilot fixtures, plus IGC fixtures positioned relative to a
  reference site: one **inside the circle and inside a tighter boundary**, one **inside the
  circle but outside that tighter boundary**, one **outside the circle but inside a looser
  boundary**, and one outside both. Dedupe is by exact bytes, so each must be a distinct
  file. Plus hand-built boundary fixtures: a concave "C", a self-intersecting bow-tie, a
  200-vertex circle approximation, and a clockwise ring for the winding test.

## Open Questions

Answered here as committed decisions; revisit only if the product changes.

1. **PostGIS `geometry`/`geography`, or plain `jsonb` + in-app math?** — **`jsonb`, plus
   four derived bbox `Float` columns and a partial index.** Four reasons, in order of
   weight. (a) *Privacy composability:* Prisma v6 has no spatial type, so a PostGIS match
   would be `$queryRaw` — which moves `siteVisibleWhere`/`zoneVisibleWhere` and the
   `canSeeZone` push-down out of typed, composable `WhereInput` objects and into
   hand-written SQL. That is the exact seam the whole privacy model rests on; trading it for
   an index we don't need yet is a bad deal. (b) *Infra:* `CREATE EXTENSION postgis`
   requires privileges a managed Railway Postgres may not grant, and would force the
   docker-compose image and CI's Postgres service to change in lockstep — a hard dependency
   added for a table with tens of rows. (c) *Convention:* point-in-polygon in
   `lib/sites/geo.ts` is pure, unit-testable, and reviewable, which is what CLAUDE.md asks
   for; `ST_Contains` is testable only with a database. (d) *Reversibility:* `jsonb` is the
   canonical source of truth under either design, and the bbox columns already hold what a
   `box`/GiST index would need — so the upgrade path (core-Postgres `box` + GiST, still no
   extension) stays open with no data migration. What PostGIS would genuinely buy —
   `ST_DWithin` nearest-neighbour ordering, real spatial joins, geodesic area — has no
   consumer in this sprint.
2. **Does a boundary replace the radius prefilter, or layer on top of it?** — **Both, at
   different layers, and the distinction matters.** At the **DB prefilter** layer the two
   coexist as an `OR` in one query: the circle box (unchanged) union the boundary's own
   bbox, so a boundary reaching past its anchor is still found and the query count stays at
   two per endpoint. At the **exact match** layer the boundary fully *replaces* the radius
   for a row that has one — `boundaryContains` alone decides, and the radius is not
   consulted. A union at the exact layer was rejected outright: it would make a boundary
   able only to *widen* a match, so it could never fix the over-matching circle, which is
   half the feature.
3. **Fold in per-site/per-zone radius configurability, or keep it separate?** — **Fold in
   the *model*, ship only the polygon.** The envelope's `kind` discriminant means a radius
   override lands in this same `boundary` column as
   `{ v: 1, kind: "circle", radiusM: 450 }`: no new column, no second migration, no parallel
   validator, no second operator command, no second editor entry point — one more branch in
   `boundaryContains` and one more editor control. That's exactly what the intent asked for
   ("so the two features don't make parallel, redundant schema changes later") without
   doubling this sprint's DoD. Shipping both now would also mean designing a precedence rule
   for a row carrying both, which the discriminant makes structurally impossible.
4. **A zone boundary extending outside its parent site's boundary/radius — allowed, warned,
   or rejected?** — **Allowed, and not validated.** SPRINT-005 already permits exactly this
   (a zone win returns its parent without consulting the parent's distance at all), so
   requiring containment would be a *new* restriction the current model doesn't have. It
   would also be a cross-row rule with the same lifecycle problem SPRINT-005 rejected a
   cross-table CHECK for: a site owner editing the parent's boundary could retroactively
   invalidate a zone owned by a different pilot. The editor draws the parent's geometry
   underneath as **context**; it never enforces it.
5. **Where does the drawing UI live?** — **Inside the existing "name this site" dialog, as a
   third step reached from the bound state.** A `/sites/<id>/boundary` page would breach the
   standing "no site or zone id ever appears in a URL" policy that SPRINT-004 set and
   SPRINT-005 kept, and would require inventing a site page this sprint has no other reason
   to build. The dialog already resolves ownership (`getBoundLocationInfo`), already hosts
   the undo affordances, and is already reached by tapping the thing you want to edit.
   Deliberately **not** inside the *create* step: naming and tracing at once is too much for
   one flow, and the anchor a boundary must contain doesn't exist until the row does.
6. **Boundary inclusivity — is a point exactly on the edge in or out?** — **In, matching
   `withinRadius`'s existing inclusive `<=`.** Two rules must not disagree about the same
   pilot standing on the same line. Implemented as an explicit on-edge test *before* the
   ray-cast (which is undefined on the boundary), with a **0.5 m** tolerance expressed in
   metres — an order of magnitude below GPS fix noise, so it is invisible in practice, but
   deterministic and directly testable, unlike a float-luck answer. **Relatedly, the
   antimeridian: a boundary that crosses ±180° or spans >180° of longitude is refused at
   write time.** Supporting it needs an unwrapping convention with real subtle-bug risk and
   has no pilot behind it (a launch boundary is metres to kilometres wide), and refusing it
   is *graceful*: that site keeps circle matching, whose existing antimeridian handling in
   `boundingBox()` is untouched by this sprint. Known limitation, documented, zero dead ends.
7. **What operator remedy is needed?** — **`boundary-clear <siteId>` and
   `zone-boundary-clear <zoneId>`, plus boundary facts in `list`.** Clearing always
   succeeds, always restores circle matching, and never leaves a row unmatched — the
   safe-by-construction remedy. It writes **no** `Flight` column (a boundary carries no
   name), so unlike `rename`/`force-private` it stays entirely outside the cache-writer
   discipline. No new moderation mechanism, exactly as the intent asked.
8. **Caps on complexity or area, and enforced where?** — **Both, and enforced in both
   places with the server as the authority.** 3–200 vertices; area within
   [100 m², 50 km²] for a site and [100 m², 5 km²] for a zone; no self-intersection; must
   contain the row's own anchor. For calibration the current circles are 1.13 km² (600 m
   site) and 0.28 km² (300 m zone), so the caps are ~44× and ~18× the defaults — generous
   for any real ridge, a hard ceiling on absurdity. The client runs the **same pure
   validator** for live feedback while drawing; the server re-runs it and is the only
   authority, asserted by a test that submits a client-invalid boundary directly.

**Genuinely still open** (not blocking, deliberately unanswered):

- Should a pilot be able to **adjust a site's anchor point** once a boundary exists (the
  centroid of the drawn shape is usually a better anchor than the first flight's takeoff
  fix)? It would remove the anchor-containment friction and improve distance ranking — but
  moving a shared row's coordinate changes matching for every other pilot, which needs its
  own design.
- Should a boundary be **rendered on the flight map** for viewers who can see the site?
  Useful for "is this really the shape?" feedback, but it's a map-design question (which
  boundaries, what zoom, what colour, whose) with no matching value.
- Should the cross-site shadowing case (Risks) eventually get a tie-break that prefers a
  *boundary* match over a *circle* match when the two are within some distance ratio of each
  other? Deliberately not guessed at now — it needs real collision data, which is the same
  answer SPRINT-005 gave to per-zone radii.
- Once boundaries exist, does the **manual zone-correction** idea (the other new
  FEATURES.md entry — unbind a mis-matched zone and pick a nearby one by hand) become less
  necessary, or more? A pilot who can draw the right shape may not need to correct
  individual flights — but a pilot who *has* drawn one and still sees a mis-match will want
  the manual override more, not less.
