# Critique - SPRINT-006 Claude draft (Custom boundaries for sites and zones)

Reviewed: [`SPRINT-006-CLAUDE-DRAFT.md`](./SPRINT-006-CLAUDE-DRAFT.md) against
[`SPRINT-006-INTENT.md`](./SPRINT-006-INTENT.md), the current SPRINT-005 code in
`lib/sites/*`, `lib/flights/repo.ts`, `app/flights/[id]/site-action.ts`, and the
existing sprint critique style.

**Verdict.** The draft is unusually strong on architecture: it answers every intent
question, preserves the SPRINT-004/005 privacy model, gives a concrete storage strategy,
and has a realistic PR sequence. The main remaining problems are not "does polygon math
belong here?" - the draft answers that well - but product and contract edges where the
implementation could satisfy the words while failing real pilot workflows. Fix the
endpoint-specific boundary ambiguity, the edit-surface reachability problem, the index
proof, and malformed-stored-boundary behavior before merging this into the final sprint.

## 1. Strengths

1. **The core model is correctly conservative.** "Boundary is geometry, never identity" is
   the right load-bearing principle. Keeping `Flight` unchanged, leaving
   `locationCachePatch`, `resolveLocationFields`, `canSeeSite`, and `canSeeZone` out of
   scope, and proving the privacy matrix with boundary-bearing rows is exactly the right
   posture for this codebase.

2. **The exact-match replacement rule is clear and product-relevant.** The draft rejects
   "circle union polygon" explicitly, which matters: a union could widen a site but could
   never fix an over-broad circle. The draft's table for boundary-present vs.
   boundary-absent rows is easy to implement and test.

3. **The storage decision is well argued.** `jsonb` plus derived bbox columns fits the
   current Prisma v6/Railway setup, avoids PostGIS operational drag, and keeps visibility
   predicates in typed Prisma `WhereInput`s instead of hand-written spatial SQL. The
   versioned envelope also gives future radius override / holes / multipolygon work a
   migration path.

4. **Validation is much more complete than the intent required.** The draft covers
   inclusive edges, ray-through-vertex behavior, self-intersection, area caps, vertex caps,
   coordinate rounding, winding normalization, and anchor containment. That is the right
   level of specificity for a feature whose failure mode is subtle misclassification.

5. **The matching composition respects SPRINT-005.** Zone-first, unconditional site
   fallback, visibility pushdown plus `canSeeZone` re-check, and `compareSiteCandidates`
   staying unchanged are all good constraints. Boundary-aware `suggestNearbyLocations` is
   also important; without it the dialog and ingest could disagree about what place the
   pilot is standing inside.

6. **The PR ordering is a safety property, not just scheduling.** PR1 and PR2 are inert
   until the write path exists; PR3 creates validated boundaries; PR4 adds the editor and
   operator remedy. That keeps production rollback and review pressure manageable.

7. **The DoD is mostly executable.** It names concrete files, exact edge tests,
   integration tests, privacy-matrix duplication, operator commands, release docs, and
   "unchanged on purpose" files. This is stronger than a high-level feature checklist.

## 2. Weaknesses

### 2.1 One boundary per row is ambiguous for `kind: "both"` rows - blocker

The draft says a row with a boundary uses that boundary instead of the circle, and also
says `kind` filtering is untouched. But a `Site` or `Zone` can be `kind: "both"`, and the
existing system has endpoint-specific radii: 600 m takeoff / 900 m landing for sites,
300 m takeoff / 400 m landing for zones.

That creates a concrete regression:

- A site has become `kind: "both"` because pilots use it for launch and landing.
- The owner draws a tight launch ridge boundary around the takeoff area.
- Future landing endpoints that used to match the 900 m landing circle now use the launch
  polygon only and may become "Unknown site."

The draft frames boundary edits as additive because existing bindings are not removed, but
future matching for the other endpoint can still regress immediately. This is especially
likely for free-flight sites, where launches and LZs are often intentionally separated.

The final sprint needs one of these decisions:

- Boundaries are endpoint-specific (`takeoffBoundary`, `landingBoundary`, or an envelope
  with endpoint-specific shapes).
- A row-level boundary may only be set on rows whose `kind` is not `both`.
- A `both` row boundary intentionally applies to both endpoints, with a DoD test proving
  the accepted landing/takeoff regression is understood.

Without that, "boundary replaces circle" is under-specified for the exact rows most likely
to have mixed takeoff/landing history.

### 2.2 The proposed edit surface cannot reach the headline "expand an existing site" case

The draft requires server actions to re-derive the target row id from the flight row and
never accept a site id, zone id, or coordinate from the client. That is privacy-conscious,
but it conflicts with the main use case: expanding an existing ridge site whose endpoints
currently fall outside the circle.

If a flight is outside the current circle, it is not bound to the intended existing site.
The third dialog step therefore has no bound site id to edit. Before a boundary exists,
`suggestNearbyLocations` also cannot offer a site whose anchor is 3 km away unless it is
already within the fixed suggestion radius. The likely user path becomes "create a
duplicate site from the off-radius flight," not "edit Mission Ridge's boundary."

This is not just UI polish. It affects data quality and the feature's core usefulness. The
final sprint should define a safe way to select an owned or editable existing row for a
boundary edit when the current flight is not already bound to it. Options include an
owner-scoped site/zone picker in the dialog, a bounded "my nearby sites" search with ids
submitted to an owner-gated action, or a separate owner-only management surface. The current
"no id ever leaves the server" rule is too strict for this workflow.

### 2.3 The parent-site-owner zone remedy is promised but may be unreachable

The draft says `setZoneBoundary` / `clearZoneBoundary` reuse `findZoneEditableBy`, so a
zone's owner or the parent site's owner may edit a zone boundary. But the proposed flight
page actions derive the zone id from the caller's flight row and never accept a zone id.

That means the parent site's owner can only edit a child zone boundary if one of their own
flights is already bound to that zone and visible to them. For a private zone under their
public site, `canSeeZone` does not make the zone visible to the site owner unless they also
own the zone. For a public but bad zone they have never flown from, there may be no flight
row available as an edit handle. The scoped remedy exists in the library API but not in the
product surface.

Either the final sprint should allow an owner-gated id-bearing zone edit action, or it
should narrow the promise and say the parent-site-owner remedy is operator-only in v1.

### 2.4 The partial-index claim needs proof, not only intent

The migration sketch creates:

```sql
CREATE INDEX "Site_boundary_bbox_idx"
  ON "Site" ("boundaryMinLat", "boundaryMaxLat")
  WHERE "boundary" IS NOT NULL;
```

The boundary branch predicates on all four bbox columns:

```ts
boundaryMinLat <= lat
boundaryMaxLat >= lat
boundaryMinLon <= lon
boundaryMaxLon >= lon
```

Three gaps follow:

- The query sketch does not explicitly include `boundary IS NOT NULL`; PostgreSQL may not
  choose the partial index unless the query predicate implies the partial-index predicate
  in a way the planner recognizes.
- The index ignores longitude, so at larger boundary counts it may still scan many
  latitude-overlapping rows.
- `boundary IS NOT NULL` on a nullable Prisma `Json` column should be protected against
  accidental JSON `null` vs SQL `NULL` writes. The writer may never do that, but the schema
  invariant should name it.

The draft's "index-assisted" performance statement is plausible at today's scale, but the
DoD should require an `EXPLAIN`-backed seeded test or at least a deliberately asserted query
shape (`boundaryMinLat: { not: null }` / `boundary: { not: DbNull }`, depending on Prisma's
generated API) so the index is not decorative.

### 2.5 Malformed stored boundaries are not assigned a runtime behavior

Validation prevents bad writes through the app, but production data can still become bad:
manual SQL, a future validator bug, restore/import mistakes, or a partially reverted PR.
`locationMatches(row: { boundary: unknown })` implies the hot path will parse an unknown
JSON value during matching, but the draft does not say what happens if parsing fails.

The final sprint should choose and test one behavior:

- fail closed for that row and log structured diagnostics;
- ignore the bad boundary and fall back to circle matching;
- throw and fail the ingest/upload.

Throwing is probably wrong because one corrupt public site row could break unrelated
uploads nearby. Falling back to circle is user-friendly but weakens "boundary replaces
circle." Fail-closed with operator `boundary-clear` is the cleanest privacy posture, but it
must be explicit.

### 2.6 "No boundary display outside the editor" weakens review and repair

The draft deliberately defers boundary rendering on public flight pages and lists. That is
reasonable for scope, but it also means a public boundary can affect every pilot's future
matching while remaining invisible except to editors/operators. A bad public shape is
harder to notice, report, or explain.

At minimum this should be listed as a residual product risk. A low-cost mitigation could be
owner-visible boundary metadata on the existing site/zone affordance: present/absent,
vertex count, area, and last updated, without full public map rendering.

## 3. Gaps in Risk Analysis

1. **Endpoint regression on `both` rows is missing.** This is the largest unlisted product
   and correctness risk. A takeoff-shaped boundary on a `both` site can break landing
   matching for future flights, and vice versa.

2. **Duplicate-site creation from off-radius flights is missing.** The draft assumes an
   owner can open a flight and edit the intended site. That is false when the flight is
   currently unmatched because it lies outside the circle, which is the flagship expansion
   case.

3. **Public-boundary governance is underplayed.** The draft says a boundary edit creates no
   row and therefore needs no daily cap. True, but a public boundary can change future
   matching for all pilots. Area caps reduce abuse blast radius, but they do not address
   inaccurate or self-serving edits within the cap.

4. **Stored-data corruption is not covered.** The risk section covers untrusted input at
   write time but not invalid JSON already in the database at read/match time.

5. **Query-plan drift is not covered.** The performance section gives target numbers but
   does not require proving the Prisma-generated query uses the intended partial index, nor
   does it define what happens when boundary-bearing rows are no longer a small minority.

6. **CI benchmark flakiness is understated.** A hard "1,000 calls under 50 ms" guard can be
   noisy on shared CI. It is useful as a local signal, but the DoD should either make it
   generous enough to avoid flakes or replace it with an algorithmic regression test plus
   an opt-in benchmark.

## 4. Missing Edge Cases

1. **`kind: "both"` site with a boundary around only one endpoint.** Assert whether the
   other endpoint should still use its circle, use the same boundary, or refuse the edit.

2. **`kind: "both"` zone with one endpoint-specific real-world footprint.** Same issue one
   level down, especially for "top landing" or multi-use fields.

3. **Off-radius existing site selected for editing.** A pilot should be able to expand an
   owned existing site without first creating a duplicate.

4. **Parent-site owner clearing a zone boundary they do not own and have no flight bound
   to.** The API promise and UI/action reachability need a test.

5. **Stored boundary is malformed despite the writer.** Matching, suggestions, and
   reassociation should not throw unpredictably.

6. **JSON `null` vs SQL `NULL`.** The all-or-none CHECK should not be bypassable by a JSON
   null boundary value paired with non-null bbox columns.

7. **Anchor exactly on the boundary under normalization.** The draft tests points on edges,
   but anchor containment should be tested after 6-decimal rounding and winding
   normalization, not only on the raw client coordinates.

8. **Clearing a boundary after it widened matches.** Existing newly-bound flights stay
   bound by design, while future flights fall back to circle. That should be asserted so
   operators understand `boundary-clear` is not a backfill/undo of historical bindings.

9. **Multiple overlapping large public boundaries.** The draft accepts anchor-distance
   ranking, but it should test two overlapping boundary-bearing rows where the nearer
   anchor is outside its own old circle and the farther anchor is inside its old circle.

10. **Suggestion ordering for boundary-only matches.** A boundary-containing site whose
    anchor is 3 km away can appear in a "nearby" list. The list needs deterministic ordering
    and UI copy that does not imply every result is anchor-near.

## 5. Definition of Done Completeness

The DoD is broadly strong and nearly implementation-ready. It covers schema, validation,
matching, privacy, operator remedy, e2e, release docs, and explicit non-goals. I would add
or change these items before finalizing:

1. Add a DoD item for `kind: "both"` semantics: either endpoint-specific boundaries exist,
   `both` rows reject boundary edits, or shared-boundary behavior is explicitly tested for
   both takeoff and landing.

2. Add a DoD item proving an owner can edit the boundary of an existing off-radius site or
   zone without creating a duplicate row.

3. Add route/action tests for the claimed parent-site-owner zone boundary remedy, including
   a zone not already bound to the caller's own flight.

4. Add malformed-stored-boundary tests for `findLocation`, `suggestNearbyLocations`, and
   `reassociateOwnFlights`.

5. Add query-plan verification for the boundary bbox branch, or weaken the "index-assisted"
   claim to "bounded by expected small boundary count" until proven.

6. Add a migration invariant around JSON `null` and bbox sanity (`min <= max`, coordinate
   ranges) or state explicitly that only the writer enforces those and DB constraints only
   enforce all-or-none presence.

7. Add a test for `boundary-clear` preserving existing flight bindings while changing only
   future matching.

8. Add a UI/e2e assertion for mobile-sized drawing controls if PR4 ships the editor in v1.
   Touch hit targets, undo, clear, and validation feedback are where this feature will fail
   in practice, not the happy-path desktop click flow.

9. Reword "`geo.test.ts` and `lookup.test.ts` passing unmodified" if those files must gain
   boundary tests. The intended assertion is "existing circle-only assertions pass
   unchanged"; the files themselves will necessarily be edited.

10. Add an explicit release gate that boundary JSON is absent from public serialized
    surfaces by snapshot or selected-field tests, not only by review.

With those changes, Claude's draft is a strong base for the final sprint. The architecture
is sound; the remaining work is to close the places where the product workflow, endpoint
semantics, and database proof do not yet match the confidence of the design language.
