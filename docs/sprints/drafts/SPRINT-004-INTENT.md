# Sprint 004 Intent: User-generated site locations

## Seed

Let a pilot name a new **takeoff or landing site** from a flight whose reverse-lookup
returned "Unknown site", and save it as **public** (shared into the community
gazetteer) or **private** (only theirs). Afterwards, any flight whose takeoff/landing
falls close enough auto-associates with that site instead of leaving it unknown or
creating a near-duplicate — and when a pilot creates a site near an existing one, the
app offers to reuse it rather than make a duplicate.

Backlog entry: `FEATURES.md` → "User-Defined Takeoff Sites (public/private,
auto-associate)" (Priority: Medium).

## Context

- **Leaf Log is a private-first flight logbook**, the official companion to the Leaf
  vario. Three sprints shipped and deployed to Railway: SPRINT-001 (logbook
  foundation, IGC ingest, sites, public profiles), SPRINT-002 (geotagged photos),
  SPRINT-003 (social: friend graph, friends-only visibility, kudos, feed). An
  unnumbered device workstream (PRs #28–31) added Leaf auto-upload over HTTPS.
- **Sites today are a read-only curated gazetteer.** `prisma/seed.ts` inserts 12
  well-known free-flight sites (`source: "manual"`, `license: "curated"`), and
  `lib/sites/lookup.ts` matches a coordinate to the nearest one. There is no way for a
  pilot to add a site; unmatched flights render the honest string "Unknown site".
- **This sprint introduces the app's first user-generated *shared* content.** Every
  prior user-authored artifact (flights, photos, kudos) belongs to exactly one pilot.
  A **public** site is authored by one pilot and consumed by all of them — a new
  category that brings naming quality, duplicates, and abuse into scope for the first
  time.
- **Privacy is app-layer, not RLS.** Every flight read goes through the viewer-scoped
  `lib/flights/repo.ts`. Sites have no equivalent scoping because they have never been
  private. This sprint must extend that discipline to sites without weakening it for
  flights.
- **`Flight` denormalizes the site name** (`takeoffSiteName`, `landingSiteName`) so
  list queries stay fast. That denormalization is the sharpest privacy hazard in this
  sprint — see Open Questions.

## Recent Sprint Context

- **SPRINT-001** established the ingestion seam `ingestFlight({ source, ownerId, bytes })`
  as the single source-agnostic path (parse → derive → site lookup → persist, one
  transaction). Site lookup happens *inside* it, at line `lib/ingest/ingest-flight.ts:71`.
- **SPRINT-003** established the pattern this sprint should imitate: a visibility tier
  enforced **exclusively** in a viewer-scoped repo, a central `normalizeVisibility`
  helper with a runtime allowlist that fails closed, a DB CHECK constraint in
  hand-written SQL (Prisma v6 can't express CHECKs), and an integration test matrix
  that CI actually runs against Postgres.
- **Device workstream** made `ingestFlight` a two-caller seam (web upload + device
  push). Any signature change to site lookup must keep both callers correct, and the
  device path has no interactive UI to fall back on.

## Relevant Codebase Areas

| Area | Notes |
|------|-------|
| `prisma/schema.prisma` → `model Site` | `id` (cuid), `name`, `kind` (`takeoff\|landing\|both\|unknown`), `lat`, `lon`, `countryCode?`, `region?`, `source` (default `"manual"`), `sourceId?`, `sourceUrl?`, `license?`, `createdAt`. Index `[lat, lon]`. **No `ownerId`, no `visibility`, no uniqueness on `name`.** |
| `lib/sites/lookup.ts` | `findSite(db, lat, lon, kind)` — padded lat/lon bbox prefilter (indexed) then true haversine rank. `TAKEOFF_RADIUS_M = 600`, `LANDING_RADIUS_M = 900`. Matches `kind` or `"both"`. Takes `Pick<Db, "site">`, so it is **not viewer-scoped**. |
| `lib/sites/lookup.test.ts` | Existing pure unit tests for the matcher. |
| `lib/ingest/ingest-flight.ts:71` | Calls `findSite` twice (takeoff + landing) and denormalizes `takeoffSiteId`/`takeoffSiteName`/`landingSiteId`/`landingSiteName` onto the `Flight` row. |
| `lib/flights/repo.ts` | The viewer-scoped read seam. `LIST_SELECT` already ships `takeoffSiteName` + `takeoffSiteId` to lists and the feed. |
| `components/flight/flight-header.tsx:7`, `components/logbook/flight-row.tsx:52` | The two `?? "Unknown site"` render sites — the natural entry points for "name this site". |
| `app/flights/[id]/page.tsx:27` | Has `isOwner`; owner-only affordances already live here. |
| `prisma/seed.ts` | 12 curated sites, idempotent by name. |
| `scripts/backfill-sites.ts` | Re-runs `findSite` over existing flights — the precedent for retroactive re-association. |
| `prisma/schema.prisma` → `Profile.homeSiteId` | **Exists in the schema, referenced nowhere in app code.** Dormant; `onDelete: SetNull`. Decide in/out of scope. |
| `lib/prisma.ts` | Short-id extension applies to `Flight` only ("Only `Flight` is URL-visible"). If sites get URLs, that decision needs revisiting. |
| `lib/flights/visibility.ts` | `normalizeVisibility` — the fail-closed normalizer pattern to imitate. |

## Constraints

- **`CLAUDE.md` working agreement**: never commit to `main`; feature branch + PR; ask
  before committing or merging; squash-merge.
- **Validation gates before any commit/PR**: `pnpm build`, `pnpm test`, `pnpm typecheck`,
  `pnpm lint`, `pnpm e2e`.
- **Privacy is app-layer.** No RLS. Any private-site read must be scoped in a repo
  module, never ad-hoc in a page or route. The existing flight invariant must not
  regress.
- **Ingestion seam is sacred.** Parse/derive/persist logic stays out of routes;
  `ingestFlight` remains the single path for both web upload and device push.
- **Pure geo/matching logic stays free of DB/Next imports** so it stays unit-testable,
  as `lib/igc/` and the current matcher do.
- **Prisma v6 pinned** (v7 removed `url` from the datasource). CHECK constraints must
  be hand-written in the migration SQL.
- **Next 16 conventions** — read `node_modules/next/dist/docs/` before writing code;
  middleware is `proxy.ts`, `cookies()` is async.
- **Every user-facing release adds a `lib/whats-new.ts` entry** (newest first) before
  deploy. `FEATURES.md` is the separate developer-facing log.
- **Migrations are hand-written SQL directories** under `prisma/migrations/`.

## Success Criteria

1. A pilot viewing their own flight with an unmatched takeoff **or** landing can name
   that location and save it as a **public** or **private** site, in-place, without
   leaving the flight page.
2. The flight immediately shows the new site name in place of "Unknown site" — on the
   flight page, in the logbook, and anywhere else the denormalized name renders.
3. A later flight (the same pilot's, or — for a public site — anyone's) whose
   takeoff/landing falls inside the kind-appropriate radius auto-associates with the
   existing site instead of showing "Unknown site". This works identically for
   device-pushed flights, which have no interactive UI.
4. Creating a site near an existing visible one **offers to reuse it** rather than
   silently inserting a near-duplicate.
5. **A private site is never visible to anyone but its owner** — not through site
   lookup, not through search, and *not through a public flight's denormalized site
   name*. This is the sprint's headline privacy invariant and must be enforced in one
   auditable place with an integration-test matrix that CI runs.
6. All five gates green; a `/whats-new` entry written; `FEATURES.md` updated.

## Verification Strategy

- **Reference implementation:** none. Correct behavior is defined by this document
  plus the existing matcher semantics in `lib/sites/lookup.ts` (which must not
  regress for curated sites).
- **Pure unit tests** (`lib/sites/*.test.ts`, no DB): radius boundaries at and just
  outside 600 m / 900 m, `kind` filtering, bbox-vs-haversine agreement, antimeridian
  and high-latitude `cosLat` behavior, name normalization/validation.
- **Integration tests against Postgres** (`test/sites.integration.test.ts`, following
  `test/privacy.integration.test.ts`): the visibility matrix — owner / friend /
  stranger / anonymous × private site / public site × site-as-lookup-candidate and
  site-name-on-a-visible-flight. **Fail-closed assertions on empty sets** (a test that
  passes because nothing was returned must be distinguishable from one that passes
  because the right thing was returned).
- **Ingest-path tests**: a device-pushed flight resolves against a public site and
  against the owner's own private site, and never against a stranger's private site.
- **E2E (Playwright)**: the happy path — upload a flight with an unknown site, name
  it, see it render, upload a second nearby flight, see it auto-associate.
- **CI must provision Postgres** so the matrix actually runs rather than auto-skipping
  (the SPRINT-003 precedent — a skipped privacy suite means the security work is
  unverified).

## Uncertainty Assessment

- **Correctness uncertainty: Medium.** The geo matching itself is well understood and
  already implemented; the radii are already chosen and justified. The real correctness
  risk is the **denormalized `takeoffSiteName`/`landingSiteName` on `Flight`** — a
  cached copy of data that is about to become access-controlled. Every read path that
  ships that string (list, feed, flight page, profile) becomes a potential leak, and
  the leak is silent.
- **Scope uncertainty: Medium.** The core loop (name it → save it → match it) is clear
  and bounded. What is genuinely open is everything orbiting it: moderation of public
  names, edit/rename/delete rights, merging duplicates, retroactive re-association of
  *existing* flights, promoting a private site to public, site pages/URLs, and whether
  `Profile.homeSiteId` finally gets wired up. Each is defensible as v1 or as deferred.
- **Architecture uncertainty: Medium.** The privacy half extends a proven pattern
  (viewer-scoped repo, fail-closed normalizer, DB CHECK) and should be low-drama. The
  new-ground part is that **public sites are the app's first shared user-generated
  artifact**: one pilot's typo or joke name becomes every pilot's logbook entry, and
  there is no moderation surface in the product today.

## Open Questions

Questions the drafts should each answer with a concrete recommendation:

1. **The denormalization leak.** `Flight.takeoffSiteName` is a cached copy. If a pilot
   names a **private** site and that flight is (or later becomes) public or
   friends-visible, the private site's name renders to viewers who may not read the
   site. How is this closed — resolve names through the viewer-scoped repo instead of
   the cached column, null the cached name for non-public sites, forbid private sites
   on non-private flights, or something better? What happens on *transition* (flight
   visibility changed after the fact; site promoted private→public)?
2. **Viewer-scoping `findSite`.** It currently takes `Pick<Db, "site">` and no viewer.
   What is the new signature, and how do both `ingestFlight` callers and
   `scripts/backfill-sites.ts` adapt? Does the ingest path scope to the *owner*
   (public sites ∪ owner's private sites) — and is owner-scoping at write time the
   right notion when the *reader* may be someone else?
3. **Public site creation: open or gated?** Immediate publication, or owner-private
   until some signal? Who can rename or delete a public site once other pilots' flights
   reference it? Is any moderation/report surface in v1, or an explicit non-goal with
   the risk accepted and logged?
4. **Retroactive re-association.** When a site is created, which existing flights get
   re-matched — only the creating flight, all the creator's unmatched flights, or
   everyone's (for a public site)? Synchronous or a background pass? What does the
   existing `scripts/backfill-sites.ts` become?
5. **Dedup / snap-to-existing UX.** On create, run `findSite` at the coordinate first.
   If a visible site matches, what exactly does the pilot see and what are their
   choices? Does the reuse radius equal the match radius (600 m / 900 m) or should it
   be wider to catch near-duplicates the matcher would miss?
6. **Which coordinate is the site's?** The flight's exact takeoff fix, a snapped or
   rounded point, or a pilot-adjustable marker on the map? Exact fixes are precise but
   encode where one pilot happened to launch — and a private takeoff coordinate is
   itself location data.
7. **Site `kind`.** The pilot names a location from either a takeoff or a landing.
   Does creating from a takeoff produce `kind: "takeoff"` or `"both"` (the seed leans
   heavily on `"both"`)? Can a site later become `"both"` when someone lands where
   another launched?
8. **Surface area.** Do sites get pages/URLs (`/sites/<id>`), a browse/search UI, or
   stay invisible plumbing that only surfaces as a name on a flight? Note `lib/prisma.ts`
   restricts short ids to `Flight` — "only `Flight` is URL-visible" — so a site page
   reopens that decision.
9. **`Profile.homeSiteId`** exists in the schema and is referenced nowhere in app code.
   In scope (wire it up now that pilots can create sites) or explicitly out?
10. **Naming rules.** Length, character set, uniqueness (global? per-region? none?),
    case/whitespace normalization, and what stops "Unknown site" or an empty string
    from becoming a real site name.
