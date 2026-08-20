# Sprint 005 Intent: Two-level site hierarchy — Site + Zone

## Seed

SPRINT-005 — Two-level site hierarchy: Site + Zone

Context: SPRINT-004 just shipped user-generated Site locations (PRs #36-40), where a Site
is a flat point (lat/lon, name, kind takeoff|landing|both, source manual|user, ownerId,
visibility, normalizedName) that flights auto-match to on ingest by proximity. Production
currently has zero Site rows (curated seed was removed in PR #40 and no pilot has named a
site yet), so there is no legacy data to migrate — this is a clean design problem, not a
backfill.

The insight: real flying sites have one overall named location (e.g. "Mission Ridge")
containing multiple distinct launch/landing spots underneath it (e.g. "North Launch",
"South Bowl", "Lower LZ"). Today's flat Site model conflates these two levels.

Locked-in design decisions from stakeholder conversation (do not re-litigate these, treat
as committed scope):

1. Introduce a two-level hierarchy: Site (the overall named location) and Zone (a specific
   launch/landing spot within a site).
2. A Zone must belong to exactly one Site (`Zone.siteId` required, not nullable). A Site
   can exist standalone with zero zones.
3. Proximity matching on flight ingest happens at the Zone level first (nearest zone
   within its radius), rolled up to display the parent Site (e.g. flight shows "Mission
   Ridge — North Launch"). **If a Site has no zones under it at all, a flight must still
   be able to match directly to that Site by proximity (Site-level fallback)** — a bare
   site with no zones must remain fully functional for matching and display, not a rare
   edge case.
4. Reuse and extend as much of the SPRINT-004 machinery as sensible: ownership/visibility
   model, the viewer-scoped read-path firewall in `lib/flights/repo.ts`, the "name this
   site" flow on the flight page, the creator-undo/operator-remedy pattern, `kind`
   (takeoff|landing|both) semantics — now likely living primarily on Zone rather than Site.

## Context

- Leaf Log is a private-first flight logbook for the Leaf vario (Next.js 16 App Router,
  Prisma 6, Postgres, NextAuth v5). See `CLAUDE.md` / `AGENTS.md` for house rules.
- Privacy is enforced app-layer, not via RLS: **every** flight read must go through the
  viewer-scoped repo (`lib/flights/repo.ts`) — `getFlightForViewer` / `listPublicFlights`
  / `listOwnFlights`. This constraint carries over directly to Site/Zone reads.
- SPRINT-004 (just shipped, PRs #36-40) built the entire current Site feature: ownable,
  visibility-scoped sites; a read-path firewall that re-verifies every site id per viewer
  on every read (never trusts the denormalized name cache); a "name this site" flow on the
  flight page (reuse-first, 2km radius, dedup, concurrent-create guard); creator undo
  (unpublish/delete) with an operator-remedy script once community-owned; retroactive
  re-association of a creator's own older unmatched flights (capped at 200); and removal
  of the curated 12-site seed (PR #40) — sites are now fully community-driven.
- Production has **zero** `Site` rows today. Local dev has 11 (`source='user'`) from
  testing. This means SPRINT-005 is free to redesign the schema without a real-data
  migration story — no backward-compat shim needed for production.

## Recent Sprint Context

- **SPRINT-001-003**: core logbook (IGC ingest, flight detail, 3D replay), social
  (friends, kudos, feed), Leaf device auto-upload. All shipped and deployed.
- **SPRINT-004** (`docs/sprints/SPRINT-004.md`, PRs #36-40): user-generated Site
  locations — the system this sprint extends. Key artifacts to reuse/extend:
  - `prisma/schema.prisma`: `Site` model (`ownerId`, `visibility`, `normalizedName`,
    `source`, `kind`, `takeoffFlights`/`landingFlights` relations) and `Flight`'s
    `takeoffSiteId`/`takeoffSiteName`/`landingSiteId`/`landingSiteName` columns (the name
    columns are a denormalized cache, "kept for history" per schema comment — the read
    path re-verifies the id against the live row on every display read).
  - `lib/sites/lookup.ts` — `findSite()`: indexed lat/lon bounding-box prefilter → haversine
    ranking (`lib/sites/geo.ts`) → kind-aware radius (takeoff 600m / landing 900m) →
    visibility-scoped query (public OR private-owned-by-viewer).
  - `lib/sites/associate.ts` — `siteCachePatch()` (the sole writer of the four
    denormalized Flight columns, enforced by an audited allowlist test) and
    `resolveSiteCache()` (re-reads the matched site inside the ingest transaction to guard
    a demote/delete race between match and write).
  - `lib/sites/repo.ts` — the "name this site" create-or-bind flow (reuse-first dedup,
    widens an opposite-endpoint reuse to `kind:"both"`, concurrent-duplicate guard,
    `reassociateOwnFlights`), creator undo.
  - `lib/sites/name.ts`, `lib/sites/visibility.ts` — name validation/normalization,
    visibility rules.
  - `lib/flights/repo.ts` — the viewer-scoped read path; strips both id and name when the
    viewer may not see a private site.
  - `lib/ingest/ingest-flight.ts` — the single source-agnostic ingest seam
    (`ingestFlight({ source, ownerId, bytes })`) that calls `findSite` for both endpoints
    and writes the resolved cache inside the create transaction.
  - `scripts/admin-sites.ts` — the operator remedy (rename / force-private / merge) for
    once-community-owned sites, since there's no moderation queue.

## Relevant Codebase Areas

- `prisma/schema.prisma` — `Site` and `Flight` models (see above); will need a new `Zone`
  model and a decision on what `Flight.{takeoff,landing}SiteId` FKs to.
- `lib/sites/` — `lookup.ts`, `associate.ts`, `repo.ts`, `name.ts`, `visibility.ts`, and
  their test files (`lookup.test.ts`, `visibility.test.ts`, `write-audit.test.ts`,
  `geo.test.ts`, `name.test.ts`) — all directly affected by a two-level model.
- `lib/flights/repo.ts` — the privacy firewall; must be extended to re-verify Zone (and
  its parent Site) visibility per viewer, not just Site.
  - `docs/sprints/SPRINT-004.md` — read for the privacy-matrix pattern (owner/friend/
  stranger/anonymous × private/public × flight-visibility) that any new Zone-level
  visibility model must satisfy or extend.
- Flight page UI (the "name this site" flow's frontend) — wherever SPRINT-004 built the
  naming form; will need a "which site is this part of" step if zone creation becomes
  two-step.
- `scripts/admin-sites.ts` — likely needs a Zone-aware counterpart or extension.

## Constraints

- Follow `CLAUDE.md` git workflow: feature branch + PR, no direct commits to `main`.
- Validation gates before any PR: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
  `pnpm e2e`.
- Privacy is app-layer only (no RLS) — every new read path touching Zone/Site must go
  through a viewer-scoped repo function, mirroring the SPRINT-004 firewall pattern. Never
  query `prisma.site`/`prisma.zone` directly for display without an explicit viewer scope.
- Prisma pinned to v6 (not 7).
- Ingestion stays source-agnostic through `lib/ingest/ingest-flight.ts` — web upload and
  device push must both pick up zone-level matching for free, no route-specific logic.
- Every user-facing release needs a `/whats-new` entry (`lib/whats-new.ts`).
- No moderation model exists (a deliberate SPRINT-004 decision) — SPRINT-005 should not
  reintroduce one; reuse the creator-undo + operator-remedy pattern instead.

## Success Criteria

- `Zone` exists as a schema-level concept: belongs to exactly one `Site`, cannot exist
  without one.
- A flight ingest (web or device push) matches to the nearest **zone** when the winning
  site has zones, and falls back to matching the **site** directly when it has none —
  with no dead ends: every previously-matchable case (a bare site, exactly as SPRINT-004
  produces today) keeps working with zero behavior change from a pilot's perspective.
- The flight page can display a two-level name ("Mission Ridge — North Launch") when a
  zone matched, and a single-level name ("Mission Ridge") when only the site matched —
  both correctly viewer-scoped (private zone/site names never leak through the cache to a
  viewer who shouldn't see them, extending the SPRINT-004 privacy matrix).
- The "name this site" flow lets a pilot either create a new site (optionally with a first
  zone) or add a zone to an existing site they can see, with the same reuse-first,
  dedup-guarded, concurrency-safe semantics SPRINT-004 established at the site level.
- All SPRINT-004 test suites (`lookup.test.ts`, `visibility.test.ts`,
  `write-audit.test.ts`, the privacy integration matrix) pass, extended to cover the Zone
  layer — not just adapted to compile.

## Verification Strategy

- Reference implementation: none external — this is a from-scratch domain design;
  correctness is defined by the locked-in decisions above plus the SPRINT-004 privacy
  guarantees, which must not regress.
- Spec/documentation: the merged SPRINT-005.md itself, following the SPRINT-004.md format
  (Overview → anchoring decisions → committed v1 scope → explicitly out-of-scope with
  reasons → phased PR breakdown).
- Edge cases to explicitly handle in the draft:
  - Site with zero zones (must still match/display — this is the common near-term case
    since it's the default for anything migrated from SPRINT-004-era thinking).
  - Site with one zone vs. multiple zones of the same kind (e.g. two takeoff zones).
  - A flight's takeoff and landing resolving to zones under two different sites, the same
    site (different zones), or the same zone.
  - Private zone under a public site, and public zone under a... can a site be private
    with a public zone? (Open question below — the draft should propose an answer.)
  - Deleting/unpublishing a zone when it's the last zone under a site, vs. when other
    zones remain, vs. when the site itself still has flights directly matched to it.
  - Concurrent zone creation under the same site (mirroring SPRINT-004's concurrent
    duplicate-site guard).
- Testing approach: unit tests for zone-aware `findSite`/matching logic and geo radius
  behavior (extend `lookup.test.ts`, `geo.test.ts`); a privacy-matrix integration test
  extended to the Zone dimension (extend the existing Postgres-backed privacy suite);
  the CI leak sweep SPRINT-004 introduced should be extended to assert no private zone
  name/id leaks either.

## Uncertainty Assessment

- Correctness uncertainty: **Low** — the domain (proximity matching, viewer-scoped reads)
  is well-understood from SPRINT-004; this sprint is compositional, not novel algorithmi-
  cally.
- Scope uncertainty: **Medium** — the hierarchy itself is locked in, but several
  second-order questions (Zone visibility inheritance vs. independence, exact FK shape on
  Flight, UX flow for zone creation, radius tuning) are open and materially change the
  size of the change.
- Architecture uncertainty: **Medium** — extends an existing, well-tested pattern (the
  SPRINT-004 read-path firewall and matching pipeline) rather than introducing a new one,
  but doing so correctly across two levels of visibility inheritance is the main risk
  area; get this wrong and it's a privacy leak, not just a UX bug.

## Open Questions

1. Does `Zone` get its own `ownerId`/`visibility`, or does it always inherit its parent
   `Site`'s visibility? (If independent: can a private zone exist under a public site, or
   a public zone under a private site — and what does each mean for a viewer?)
2. What does `Flight.takeoffSiteId`/`landingSiteId` point to going forward — the `Zone`
   id, the `Site` id, or both (a `Site` FK plus an optional `Zone` FK)? This directly
   drives how the denormalized `*SiteName` cache is shaped (one string vs. two) and how
   much of the existing SPRINT-004 privacy-matrix test suite can be extended vs. rewritten.
3. How does the "name this site" UX change? Single-step (pick/create a site, zone
   creation implicit) or two-step (pick/create a site, then pick/create a zone within it)?
   Does reuse-first dedup apply at both levels?
4. Should zone-level matching use a tighter radius than today's takeoff (600m) / landing
   (900m) site radius, with a separate (wider, or identical) radius for the site-level
   fallback when no zones exist?
5. Should `Site` gain a denormalized "has zones" convenience flag, or is that always
   derived from a live query/relation count? (Matters for the matching hot path.)
6. Local dev's 11 existing `source='user'` Site rows aren't a production concern, but do
   they need a dev-only migration/reset story so the local environment isn't left in a
   half-upgraded state, or is a `prisma migrate reset` + reseed acceptable?
