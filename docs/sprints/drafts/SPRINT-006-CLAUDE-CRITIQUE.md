# Critique — SPRINT-006 Codex draft (custom GeoJSON boundaries)

Reviewed: [`SPRINT-006-CODEX-DRAFT.md`](./SPRINT-006-CODEX-DRAFT.md) against
[`SPRINT-006-INTENT.md`](./SPRINT-006-INTENT.md) and the shipped code it extends
(`lib/sites/geo.ts`, `lib/sites/lookup.ts`, `lib/sites/repo.ts`,
`lib/sites/associate.ts`, `scripts/admin-sites.ts`, `components/flight/name-site-dialog.tsx`).

**Verdict.** The three architectural calls that matter — jsonb + derived bbox instead of
PostGIS, boundary *replaces* circle for the row that has one, and boundary-as-geometry
rather than a new privacy axis — are all right, and the security section is the strongest
part of the draft. Three things stand between it and mergeable: the antimeridian design is
internally contradictory (§W1), the ranking rule quietly makes hand-drawn precision lose to
circle proximity (§W3), and the sprint ships a drawing UI that has **zero effect on any
flight already in a pilot's logbook** (§W4) — which is where most of the value was. Fix
those three, tighten the zone area cap (§W7), and the rest is polish.

---

## Strengths

- **It commits.** All eight intent open questions come back as decisions with reasons, and
  "Open Questions: None blocking" is the right posture for a document that is an input to a
  merge. Every decision is restated in one place at the end, which makes the merge diff
  against the other draft mechanical.

- **Boundary replaces the circle — correct, and correctly argued.** The draft's reasoning
  ("that is the only interpretation that satisfies both expansion and tightening") is
  exactly right. A union can only ever grow the match area, and over-matching — the 300 m
  zone circle reaching across a spine to the next launch — is the more common complaint. A
  draft that quietly picked union would have shipped a half-feature.

- **No PostGIS is the right call at this scale**, and the justification is the right *kind*
  of justification: it keeps matching in the pure `lib/sites/geo.ts` layer, keeps the
  visibility predicates as typed Prisma `where` fragments rather than raw SQL, and keeps
  Railway extension availability out of the release path. Keeping GeoJSON as the
  authoritative value so a later PostGIS migration is still open is a genuinely good hedge.

- **Boundary is geometry, not identity.** "No `Flight.*` cache column is written when a
  boundary changes" is stated as an invariant, given its own DoD line, and given an audit
  test (`lib/sites/write-audit.test.ts`). That audit is textual and file-level, so a new
  writer landing in `lib/sites/repo.ts` genuinely could have regressed it — noticing that is
  a real catch.

- **The security section is properly scoped.** It names the actual authorities
  (`siteVisibleWhere` / `zoneVisibleWhere` / `canSeeSite` / `canSeeZone`), forbids trusting
  client-submitted bbox/area/kind/owner/visibility, keeps hidden and nonexistent rows
  indistinguishable (matching `hiddenOrMissingSite()` in `lib/sites/repo.ts`), and calls out
  that a private boundary is as sensitive as the private row itself — including in logs.

- **Drawing lives outside the naming flow.** The two-step dialog is already dense; adding a
  map-drawing step as step three would have made "name this spot" feel like a GIS tool. A
  separate modal reached after binding is the better product judgment, and the draft says so
  in the risk table rather than leaving it implicit.

- **Operator remedy matches existing convention.** `clear-boundary` / `zone-clear-boundary`
  mirrors the `rename` / `zone-rename`, `force-private` / `zone-force-private` pairing in
  `scripts/admin-sites.ts:187-211`. Reactive-clear rather than a new moderation mechanism is
  what the intent asked for.

- **It states a performance number.** 5k sites + 10k zones, p95 `findLocation` under 50 ms,
  candidate counts logged above 100. The intent explicitly asked for "acceptable" and
  "realistic" to be defined rather than implied; this draft is the one that did it. (It then
  forgets to put it in the DoD — see §DoD.)

- **The validation rule list is concrete**: one ring, server closes the ring, ≥3 distinct
  vertices, finite coordinates, 64 vertices, per-level area caps, zero-area rejected. Nearly
  every one of these is a real failure mode a hand-drawn polygon will hit in week one.

---

## Weaknesses

### W1. The antimeridian design contradicts itself (load-bearing)

Three of the draft's own rules cannot all hold at once:

1. `boundaryGeojson` stores **one outer ring** — holes and `MultiPolygon` are rejected.
2. Validation **normalizes longitude to `[-180, 180]`**.
3. "Antimeridian crossing is supported."

Once every vertex is normalized into `[-180, 180]`, a ring that goes `179 → -179` is
indistinguishable from one that goes the long way round the other 358°. Standard
ray-casting over the raw longitudes then gives the wrong answer for exactly the rows the
draft claims to support, and there is no stated convention that resolves the ambiguity
(the usual one is "no single edge may span more than 180° of longitude; unwrap to a
continuous frame anchored on the first vertex, test there, and only re-wrap for storage").
RFC 7946 resolves it by *splitting at the antimeridian into a MultiPolygon* — which v1
explicitly rejects.

The candidate query has the same hole. Phase 2's task list says "polygon rows
(`boundaryGeojson != null` and bbox contains endpoint)", but for a crossing row
`lonMin <= lon AND lon <= lonMax` is false by construction; the query needs the
`crosses ? (lon >= lonMin OR lon <= lonMax) : (lon BETWEEN lonMin AND lonMax)` branch. No
task, file, or DoD line names it — yet the DoD asserts "antimeridian-crossing bbox and
point-in-polygon behavior are tested," which is a checkbox in front of an unspecified
algorithm.

**Fix (either is fine, but pick one):** (a) state the unwrap convention and the max-edge-span
rule as validation rules, and spell out the two-branch candidate predicate; or (b) refuse
antimeridian-crossing rings in v1 with a clear error and let those rows keep circle
matching — the existing `boundingBox()` already handles crossing circles
(`lib/sites/geo.ts:75-95`), so nothing regresses. Option (b) removes an entire class of
subtle bug from a sprint that has plenty already, at the cost of one use case (#6) that has
approximately zero real users.

### W2. `boundaryCrossesAntimeridian` is a derived column that can drift

It's fully determined by the ring, it's a fourth participant in the all-or-none CHECK that
the CHECK cannot actually validate (the constraint can prove presence, not correctness),
and the codebase already has a convention for encoding "this box crosses ±180": `min > max`,
which is what `boundingBox()` returns as two `lonRanges`. Drop the boolean and derive it.
One fewer column, one fewer drift path, no lost capability.

### W3. Anchor-distance ranking makes hand-drawn precision lose to circle proximity

The draft keeps `compareSiteCandidates` untouched — right instinct, wrong consequence
unexamined. A boundary decides *eligibility*; ranking is still distance to the row's anchor
point. So:

> Site A is a 3 km ridge. Its owner draws the ridge; A's anchor sits 1.4 km from this
> flight's takeoff fix, and the fix is inside A's polygon. Site B is a plain circle site
> 500 m away whose 600 m radius also covers the fix. **B wins.** The pilot who drew the
> ridge sees no change at all, and cannot understand why.

The draft anticipates the *question* ("closest edge, centroid, or anchor?") and answers it
by declining to add a second metric — but the failure above isn't about which metric is
better, it's that a row whose owner made an explicit geometric assertion is ranked against
one that never did, using a number that means something different for each.

**Minimal fix that stays deterministic and keeps `compareSiteCandidates` intact:** tier
within each level — polygon-contained candidates sort ahead of circle-only candidates, then
the existing comparator orders within a tier. It's two lines, it's stable, it makes "I drew
this shape" actually mean something, and it needs no new distance semantics.

While there: for a polygon row, `distanceM` can now exceed the row's own radius, and
`LocationMatch.site.distanceM` is documented in `lib/sites/lookup.ts` as "the distance to
the SITE's own coordinate ... for a consistent meaning across both shapes of result." That
comment quietly stops being true. Say what the field means for a polygon match.

### W4. The feature does nothing for flights a pilot has already logged

This is the biggest product gap, and the draft states it as a decision rather than weighing
it: "no `Flight` cache columns are written when a boundary changes ... Future ingest and
explicit backfill use the new geometry," with rematch tooling deferred to another sprint.
Its own use case #1 is written honestly — "*Later* flights along the ridge match the site."

Leaf Log is a logbook. The pilot drawing the ridge is drawing it *because* their existing
flights from both ends read "Unknown site." Under this plan they draw it, save, and nothing
visible happens. The risk table rates this "Medium likelihood / **Low** impact — make v1
copy about 'future matching'." Copy does not fix a feature whose payoff is invisible to the
person who did the work.

The machinery already exists and is well-guarded: `reassociateOwnFlights`
(`lib/sites/repo.ts:228`) is owner-scoped, bbox-prefiltered, capped at `REASSOCIATE_CAP`
(200), logs on truncation, and writes only through `locationCachePatch`.
`scripts/backfill-sites.ts` is not a substitute — it's CLI-only, not pilot-facing, and only
touches flights *missing* an endpoint site.

**Fix:** on boundary save, run the creator's own re-association in the **expand direction
only** — pick up the owner's own currently-unbound flights that fall inside the new polygon;
never un-bind or re-point a flight that already has a binding, and never touch another
pilot's rows. That preserves SPRINT-005's "a gazetteer change only ever adds precision"
rule, reuses an audited writer, and turns use case #1 from a promise into an effect. If it
truly must be deferred, the risk row's impact rating should be Medium/High, not Low.

### W5. No decision about per-endpoint geometry

Circles are deliberately asymmetric by kind — 600 m takeoff / 900 m landing at site level,
300/400 at zone level — because "landings scatter more than launches"
(`lib/sites/geo.ts:8-25`). One polygon per row silently collapses that: a `kind: "both"`
row's ridge outline is applied verbatim to landing matching, where it will be too tight for
exactly the reason the radius asymmetry exists.

The draft never raises this. At minimum, document that a boundary is kind-agnostic and that
asymmetry means using separate rows; better, decide explicitly (an outward buffer for the
landing test, or per-kind boundaries, or "we accept the collapse and here's why").

### W6. Suggestions and the duplicate-name probe stay anchor-based

`suggestNearbyLocations` (`lib/sites/repo.ts:130`) and the in-transaction
proximity-scoped `normalizedName` conflict probe both use `boundingBox(lat, lon,
SUGGEST_RADIUS_M)` around the *anchor*. Neither is in this draft's file list.

Consequence with a 25 km² site polygon: a pilot standing inside the drawn ridge, 3 km from
its anchor, whose flight `findLocation` missed (kind mismatch, or the row was tightened),
opens "name this site" and is offered **nothing** for that site — so they create the
duplicate the suggestion step exists to prevent, and the duplicate-name guard doesn't catch
it either because that too is anchor-scoped. The draft's own decision to allow polygons far
larger than the circle is what creates this; the reuse-first UX has to follow the geometry.

### W7. The zone area cap is loose enough to be an abuse vector

Take the numbers together:

| | circle area | polygon cap | ratio |
|---|---|---|---|
| Zone (takeoff, 300 m) | 0.28 km² | 4 km² | ~14× |
| Zone (landing, 400 m) | 0.50 km² | 4 km² | ~8× |
| Site (takeoff, 600 m) | 1.13 km² | 25 km² | ~22× |

Now compose that with two other decisions the draft makes: a zone boundary **may extend
outside its parent** (decision 6), and any pilot may create a zone under another pilot's
public site (SPRINT-005's community model). Zone-first matching means a single pilot can
draw a 4 km² zone under someone else's public site and capture the label on **every other
pilot's future flights** across an area 3.5× larger than the parent site's own circle. The
remedy is reactive operator clear, after the fact.

The risk table has this row ("Bad public polygons affect other pilots' future matching",
Medium/Medium) and names caps as the mitigation — but the caps are the thing that's too
loose. **Fix:** tie the zone cap to the zone circle (e.g. ≤4× the kind's circle area, ~1-2 km²)
and/or require the zone ring's centroid — or a majority of its area — to fall inside the
parent's geometry. The site cap at 25 km² is defensible; the zone cap at 4 km² is not, given
zone-first priority.

### W8. Geometry edits bypass the community-property model, and record no attribution

Every existing mutation that changes what *other* pilots see is guarded: `deleteSite`,
`unpublishOwnSite`, `deleteZone`, `unpublishOwnZone` all refuse once another pilot's flight
depends on the row (`referencedByOthers` / `zoneReferencedByOthers`,
`lib/sites/associate.ts:285` and below). Redrawing a public boundary changes other pilots'
future matching *more* than a rename does, and this draft applies no analogous guard.

Related: the parent-site owner may set a boundary on a zone they didn't create (a
reasonable extension of SPRINT-005 decision 4), but the schema records only
`boundaryUpdatedAt` — no "set by". An operator triaging a bad boundary can't tell who drew
it, and the zone's creator has no way to know their shape was replaced.

Given the W4 decision (a boundary never un-binds anything), an argument that geometry edits
*don't* need the guard is available and defensible — but the draft should make it, not skip
it. And `boundarySetById` is one nullable column.

### W9. Factual error in the Phase 2 file plan

> `lib/sites/lookup.test.ts` — Unit tests with fake DB candidates for ranking and fallback
> behavior.

It isn't. `lib/sites/lookup.test.ts:1-15` is a `@vitest-environment node` integration test
that **throws** if `DATABASE_URL` is unset ("a skipped matrix means the privacy work this
and the prior sprint establish is unverified"), and it creates real users, sites, and zones.
Polygon cases belong there, which is fine and even good — but they cost integration-test
time, not unit-test time, and CLAUDE.md's "integration tests auto-skip without
`DATABASE_URL`" does not apply to this file.

### W10. The editor's test plan can't run, and its effort share is too small

- `components/sites/boundary-editor.test.tsx` under vitest/jsdom cannot exercise MapLibre —
  no WebGL, no canvas shim in `test/setup.ts`, and the repo has exactly one component test
  today (`components/ui/accent-bar.test.tsx`). "Where practical" is doing a lot of work in
  that line.
- No existing Playwright spec touches a map (`test/e2e/*.spec.ts` contain no map/canvas
  references). "Add an owner drawing and clearing scenario" means clicking vertices on a
  WebGL canvas in headless Chromium — new, and the flakiest possible thing to put in front
  of the `pnpm e2e` gate.
- Phase 3 is 30% for the write API *plus* a drawing tool with vertex add, vertex drag, undo,
  clear, load-existing, mobile touch, and mirrored validation. Phase 4 is 15% for operator
  commands, docs, release notes, **and** all five gates. Those are the wrong way round.

**Fix:** put every rule in `lib/sites/boundary.ts` and test it there (the draft already
structures it this way — lean on it); make the editor a thin shell over that module and
drop the component test file; in E2E, assert the **server-action** path — seed or paste a
boundary, save, verify matching, clear — rather than canvas drags. A "paste GeoJSON"
fallback in the editor is worth considering on its own merits too: it makes the flow
testable, keyboard-reachable, and gives a pilot a way to import a shape they already have.

### W11. The bbox indexes won't do what the draft says they do

```prisma
@@index([boundaryLatMin, boundaryLatMax])
@@index([boundaryLonMin, boundaryLonMax])
```

The containment query is a range predicate on *both* columns (`latMin <= lat AND latMax >=
lat`). A btree can use the leading column's range and then must scan; the second column in
each index is near-decorative, and Postgres will typically pick one index or seq-scan. The
draft asserts these exist "so lookup does not full-scan every polygon-bearing row" — at
realistic counts that's fine because polygon rows will be *few*, but say that, rather than
claiming an index benefit that isn't there.

Two cheap improvements the migration is already raw SQL enough to take: make them **partial**
(`WHERE "boundaryGeojson" IS NOT NULL`) so they stay tiny, and/or store a core-Postgres
`box` column with a **GiST** index — `box` and GiST are in core Postgres, no PostGIS
extension required. The draft's "no PostGIS" framing appears to have taken "no spatial
indexing" with it, and that isn't forced.

### W12. `boundaryGeojson != null` is not expressible as written in Prisma v6

Null filtering on `Json?` fields needs `Prisma.DbNull` / `Prisma.JsonNull`, and it is a
well-known sharp edge. Since the all-or-none CHECK guarantees the columns move together,
filter on `boundaryLatMin` (`null` / `not: null`) instead — a plain `Float?`, no JSON null
semantics involved. Small, but it's the kind of thing that eats an afternoon in the middle
of Phase 2.

### W13. Vertex precision reopens a privacy decision the codebase made deliberately

Site and zone anchors are rounded to 4 dp (~11 m) on create, with an explicit comment:
"not launch-coordinate obfuscation ... this just keeps the public site row from being a
byte-exact fingerprint of one private flight's takeoff fix" (`lib/sites/repo.ts:407`).

The editor "displays the current flight endpoint ... so the pilot can draw in context" — so
the natural drawing gesture traces around, and often snaps to, that exact fix, at full
double precision, on a row that may be public. Round stored vertices the same 4 dp (it also
bounds payload size and makes the ring canonical for comparison).

---

## Gaps in risk analysis

The seven-row table is well-formed, but it is missing the failure modes most likely to
actually bite:

- **No rollback or kill switch.** `findLocation` runs on every ingest for every pilot
  (`lib/ingest/ingest-flight.ts:82`). If polygon matching misbehaves in production, the only
  remedy in this plan is clearing boundaries one row at a time via the operator script. The
  design already guarantees circle-only behavior is byte-equivalent to SPRINT-005 — so one
  config flag that makes lookup ignore boundaries is a near-free instant revert. Ask for it.

- **"No retroactive effect" is rated Low impact** (§W4). It's the single most likely
  user-visible disappointment of the sprint.

- **No row for the ranking interaction** (§W3) — a polygon that is eligible but outranked is
  indistinguishable, to the pilot, from a polygon that didn't work.

- **No migration/deploy risk.** Railway runs `prisma migrate deploy` pre-deploy
  (`railway.toml`); a CHECK constraint that rejects existing data, or a raw-SQL statement
  that fails, blocks the deploy. Also worth a line: the new columns must be tolerable to the
  *previous* app version during the rollout window (they are — all nullable — but say so),
  and `prisma/schema.prisma` drift against the raw CHECK is a known accepted cost that
  needs the same migration comment SPRINT-005 used.

- **No rate limit on boundary writes.** Creates are capped (`DAILY_CREATE_CAP = 10`,
  `lib/sites/repo.ts:86`); boundary saves are uncapped, so a public boundary can be
  rewritten in a loop. Cheap to bound.

- **`admin-sites merge` has undefined boundary semantics.** The draft modifies
  `scripts/admin-sites.ts` but never says what `merge` / `zone-merge` does with the loser
  row's boundary — silently discard, or transfer if the winner has none? Both are defensible;
  neither is stated, and the merge path is exactly where an operator cleaning up duplicates
  will hit it.

- **The PostGIS escape hatch is undermined by not normalizing ring winding.** The mitigation
  for "JSONB gets slow" is "GeoJSON is already the authoritative value, migrate later." But
  Postgres `geography` interprets a reversed ring as the *complement* of the intended shape,
  so an un-normalized winding order turns that future migration into a data-correctness
  problem. Canonicalize winding (RFC 7946 right-hand rule) at write time — one line now,
  and it also makes rings comparable for dedup.

- **Non-issue worth closing:** client-bundle cost. The editor lives on the flight detail
  page, which already ships `maplibre-gl` statically (`components/flight/track-map.tsx`,
  `flight-replay-3d.tsx`), so there's no new payload on any other route. The draft doesn't
  say this; one sentence retires the question.

---

## Missing edge cases

The intent asked the drafts to expand its list. This one covers vertex/edge inclusivity,
degeneracy, self-intersection, antimeridian, zone-outside-parent, and complexity caps —
good coverage. Still open:

1. **Vertex handling inside the ray-cast itself.** "Point-on-edge is inside" is stated as a
   rule but not as an algorithm. Naive ray-casting gives nondeterministic results when the
   ray passes exactly through a vertex; the standard fix is a half-open edge rule plus an
   explicit on-segment test *before* the crossing count. The DoD claims this is tested; no
   task says how it's implemented.

2. **Area formula and thresholds are unspecified**, yet they're enforcement rules. Spherical
   excess, or shoelace on an equirectangular projection at the polygon's mean latitude? The
   latter degrades near the poles — where `boundingBox()` already carries a `cosLat` clamp
   for exactly this reason (`lib/sites/geo.ts:70`). Same for "near-zero-area is rejected":
   near-zero relative to what? And "polygons spanning half the globe are rejected by the
   area/span checks" — what span check?

3. **Near-pole polygons** have no equivalent of the circle path's clamp.

4. **Self-touching rings.** "No self-intersections" must define whether adjacent segments
   sharing an endpoint count, whether a vertex repeated mid-ring is rejected, and whether
   duplicate/collinear vertices are stripped *before* the "≥3 distinct vertices" test (a
   zero-width spike passes a naive distinct-count check).

5. **A row whose anchor lies outside its own boundary.** Nothing forbids it, and the anchor
   still drives ranking (§W3) and `reassociateOwnFlights`'s bbox. Legal in this design, and
   quietly strange — decide and document.

6. **A zone polygon that doesn't overlap its parent's geometry at all** (allowed by decision
   6). Zone-first then returns zone Z *and* parent site S for a point S's own geometry
   excludes — so the cached, displayed pair is "Mission Ridge — North Launch" for a fix that
   isn't in Mission Ridge by Mission Ridge's own definition. That's the direct consequence of
   decision 6 and deserves a sentence in the architecture doc.

7. **Two overlapping same-level polygons both containing the point** — resolved
   deterministically by anchor distance, but not in any listed test.

8. **Kind gating for polygon rows.** The flow diagram keeps `kindMatches`; the Phase 2 task
   list doesn't mention it. Easy to lose when the candidate query is split into two branches.

9. **Orphaned rows** (`ownerId = null` after a profile delete, via `onDelete: SetNull`): only
   the operator can ever set or clear their boundary. Fine — but any new permission helper
   must not let `null === null` become an owner match. The existing code is safe by
   construction; a new helper is where that regresses.

10. **Concurrent edits** by the zone owner and the parent-site owner: last-write-wins.
    `boundaryUpdatedAt` is written and never read — either use it for an optimistic-concurrency
    check, or say it's for operator triage only.

11. **Editing a boundary someone else drew** (the cross-owner case): does the editor load
    their shape, warn, or start blank? Unspecified, and it's the interaction most likely to
    generate a support message.

12. **Delete/cascade with boundaries** — nothing special is needed (columns go with the row),
    but the existing delete guards are unchanged and one line closing this is cheaper than a
    reviewer re-deriving it.

---

## Definition of Done completeness

**Present and genuinely good:** circle-row regression, both directions of polygon effect
(expand and tighten as separate lines), zone-first + mandatory site fallback, inclusivity,
server-side rejection of degenerate/self-intersecting/oversized/over-complex rings,
antimeridian, no private-boundary leak through lookup/display/actions/suggestions/response
bodies, owner-scoped writes with indistinguishable errors, no flight-cache mutation,
operator clear for both levels, `/whats-new`, architecture doc, five gates.

**Missing:**

- **The performance target.** p95 < 50 ms at 5k sites / 10k zones appears as a Phase 2 task
  and nowhere in the DoD — despite being the one success criterion the intent singled out
  for explicit definition. Promote it.
- **"The server rejects client-supplied bbox, area, kind, ownerId, and visibility."** In the
  Security section, not in the DoD. It's the most direct expression of "the server is
  authoritative" and it's testable.
- **Client/server validation parity.** A client that accepts what the server rejects is the
  editor's single most likely bug, and Phase 3 mandates mirrored validation with no DoD line
  behind it.
- **"The naming dialog's create / reuse / skip behavior is unchanged."** A Phase 3 task only.
  Given the dialog is the highest-traffic owner surface, it deserves a DoD line and an E2E
  assertion.
- **A negative permission case.** "Owner-scoped" is checked; "a pilot who owns neither the
  row nor the parent site gets the indistinguishable not-found error, and no write occurs"
  is not. Same for the positive cross-owner case (parent-site owner edits a zone boundary).
- **The all-or-none CHECK is actually exercised.** The suite already has precedent for
  hand-writing a row a constraint would block (`test/sites.integration.test.ts:1353`); an
  attempted half-written boundary row should fail.
- **Migration is additive and rollout-safe** — new columns nullable, previous app version
  tolerates them, `prisma migrate deploy` succeeds against production-shaped data.
- **A rollback statement.** See the risk gaps above.
- **`reassociateOwnFlights` / `suggestNearbyLocations` behavior** — consistent with the
  draft's current scope, but if §W4 and §W6 are accepted, both need DoD lines.

**Structural note:** the DoD is a flat list against four "Phases," and the phases have no PR
boundaries. SPRINT-004 (PRs #36-40) and SPRINT-005 (PRs #41-44) both shipped as sequenced
PRs with a deliberate ordering — schema + lookup, then the security/firewall work, *then*
UX, then undo/operator/release — so that no user could create the new object type before the
matrix protecting it existed. This draft's Phase 3 bundles the write API and the drawing UI
into one unit, and no phase carries its own gate. Restating the plan as PR1-PR4 with
per-PR DoD subsets, security before UX, would bring it in line with the two sprints it
extends and make the merge doc's structure fall out for free.

---

## What to keep, in merge order

1. Keep, unchanged: jsonb + derived bbox (no PostGIS), boundary-replaces-circle,
   boundary-is-not-a-privacy-axis, one ring only, drawing outside the naming flow,
   `clear-boundary` / `zone-clear-boundary`, the whole Security section, the stated perf
   target.
2. Resolve before implementation: §W1 (antimeridian — recommend refusing it in v1), §W3
   (tier polygon-contained ahead of circle-only), §W4 (expand-only re-association on save),
   §W7 (tighten the zone cap or require parent containment).
3. Fold in cheaply: drop `boundaryCrossesAntimeridian` (§W2), filter on `boundaryLatMin`
   not the Json column (§W12), round vertices to 4 dp (§W13), canonicalize winding, partial
   indexes, `boundarySetById`, a kill switch, a boundary-write rate limit, and a stated
   `merge` rule for boundaries.
4. Rework: the editor's test strategy and the Phase 3/4 effort split (§W10); per-kind
   geometry decision (§W5); suggestions/duplicate-probe geometry awareness (§W6);
   PR sequencing.
