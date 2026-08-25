# Sprint 008 Intent: Hide zones (sites only, for now)

## Seed

From the user, verbatim: "for now, let's go ahead and remove zones... we will
just keep sites. the zones are getting too complicated."

Locked by an explicit interview answer: this is a **hide, not a delete**.
The `Zone` table, its rows, `Flight`'s zone columns
(`takeoffZoneId`/`takeoffZoneName`/`landingZoneId`/`landingZoneName`), and
every existing zone-aware code path (matching, boundaries, community
ownership) stay exactly as they are in the database and codebase. What
changes is the **product surface**: a pilot should no longer be able to
create, see, edit, match against, or otherwise interact with a zone
anywhere in the app. This must be cleanly reversible — a future "bring
zones back" sprint should only need to re-expose existing, already-tested
UI/matching, not reconstruct anything.

## Context

- Leaf Log's location model is `Site` (required) → `Zone` (optional, a
  specific launch/landing spot within a site), introduced by SPRINT-005.
  SPRINT-006 added custom GeoJSON boundaries to both levels. SPRINT-007
  (merged as PR #47, the immediately prior sprint) added community
  ownership — audit log, contributor roster, endorsements, community-edit
  v1 — to both levels too.
- Zones are woven through more of the codebase than any single other
  concept added since SPRINT-004: matching (`lib/sites/lookup.ts`), the
  naming dialog (`components/flight/name-site-dialog.tsx`), the boundary
  editor, the new community dialog, three server-action files, the operator
  CLI, and four+ test files.
- There is exactly one existing precedent for a centralized, env-read,
  reversible kill switch in this codebase: SPRINT-006's
  `SITE_BOUNDARY_MATCHING=off` (`lib/sites/lookup.ts`, read fresh via
  `process.env`, not cached) — a strong candidate pattern to reuse or
  mirror for zones, rather than inventing a new mechanism.

## Recent Sprint Context

- **SPRINT-005**: two-level `Site` → `Zone` hierarchy. `findLocation` does a
  mandatory zone-first pass, then a mandatory site fallback pass — "no dead
  ends" was a locked-in decision. Zone visibility is independent of its
  parent's (a conjunction, not inheritance).
- **SPRINT-006**: custom GeoJSON boundaries, identical shape on `Site` and
  `Zone`.
- **SPRINT-007**: community ownership — audit log, derived contributor
  roster, endorsements, community-edit v1 — again identical shape on both
  levels. Just merged; no production deploy/soak time yet.

## Relevant Codebase Areas

- `lib/sites/lookup.ts` — `findLocation`'s zone-first/site-fallback matching
  pass; `boundaryMatchingEnabled()`'s existing kill-switch pattern.
- `lib/sites/repo.ts` — `createOrAttachSiteFromFlight` (optional zone
  alongside site), `suggestNearbyLocations` (nests zones under sites).
- `components/flight/name-site-dialog.tsx` — `ZoneStep`, the "Which spot?"
  step, the owner-scoped picker's zone listing.
- `components/flight/boundary-editor.tsx` — zone-level boundary editing.
- `components/flight/location-community-dialog.tsx` — zone-level
  contributors/history/endorsement.
- `app/flights/[id]/site-action.ts`, `boundary-action.ts`,
  `community-action.ts` — zone-parallel server actions.
- `scripts/admin-sites.ts` — `zone-rename`/`zone-force-private`/
  `zone-merge`/`zone-boundary-clear`/`zone-audit` operator commands.
- `lib/sites/lookup.test.ts`, `test/sites.integration.test.ts`,
  `test/community.integration.test.ts`, `scripts/admin-sites.test.ts`,
  `test/e2e/zones.spec.ts`, `test/e2e/boundaries.spec.ts`,
  `test/e2e/community.spec.ts` — existing zone-specific coverage.

## Constraints

- **No schema change, no data migration, no destructive operation of any
  kind.** This is the single hardest constraint — it rules out dropping
  columns/tables and rules out backfilling `takeoffZoneName` to null, etc.
- **Reversible with minimal future effort.** The mechanism chosen should
  make "bring zones back" a matter of flipping one thing, not re-deriving
  logic or re-writing tests.
- **Existing zone-bound flights must keep behaving sanely.** A flight
  already showing "Site — Zone" was matched/named under the old rules;
  the plan needs an explicit, not assumed, answer for what a viewer sees
  now.
- **Existing test coverage should not be deleted** — it's the proof the
  underlying zone logic still works correctly, which reversibility depends
  on.
- Follow `docs/sprints/SPRINT-005/006/007.md`'s format and rigor.

## Success Criteria

- A pilot cannot create a zone, see a zone step in any dialog, match
  against a zone, edit a zone's boundary, or see zone-level community info
  — anywhere in the current product surface.
- The mechanism is a small number of centralized checks, not scattered
  "if zone" conditionals across a dozen files.
- Zero data loss, zero schema change.
- An explicit, tested answer for what happens to a flight that was already
  bound to a zone before this sprint.
- Existing zone test suites still pass (possibly adapted to call the
  underlying functions directly rather than through now-hidden UI), proving
  the logic this sprint hides is still intact and ready to be re-shown
  later.

## Verification Strategy

- No external reference implementation — success is defined by the
  Success Criteria above, verified by updated/new tests plus a manual QA
  pass confirming zones are genuinely unreachable through the UI.
- Regression risk is concentrated in `findLocation` (does hiding zone
  matching correctly fall through to site-only matching without breaking
  existing site matching?) and in the naming dialog (does removing the zone
  step break the site-only flow SPRINT-004 originally shipped?).

## Uncertainty Assessment

- **Correctness uncertainty**: Low — this is subtraction/gating of existing,
  already-correct logic, not new algorithmic work.
- **Scope uncertainty**: Medium — "hide everywhere" sounds simple but the
  touchpoint count is large; the real risk is missing a spot (a stray zone
  affordance still reachable) rather than getting any one spot wrong.
- **Architecture uncertainty**: Low — `SITE_BOUNDARY_MATCHING=off` is
  direct, working precedent for exactly this shape of change.

## Open Questions

1. What single mechanism gates all of this — one boolean constant/env
   flag checked at each surface, or several independent removals? The
   intent's own bias (stated by the user's context) is toward one
   centralized, reversible switch.
2. What happens to a flight that already shows "Site — Zone" from before
   this sprint — keep showing the zone name (view-only, no further zone
   interaction possible), or collapse the display to just the site name?
3. Do the zone-parallel server actions (`renameZone`, `setZoneBoundary`,
   zone community info, etc.) need a server-side reject in addition to
   being unreachable from the UI, or is "no client calls them" sufficient
   given they already re-verify authorization from scratch on every call?
4. Do operator zone commands (`scripts/admin-sites.ts`) stay fully
   functional for existing data, or do they also get hidden/disabled?
5. Should existing zone-specific tests be left calling the library
   functions directly (bypassing the now-hidden UI), get skipped, or
   something else — balancing "coverage proves reversibility" against "a
   green test suite for a feature nobody can reach is confusing."
6. Should new site creation still silently accept an omitted zone (already
   the SPRINT-004 default behavior) with no UI change needed beyond
   removing the zone STEP, or is there anything else about the create flow
   that assumes a zone step exists?
