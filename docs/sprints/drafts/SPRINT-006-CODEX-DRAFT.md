# SPRINT-006 Codex Draft: Custom GeoJSON Boundaries for Sites and Zones

## Overview

SPRINT-005 made Leaf Log's location model precise enough to describe real flying
places: a `Site` is the named place and a `Zone` is the specific launch or landing
spot within it. The remaining weakness is geometry. Both levels are still matched
as fixed-radius circles around one anchor point, which is a poor fit for long ridges,
bowl-shaped launches, broad LZs, and sites where the useful area is intentionally
offset from the original point.

This sprint adds an optional custom boundary to both `Site` and `Zone`. A row with
no boundary keeps the exact SPRINT-005 behavior: bbox prefilter, fixed radius,
haversine exact check, deterministic ranking. A row with a boundary uses the
boundary instead: the database prefilter checks the boundary's stored bbox and the
exact application filter checks point-in-polygon. That makes the feature additive
without making it cosmetic: a polygon can expand a site past the old circle, or
tighten it so a point inside the circle no longer matches that row.

The committed v1 includes a real pilot-facing editor, but not a new site directory
or a redesigned naming flow. Boundary editing is reached from the existing owner-only
site/zone affordance on a flight after the row is already bound. That keeps "name
this site" focused on naming and reuse, while still letting a pilot draw the ridge or
LZ shape that future ingest should use.

Core decisions:

1. Store boundaries as plain Prisma `Json`/Postgres `jsonb` GeoJSON plus scalar bbox
   columns. Do not enable PostGIS in v1.
2. A boundary replaces the circle matcher for that row. The old radius is not used as
   a secondary accept path, because tighter-than-radius boundaries are a requirement.
3. Keep per-row radius overrides out of this sprint. They can coexist later as an
   optional circle tuning feature for rows without polygons.
4. Ship a drawing UI in v1, but as a focused edit modal reached from a bound site/zone,
   not as another step inside the already-dense two-step naming dialog.
5. Treat polygon edges as inside, matching `withinRadius`'s inclusive `<=` semantics.
6. Allow a zone boundary to extend outside the parent site's boundary/radius. The zone
   is the more precise geometry, and containment would make imperfect early site
   boundaries block useful zone contributions.

## Use Cases

1. **Trace a ridge launch**: A pilot has a public "Mission Ridge" site whose launch
   ridge is long and narrow. They edit the site's boundary from a flight bound to that
   site and draw the actual ridge. Later flights along the ridge match the site even
   when they are outside the old 600 m takeoff circle.
2. **Tighten an over-broad spot**: A pilot has a "North Launch" zone close to another
   launch. They draw a smaller polygon around the actual launch pad. A future endpoint
   inside the old 300 m circle but outside the polygon no longer matches that zone and
   can fall back to the parent site or another zone.
3. **Keep legacy rows untouched**: Existing sites and zones with no boundary keep
   matching exactly as they did after SPRINT-005. No migration backfills polygon data,
   no existing row changes rank or visibility because of this sprint alone.
4. **Refine a private spot**: A pilot draws a private zone boundary under a public
   site. The owner gets private matching precision. Other viewers still see only the
   parent site on display, and their ingest never matches the private zone.
5. **Fix a bad public boundary**: A pilot accidentally draws a public zone boundary
   that covers too much terrain. The zone owner, the parent site owner, or an operator
   can clear it; once cleared, the row immediately falls back to circle matching.
6. **Cross the antimeridian safely**: A rare site near +/-180 degrees can store and
   match a boundary whose bbox crosses the antimeridian without losing candidates to
   naive min/max longitude logic.

## Architecture

### Data Model

Both `Site` and `Zone` gain the same optional boundary shape:

```prisma
model Site {
  // existing fields...
  boundaryGeojson              Json?
  boundaryLatMin               Float?
  boundaryLatMax               Float?
  boundaryLonMin               Float?
  boundaryLonMax               Float?
  boundaryCrossesAntimeridian  Boolean?
  boundaryUpdatedAt            DateTime?

  @@index([boundaryLatMin, boundaryLatMax])
  @@index([boundaryLonMin, boundaryLonMax])
}

model Zone {
  // existing fields...
  boundaryGeojson              Json?
  boundaryLatMin               Float?
  boundaryLatMax               Float?
  boundaryLonMin               Float?
  boundaryLonMax               Float?
  boundaryCrossesAntimeridian  Boolean?
  boundaryUpdatedAt            DateTime?

  @@index([boundaryLatMin, boundaryLatMax])
  @@index([boundaryLonMin, boundaryLonMax])
}
```

`boundaryGeojson` stores only a GeoJSON `Polygon` with one outer ring, WGS84
coordinates in GeoJSON order `[lon, lat]`. V1 rejects holes and `MultiPolygon`.
That is intentionally narrow: a pilot-drawn site boundary is one simple outline, and
accepting holes would complicate validation, drawing, matching, and operator review
without a known product need.

The scalar bbox columns exist so lookup does not full-scan every polygon-bearing row.
They are derived from the stored ring by the server and written in the same update as
`boundaryGeojson`. The client never submits bbox columns. A raw SQL migration adds an
all-or-none CHECK so a row cannot have a boundary JSON without the derived bbox, or a
bbox without boundary JSON. Prisma v6 cannot express that constraint; this follows the
SPRINT-005 raw-SQL precedent.

No PostGIS is added. Leaf Log's current and near-term scale is small enough that
JSONB plus scalar bbox prefiltering keeps the implementation simple, keeps matching in
the existing TypeScript geo layer, avoids raw spatial query APIs in the hot path, and
does not make Railway Postgres extension availability part of the release. If a future
gazetteer import changes the row-count profile, this design can migrate to PostGIS
later because the authoritative value is already GeoJSON.

### Boundary Validation

`lib/sites/boundary.ts` is a pure module, with no DB or Next imports. It owns:

- parsing and normalizing GeoJSON;
- server-side validation;
- bbox derivation, including antimeridian-crossing boxes;
- approximate area calculation;
- inclusive point-on-edge and point-in-polygon checks.

Validation rules:

- `type` must be `"Polygon"`.
- exactly one ring is accepted;
- the server closes the ring if the client omits the repeated final vertex;
- at least 3 distinct vertices after normalization;
- no self-intersections;
- every coordinate is finite, latitude is `[-90, 90]`, longitude is normalized to
  `[-180, 180]`;
- max vertices: 64;
- max approximate area: 25 sq km for sites, 4 sq km for zones;
- zero-area and near-zero-area polygons are rejected;
- antimeridian crossing is supported, but polygons spanning half the globe are
  rejected by the area/span checks.

Point-on-edge is inside. This preserves the mental model already used by radius
matching: a point exactly at the boundary is still a match.

### Matching Flow

`findLocation` keeps the SPRINT-005 structure:

```text
endpoint fix
  |
  |-- zone pass: polygon zones by boundary bbox + circle zones by radius bbox
  |      |-- exact filter: point-in-polygon OR withinRadius
  |      |-- visibility conjunction and kind checks
  |      `-- deterministic ranking
  |
  |-- if zone winner: return zone + parent site
  |
  `-- site pass: polygon sites by boundary bbox + circle sites by radius bbox
         |-- exact filter: point-in-polygon OR withinRadius
         |-- visibility and kind checks
         `-- deterministic ranking
```

Rows with a boundary do not also run the old radius exact check. That is the only
interpretation that satisfies both expansion and tightening:

- outside old circle, inside polygon -> match;
- inside old circle, outside polygon -> reject.

Rows without a boundary are byte-for-byte equivalent in behavior to SPRINT-005 after
filtering and ranking. The site fallback still always runs when no zone wins. A tight
zone polygon can reject an endpoint, and the parent site can still match if its own
geometry accepts the point.

Ranking remains distance-to-anchor, curated-before-user, id. A polygon changes whether
a candidate is eligible; it does not introduce a second ranking metric in v1. This is
deterministic, preserves existing behavior for circle rows, and avoids the ambiguous
question of whether "closest edge", "centroid", or "anchor point" is the right score
for irregular hand-drawn polygons.

### Write Scope and Permissions

Boundary writes are separate from flight cache writes. They mutate `Site`/`Zone`
geometry only; no `Flight.{takeoff,landing}{Site,Zone}{Id,Name}` columns are written
when a boundary changes. Future ingest and explicit backfill use the new geometry.
Existing flight rows are not retroactively changed during an interactive boundary edit.

Permissions:

- a site's owner can set or clear the site boundary;
- a zone's owner can set or clear the zone boundary;
- the parent site's owner can set or clear boundaries for zones under their own site,
  matching the SPRINT-005 scoped moderation rule;
- operators can clear a site or zone boundary through `scripts/admin-sites.ts`;
- hidden and nonexistent rows return indistinguishable errors.

Boundary visibility follows row visibility. The boundary is not a new privacy axis.
Private site/zone boundaries are never returned to non-owners because all row reads
continue to go through `siteVisibleWhere`, `zoneVisibleWhere`, and the flight
read-path firewall.

### User Interface

V1 adds a boundary editor modal reached from the existing owner-only site/zone dialog.
The naming flow remains two-step: choose/create site, optionally choose/create zone.
After a row is bound, the dialog exposes boundary actions for the currently bound site
and zone:

- Edit site boundary
- Clear site boundary
- Edit spot boundary
- Clear spot boundary

The editor uses the already-present MapLibre dependency. It is a small local drawing
tool, not a new mapping stack: click/tap to add vertices, drag vertices to refine,
undo last point, clear, cancel, save. It displays the current flight endpoint and the
site/zone anchor so the pilot can draw in context. The client mirrors validation for
fast feedback, but the server is authoritative.

No public site pages or browse/search surfaces are introduced in this sprint.

## Implementation

### Phase 1: Schema and Pure Geometry (~30% of effort)

**Files:**

- `prisma/schema.prisma` - Add optional boundary columns and indexes to `Site` and
  `Zone`.
- `prisma/migrations/<timestamp>_site_zone_boundaries/migration.sql` - Add columns,
  indexes, and raw all-or-none CHECK constraints.
- `lib/sites/boundary.ts` - Create pure GeoJSON validation, bbox, area,
  antimeridian, and point-in-polygon helpers.
- `lib/sites/boundary.test.ts` - Unit tests for every validation and geometry rule.
- `lib/sites/geo.ts` / `lib/sites/geo.test.ts` - Keep existing radius helpers stable;
  add only shared types or exports if needed.

**Tasks:**

- [ ] Add `boundaryGeojson`, derived bbox columns, and `boundaryUpdatedAt` to both
  models.
- [ ] Add raw SQL CHECK constraints proving boundary JSON and bbox columns are all
  present or all absent.
- [ ] Implement one-ring GeoJSON parsing and normalization.
- [ ] Implement inclusive point-on-edge and point-in-polygon.
- [ ] Implement bbox derivation for normal and antimeridian-crossing polygons.
- [ ] Reject degenerate, self-intersecting, over-large, and over-complex polygons.
- [ ] Cover edge, vertex, antimeridian, invalid-coordinate, and area-cap cases with
  pure unit tests.

### Phase 2: Polygon-Aware Matching (~25% of effort)

**Files:**

- `lib/sites/lookup.ts` - Include polygon-bearing site/zone candidates and exact
  point-in-polygon filtering.
- `lib/sites/lookup.test.ts` - Unit tests with fake DB candidates for ranking and
  fallback behavior.
- `test/sites.integration.test.ts` - Integration coverage for owner/public/private
  visibility and lookup with boundary-bearing rows.
- `scripts/backfill-sites.ts` - Ensure any existing backfill path calls the new lookup
  contract without assuming circle-only matching.

**Tasks:**

- [ ] Split candidate selection into circle rows (`boundaryGeojson = null`) and
  polygon rows (`boundaryGeojson != null` and bbox contains endpoint).
- [ ] Keep zone-first and mandatory site fallback exactly as SPRINT-005 defines them.
- [ ] Preserve circle behavior for rows with no boundary.
- [ ] Ensure a polygon can both include a point outside the old radius and reject a
  point inside the old radius.
- [ ] Re-run visibility checks after candidate selection; do not rely only on pushed
  Prisma predicates.
- [ ] Keep deterministic ranking by anchor distance, curated-before-user, id.
- [ ] Add a non-CI benchmark script or documented local check for 5k sites + 10k zones
  with mixed circle/polygon rows; target p95 `findLocation` under 50 ms on local
  Postgres with bbox candidate counts logged when they exceed 100.

### Phase 3: Boundary Write API and Flight-Side UI (~30% of effort)

**Files:**

- `lib/sites/repo.ts` - Add owner-scoped boundary read/write helpers.
- `app/flights/[id]/site-action.ts` - Add server actions to load, save, and clear
  boundaries for the bound site/zone on a flight endpoint.
- `components/flight/name-site-dialog.tsx` - Add entry points to edit/clear current
  site and zone boundaries.
- `components/sites/boundary-editor.tsx` - Create the MapLibre polygon editor modal.
- `components/sites/boundary-editor.test.tsx` - Component tests for validation states
  and controls where practical.
- `test/e2e/zones.spec.ts` or `test/e2e/sites.spec.ts` - Owner flow for drawing and
  clearing a boundary.

**Tasks:**

- [ ] Add repo helpers that verify site/zone ownership and parent-site-owner override
  before writes.
- [ ] Add server actions that derive the editable row from the owner-scoped flight and
  endpoint, not from a client-trusted arbitrary id alone.
- [ ] Return hidden and missing site/zone errors indistinguishably.
- [ ] Build a MapLibre editor with add vertex, drag vertex, undo, clear, cancel, save,
  and existing-boundary load states.
- [ ] Mirror validation client-side, but always revalidate server-side before writing.
- [ ] Keep the naming dialog's existing create/reuse/skip behavior intact.
- [ ] Confirm a boundary edit does not write any denormalized `Flight` cache columns.

### Phase 4: Operator Remedy, Release Notes, and Full Verification (~15% of effort)

**Files:**

- `scripts/admin-sites.ts` - Add `clear-boundary <siteId>` and
  `zone-clear-boundary <zoneId>`.
- `scripts/admin-sites.test.ts` - Tests for boundary clear commands and cache
  non-mutation.
- `lib/sites/write-audit.test.ts` - Confirm no new boundary writer is accidentally
  allowed to mutate flight cache columns.
- `lib/whats-new.ts` - Add a user-facing release note.
- `docs/architecture.md` - Add a short note describing optional boundary geometry and
  the circle fallback contract.

**Tasks:**

- [ ] Add operator commands to clear malformed or abusive boundaries without deleting
  the site/zone.
- [ ] Add audit coverage proving boundary writes are separate from flight cache writes.
- [ ] Add `/whats-new` entry.
- [ ] Update architecture docs with storage, matching, and privacy contracts.
- [ ] Run the required gates: `pnpm build`, `pnpm test`, `pnpm typecheck`,
  `pnpm lint`, and `pnpm e2e`.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | Modify | Add optional boundary fields and indexes to `Site` and `Zone`. |
| `prisma/migrations/<timestamp>_site_zone_boundaries/migration.sql` | Create | Add DB columns, indexes, and raw all-or-none CHECK constraints. |
| `lib/sites/boundary.ts` | Create | Pure GeoJSON validation, bbox derivation, area checks, and point-in-polygon logic. |
| `lib/sites/boundary.test.ts` | Create | Unit coverage for boundary validation and geometry edge cases. |
| `lib/sites/lookup.ts` | Modify | Use polygon membership for boundary-bearing rows while preserving circle fallback. |
| `lib/sites/lookup.test.ts` | Modify | Cover polygon-vs-circle eligibility, ranking, and fallback cases. |
| `lib/sites/repo.ts` | Modify | Add owner-scoped boundary read/write helpers. |
| `app/flights/[id]/site-action.ts` | Modify | Add server actions for loading, saving, and clearing boundaries. |
| `components/flight/name-site-dialog.tsx` | Modify | Add boundary edit/clear entry points for bound sites and zones. |
| `components/sites/boundary-editor.tsx` | Create | MapLibre polygon drawing/editing UI. |
| `components/sites/boundary-editor.test.tsx` | Create | Component-level validation and control coverage. |
| `test/sites.integration.test.ts` | Modify | Add visibility and matching matrix cases for boundary-bearing rows. |
| `test/e2e/sites.spec.ts` / `test/e2e/zones.spec.ts` | Modify | Add an owner drawing and clearing scenario. |
| `scripts/admin-sites.ts` | Modify | Add site and zone boundary clear commands. |
| `scripts/admin-sites.test.ts` | Modify | Verify operator clear behavior. |
| `lib/sites/write-audit.test.ts` | Modify | Ensure boundary work does not weaken single-writer flight cache discipline. |
| `lib/whats-new.ts` | Modify | User-facing release note. |
| `docs/architecture.md` | Modify | Document optional custom boundary storage and matching behavior. |

## Definition of Done

- [ ] Existing site/zone rows with no boundary match exactly as SPRINT-005 matched
  them; regression tests prove no behavioral drift for circle-only rows.
- [ ] A polygon-bearing site or zone can match a point outside the old fixed radius.
- [ ] A polygon-bearing site or zone can reject a point inside the old fixed radius.
- [ ] Zone-first matching and mandatory site fallback still hold.
- [ ] Point-on-edge and point-on-vertex are inclusive and tested.
- [ ] Degenerate, self-intersecting, over-large, and over-vertex-count polygons are
  rejected server-side.
- [ ] Antimeridian-crossing bbox and point-in-polygon behavior are tested.
- [ ] Private boundaries do not leak through lookup, flight display, server actions,
  suggestions, or any public response body.
- [ ] Boundary writes are owner-scoped and hidden/nonexistent rows are
  indistinguishable.
- [ ] Boundary edits do not update existing flight site/zone cache columns.
- [ ] Operator clear commands exist for both site and zone boundaries.
- [ ] `lib/whats-new.ts` has a user-facing entry.
- [ ] `docs/architecture.md` documents the new geometry contract.
- [ ] `pnpm build` passes.
- [ ] `pnpm test` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `pnpm e2e` passes with local Postgres and dev server.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Polygon math edge cases cause false matches or misses. | Medium | High | Keep all geometry pure and heavily unit-tested: edge/vertex inclusivity, antimeridian, degenerate rings, self-intersection, and tighter/looser-than-circle cases. |
| JSONB storage without PostGIS becomes too slow as rows grow. | Low | Medium | Store scalar bbox columns, index them, benchmark mixed datasets, and keep GeoJSON as a future PostGIS migration source if row counts change. |
| The editor makes the already-complex naming dialog hard to use. | Medium | Medium | Keep drawing in a separate modal reached after a row is bound; do not add drawing as a third naming step. |
| Bad public polygons affect other pilots' future matching. | Medium | Medium | Enforce vertex/area caps, keep boundary editing permission narrow, and add operator clear commands. |
| Zone polygons outside parent geometry feel surprising. | Medium | Low | Allow it deliberately, document it, and rely on zone-first precision plus site fallback. Future UX can warn without blocking. |
| Boundary edits not retroactively changing existing flights confuse pilots. | Medium | Low | Make v1 copy/action labels about "future matching"; leave explicit backfill/rematch tooling for a separate sprint. |
| Raw SQL CHECK constraints drift from Prisma schema. | Medium | Low | Follow the existing migration-comment precedent and include migration tests/gate coverage. |

## Security

Leaf Log remains app-layer privacy only. This sprint must not add any public or
ownerless boundary endpoint that bypasses the established repo seams.

- Boundary read/write actions must derive authority from the authenticated owner and,
  where reached from a flight, from an owner-scoped flight lookup.
- `siteVisibleWhere`, `zoneVisibleWhere`, `canSeeSite`, and `canSeeZone` remain the
  only visibility authorities for sites/zones.
- A private boundary is as sensitive as the private row itself: do not expose it in
  public flight DTOs, public profile data, feed rows, suggestions, errors, or logs.
- Saving a boundary must not trust client-submitted bbox, area, row kind, owner id, or
  visibility.
- Public geometry is user-generated content. Area and vertex caps are the abuse
  controls for v1; operator clear is the remedy.
- The boundary editor must not introduce a route that serves raw flight data or bypasses
  `getFlightForViewer`.

## Dependencies

- SPRINT-005 must be present, including `Zone`, `findLocation`, `canSeeZone`,
  `locationCachePatch`, and the zone-aware read-path firewall. This checkout already
  has that work.
- Existing `maplibre-gl` dependency is used for the editor; no new drawing or spatial
  library is required in v1.
- Prisma remains v6. PostGIS is intentionally not required.
- Local and CI validation still require the project gates listed in `CLAUDE.md`.
- E2E coverage needs local Postgres and a running dev server, as today.

## Open Questions

None blocking. The planning calls this draft makes are:

- **Storage**: JSONB GeoJSON plus scalar bbox columns, not PostGIS.
- **Circle interaction**: a boundary replaces circle matching for that row; no radius
  fallback for polygon-bearing rows.
- **Radius configurability**: out of scope for SPRINT-006.
- **UI scope**: v1 ships drawing/editing, reached from the existing bound site/zone
  dialog, not from new site pages and not as part of initial naming.
- **Boundary inclusivity**: edge and vertex are inside.
- **Zone containment**: a zone boundary may extend outside the parent site's boundary
  or radius.
- **Operator remedy**: clear-boundary commands for both sites and zones.
- **Complexity caps**: 64 vertices, 25 sq km max site area, 4 sq km max zone area,
  enforced server-side and mirrored client-side.
