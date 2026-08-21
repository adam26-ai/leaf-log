# Sprint 006 Intent: Custom GeoJSON Polygon Boundaries for Sites and Zones

## Seed

Let a pilot draw a custom polygon boundary for a `Site` or `Zone` — e.g.
tracing the actual bowl/ridge shape of a launch — instead of relying on a
circle centered on one point. Matching a flight endpoint becomes a
point-in-polygon test against the drawn boundary, falling back to the
existing radius-circle behavior for any site/zone that hasn't defined one.
This must be additive/optional, not a breaking replacement — most existing
sites/zones will have no polygon for the foreseeable future.

## Context

- SPRINT-005 (PRs #41-44, merged and deployed 2026-08-20) shipped the
  two-level `Site` → `Zone` hierarchy. Matching is zone-first at a tighter
  radius, with a site-level fallback pass that always runs (a locked-in "no
  dead ends" decision) — `lib/sites/lookup.ts`'s `findLocation`.
- Matching today is entirely circle-based: `lib/sites/geo.ts` exports four
  constants — `TAKEOFF_RADIUS_M` (600), `LANDING_RADIUS_M` (900),
  `ZONE_TAKEOFF_RADIUS_M` (300), `ZONE_LANDING_RADIUS_M` (400) — applied
  identically to every `Site`/`Zone` row via `radiusForKind`/
  `zoneRadiusForKind`. There is no per-row radius override in the schema.
- `boundingBox()` in `lib/sites/geo.ts` computes a lat/lon box (with
  antimeridian handling) used as a cheap DB-indexed prefilter; `withinRadius()`
  then does exact haversine distance filtering; `compareSiteCandidates()`
  provides deterministic tie-breaking (nearest, curated-before-user, id).
  None of this has any DB or Next.js import — pure, unit-tested functions.
- Privacy is entirely app-layer (no RLS). Every flight read goes through the
  viewer-scoped repo `lib/flights/repo.ts` (`resolveLocationFields`,
  `resolveEndpoint`), which re-verifies `canSeeSite`/`canSeeZone` per viewer
  on every read — a site/zone's cached name on `Flight` is never trusted
  blindly. `lib/sites/visibility.ts`'s `canSeeZone` is a conjunction:
  `canSeeSite(site) AND canSeeSite(zone)`.
- Sites/zones are pilot-created and owned (`ownerId`, `visibility`
  private/public, `normalizedName` for dedup). The "name this site" flow
  (`components/flight/name-site-dialog.tsx`, `app/flights/[id]/site-action.ts`)
  is a two-step dialog: site step, then an optional "Which spot?" zone step
  with a Skip action. Naming/creation writes go through
  `lib/sites/associate.ts` (the sole writer of denormalized `Flight`
  `*Site*`/`*Zone*` cache columns) and `lib/sites/repo.ts`
  (`createOrAttachSiteFromFlight`, `suggestNearbyLocations`).
- No PostGIS extension exists in `prisma/schema.prisma` today. Prisma is
  pinned to v6 (v7 needs a driver adapter for the `url` datasource field —
  incompatible with the project's current setup) and has no first-class
  spatial/geometry column type; a PostGIS column would need raw SQL in
  migrations, the same pattern already used for `Zone`'s CHECK constraints
  and partial unique index (`prisma/migrations/20260820191037_site_zones/
  migration.sql`) since Prisma can't express them declaratively.
  `prisma/schema.prisma` drift against such raw additions is an accepted,
  documented tradeoff already established by that migration's comment.
- The frontend already depends on `maplibre-gl` and `@deck.gl/mapbox`
  (`package.json`) — a MapLibre GL JS map is already present in the app (used
  for the flight track / 3D replay), so a polygon-drawing UI has a map
  library to build on without adding a new one.
- Operator remedy pattern: `scripts/admin-sites.ts` — full DB authority,
  outside any pilot's session, for rename/force-private/merge at both the
  site and zone level. Any new polygon field should have an equivalent
  operator remedy (e.g. clear a bad polygon) rather than a fresh moderation
  mechanism.
- CLAUDE.md conventions: pure logic (no DB/Next imports) belongs in
  `lib/sites/` alongside `geo.ts`'s existing style and gets unit tests;
  privacy-sensitive reads must go through the viewer-scoped repo; every
  user-facing release needs a `/whats-new` entry
  (`lib/whats-new.ts`); PRs live on `feature/<description>` branches, never
  direct to `main`.

## Recent Sprint Context

- **SPRINT-004** (PRs #36-40): introduced flat, pilot-owned `Site` — flat
  point (lat/lon), name, kind, ownerId/visibility, matched by proximity on
  ingest, with the read-path firewall, creator-undo, and operator-remedy
  patterns this sprint reuses.
- **SPRINT-005** (PRs #41-44, this session): added `Zone` as a required
  child of `Site` (a zone cannot exist without a site), independent
  visibility with a conjunction rule, zone-first matching with mandatory
  site fallback, the two-step naming dialog, and extended every SPRINT-004
  pattern (read-path firewall, single-writer cache, creator-undo, operator
  remedy) one level down. Found and fixed a real Postgres FK
  cascade-ordering bug (two cascade paths converging on one `Flight` row
  during a site delete) along the way. Deployed to production 2026-08-20/21;
  production currently has a small, pilot-created number of `Site`/`Zone`
  rows (no curated seed — SPRINT-004 PR #40 removed it).
- **Adjacent, not-yet-planned FEATURES.md idea**: per-site/per-zone custom
  radius (a plain numeric override, no polygon). Logged in the same session
  as this feature. Conceptually a polygon is "a custom-shaped radius" — this
  sprint's planning should explicitly decide whether to fold radius
  configurability in or leave it fully separate, so the two features don't
  make parallel, redundant schema changes later.

## Relevant Codebase Areas

- `prisma/schema.prisma` — `Site`/`Zone` models; would gain a new
  boundary/polygon field.
- `prisma/migrations/20260820191037_site_zones/migration.sql` — precedent
  for hand-written raw SQL (CHECK constraints, partial unique index)
  alongside a Prisma-generated migration.
- `lib/sites/geo.ts` — pure geo helpers (`boundingBox`, `withinRadius`,
  `radiusForKind`/`zoneRadiusForKind`, `compareSiteCandidates`). A
  point-in-polygon helper would live here, tested the same way
  (`lib/sites/geo.test.ts` if it exists, or co-located test file).
- `lib/sites/lookup.ts` — `findLocation`, the zone-first/site-fallback
  matching orchestration that any polygon check must compose with.
- `lib/sites/associate.ts` — single writer of denormalized `Flight` cache
  columns; `lib/sites/repo.ts` — `createOrAttachSiteFromFlight`,
  `suggestNearbyLocations`, dedup/reuse logic.
- `lib/sites/visibility.ts` — `canSeeSite`/`canSeeZone`; should need no
  changes if a polygon is purely additional geometry on an existing row.
- `lib/flights/repo.ts` — the viewer-scoped read-path firewall; must keep
  re-verifying visibility regardless of geometry type.
- `components/flight/name-site-dialog.tsx`, `app/flights/[id]/site-action.ts`
  — the naming UX; a v1 decision point is whether drawing a polygon belongs
  here or in a separate edit surface.
- `scripts/admin-sites.ts` — operator remedy; likely needs a `clear polygon`
  command if this ships.
- `package.json` — `maplibre-gl`, `@deck.gl/mapbox` already present for a
  drawing UI; no GeoJSON/turf polygon-math library currently a dependency
  (worth deciding: hand-rolled ray-casting vs. adding a small library).

## Constraints

- Additive only: no existing site/zone loses functionality; anything without
  a polygon keeps behaving exactly as SPRINT-005 shipped it (circle
  matching, unchanged).
- Must follow the pure-function convention in `lib/sites/geo.ts` — any new
  point-in-polygon logic stays free of DB/Next imports and is independently
  unit-tested.
- Must compose with, not bypass, `findLocation`'s zone-first + mandatory
  site-fallback structure (the SPRINT-005 "no dead ends" decision must not
  regress).
- Must not weaken the viewer-scoped read-path firewall or the
  ownership/visibility conjunction model — a polygon is geometry, not a new
  privacy dimension.
- Any new write path (saving a drawn polygon) must go through the existing
  single-writer discipline already established in `lib/sites/associate.ts`
  or an equivalently disciplined equivalent — no ad hoc `prisma.site.update`
  calls scattered through routes.
- Prisma v6 has no native spatial type — any DB-level polygon storage or
  indexing needs raw SQL in the migration, following the precedent already
  set by SPRINT-005's CHECK constraints and partial unique index.
- Every user-facing release needs a `/whats-new` entry.

## Success Criteria

- A pilot can (in some form decided by the drafts — v1 may defer the actual
  drawing UI) associate a custom polygon boundary with a site or zone they
  own.
- A flight endpoint that falls inside a defined polygon matches that
  site/zone, even when it would fall outside the existing circle radius (and
  vice versa: the polygon can also be *tighter* than the radius, correctly
  excluding a point the circle would have matched).
- A site/zone with no polygon defined continues to match exactly as it does
  today — zero behavior change, verified by a regression check against
  SPRINT-005's existing test suite.
- The read-path firewall, ownership, and visibility rules are provably
  unaffected — confirmed, not assumed (the drafts should show how this gets
  verified, e.g. by explicitly running/extending the SPRINT-004/005 privacy
  matrix tests against polygon-bearing rows).
- Matching performance stays acceptable at realistic row counts — the plan
  should state what "acceptable" and "realistic" mean rather than leaving it
  implicit.

## Verification Strategy

- Reference implementation: none — this is bespoke to Leaf Log's existing
  matching engine. Correctness is defined by the existing `findLocation`
  contract (zone-first, site-fallback, deterministic tie-breaking) extended
  with polygon membership, not a new spec.
- Edge cases identified so far (drafts should expand this list):
  - Point-in-polygon at/near a vertex or edge (inclusive vs. exclusive
    boundary — pick one and document it).
  - Self-intersecting or degenerate (fewer than 3 points, zero area)
    polygons — must be rejected at write time, not silently mismatch at
    match time.
  - A polygon crossing the antimeridian (±180°) — `boundingBox()` already
    handles this for circles; polygon math must not regress it.
  - A zone's polygon extending outside its parent site's polygon/radius —
    is this allowed, warned against, or rejected?
  - A flight endpoint inside a zone's polygon but outside the parent site's
    circle (or vice versa) — how does the zone-first/site-fallback
    composition resolve this?
  - Very large or very high-vertex-count polygons (a pilot drawing something
    absurd) — any cap needed?
- Testing approach: unit tests for the pure point-in-polygon/geometry helper
  (mirroring `lib/sites/geo.ts`'s existing style), integration tests
  extending `test/sites.integration.test.ts`'s existing privacy-matrix
  pattern for any row that has a polygon, and (if a drawing UI ships in v1)
  an E2E scenario mirroring `test/e2e/zones.spec.ts`.

## Uncertainty Assessment

- **Correctness uncertainty: Medium** — point-in-polygon (ray-casting or
  equivalent) is a well-understood algorithm, but composing it correctly
  with the existing zone-first/site-fallback bounding-box prefilter, and
  getting boundary-inclusivity and antimeridian handling right, has real
  room for subtle bugs.
- **Scope uncertainty: High** — the seed bundles at least three separable
  concerns (schema/storage, matching-engine changes, and a drawing UI) that
  could ship as one sprint or be split across sprints; whether v1 includes
  actual polygon *drawing* or only the schema/matching groundwork with
  drawing deferred is explicitly undecided.
- **Architecture uncertainty: Medium-High** — the PostGIS-vs-plain-jsonb
  storage decision has real, hard-to-reverse consequences (query
  capability, migration complexity, whether matching can stay
  index-assisted at the DB layer or must pull candidate rows into app code
  first) and isn't resolved yet.

## Open Questions

1. Storage: PostGIS `geometry`/`geography` column (needs the extension
   enabled, raw SQL migration, and likely `prisma.$queryRaw` for
   ST_Contains-style matching) vs. a plain `jsonb` GeoJSON column with
   in-app point-in-polygon math (keeps everything in TypeScript, consistent
   with `lib/sites/geo.ts`'s existing pure-function style, but loses
   DB-level spatial indexing)? What does each cost/enable at Leaf Log's
   actual scale?
2. Does a polygon *replace* the radius-based `boundingBox`/`withinRadius`
   prefilter for a row that has one, or does the existing radius prefilter
   still run first (for DB index usage) with the polygon as a secondary,
   more precise accept/reject check afterward?
3. Should this sprint fold in per-site/per-zone radius configurability (the
   adjacent FEATURES.md idea), given a polygon is conceptually "a
   custom-shaped radius" and building both separately risks duplicate,
   parallel schema changes? Or should radius configurability stay fully out
   of scope and be its own future sprint?
4. Does v1 ship an actual polygon-drawing UI (using the already-present
   `maplibre-gl`), or does v1 ship only the schema + matching-engine support
   with drawing UI deferred to a follow-up sprint?
5. If a drawing UI ships, where does it live — inside the existing two-step
   "name this site" dialog (`name-site-dialog.tsx`), or as a separate
   edit flow reached from a site/zone's own page (which doesn't fully exist
   yet as a distinct page)?
6. What's the boundary-inclusivity rule (a point exactly on the polygon edge
   — in or out), and does it need to match or intentionally differ from the
   existing radius circle's inclusive `<=` comparison in `withinRadius`?
7. What operator remedy does `scripts/admin-sites.ts` need (e.g. a
   `clear-polygon` command) for a pilot-drawn polygon that's malformed or
   abusive (e.g. covering an absurd area)?
8. Any cap on polygon complexity (max vertex count) or area, and where is it
   enforced — client-side draw tool, server-side validation, or both?
