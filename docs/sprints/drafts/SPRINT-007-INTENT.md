# Sprint 007 Intent: Community-owned public sites and zones

## Seed

From the user, verbatim: "I'd like sites and zones to be 'community property' if
it is public... NOT owned by one user. There should be a 'contributors' roster
of users who have contributed to the site, and an audit history of who did
what... to hold folks accountable to screwing things up. other users can also
'upvote' the current site to provide 'weight' to the legitimacy of that site.
later on we can add additional meta data to the sites and zone."

Logged in `FEATURES.md` under "Community-Owned Public Sites & Zones" (Medium
priority).

## Context

- Leaf Log is a private-first flight logbook for the Leaf vario. `Site` and
  `Zone` are the two-level location hierarchy a flight's takeoff/landing point
  resolves to (SPRINT-005), each optionally carrying a custom GeoJSON
  `boundary` instead of a fixed-radius circle (SPRINT-006).
- Every `Site`/`Zone` row has exactly one `ownerId` (a `Profile`) today. All
  edit-control (rename, unpublish, delete, boundary edit) is gated through
  that single `ownerId`, with one deliberate exception already shipped:
  SPRINT-005 decision 4 lets a **site's** owner also rename/unpublish/delete
  a **zone** another pilot created under that site (mirrors real-world "the
  site owner is responsible for what's under their site").
- SPRINT-006 added `boundaryUpdatedById` — a single last-writer attribution
  column, not a history — plus a per-caller daily edit cap
  (`enforceDailyBoundaryEditCap`) as its own abuse mitigation.
- `Flight` already has a kudos mechanic (`test/e2e/social.spec.ts` exercises
  it) — a join-table-plus-denormalized-count pattern that likely generalizes
  directly to a site/zone upvote.
- `scripts/admin-sites.ts` is the operator remedy path (force-merge, boundary
  clear, rename) and currently assumes single ownership throughout (no owner
  gate for operator actions, since operators act outside the ownership model
  entirely — this should be largely unaffected).

## Recent Sprint Context

- **SPRINT-004**: user-generated site locations (a `Site` is just a named
  point a pilot creates, circle-matched).
- **SPRINT-005**: two-level `Site` → `Zone` hierarchy. Decision 4 (site owner
  has rename/unpublish/delete power over child zones) is the most relevant
  prior art for this sprint — it already establishes there's precedent for
  "ownership" meaning something other than strict single-editor exclusivity.
- **SPRINT-006**: custom GeoJSON polygon boundaries replacing the fixed-radius
  circle, with a `boundaryUpdatedById` attribution column and a per-caller
  daily edit cap as its abuse-mitigation precedent.

## Relevant Codebase Areas

- `prisma/schema.prisma` — `Site`, `Zone`, `Profile` models.
- `lib/sites/associate.ts` — all owner-gated write paths: `deleteSite`,
  `unpublishOwnSite`, `deleteZone`, `unpublishOwnZone`,
  `findZoneEditableBy`, `setSiteBoundary`/`clearSiteBoundary`/
  `setZoneBoundary`/`clearZoneBoundary`, `listOwnedSitesForBoundaryEditing`/
  `listOwnedZonesForBoundaryEditing`.
- `lib/sites/repo.ts` — read paths, `suggestNearbyLocations`,
  `createOrAttachSiteFromFlight`.
- `lib/flights/repo.ts` — the viewer-scoped read-path firewall; privacy is
  app-layer (no RLS) and must stay that way.
- `scripts/admin-sites.ts` — the operator remedy CLI (merge, force-merge,
  rename, boundary-clear).
- `components/flight/name-site-dialog.tsx` — the UI surface where a pilot
  edits site/zone name, visibility, and boundary; contributors/audit/upvote
  UI would likely live here or on a new site/zone detail surface.
- Kudos mechanic (wherever `Flight` kudos is implemented — precedent for the
  upvote join table + denormalized count shape).

## Constraints

- **Privacy is app-layer, no RLS** — every read must keep going through the
  viewer-scoped repo. Any new tables (contributors, audit log, upvotes) must
  respect the same discipline: no raw un-scoped queries reachable from a
  display path.
- **Prisma is pinned to v6** — no `url`-less datasource tricks, no relying on
  declarative CHECK constraints Prisma v6 can't express (SPRINT-006 had to
  hand-write raw SQL for its bbox CHECK; expect similar for any new
  constraints here).
- Must not silently change behavior for **private** sites/zones — the seed
  explicitly scopes "community property" to public rows only.
- Must account for **existing production data**: public sites/zones already
  exist with a single `ownerId` today; whatever ships needs a migration/
  backfill story, not just a schema change that only applies going forward.
- Should not conflict with or duplicate SPRINT-006's `boundaryUpdatedById` /
  daily edit cap — either reuse/generalize them or explicitly justify a
  parallel mechanism.
- Follow `docs/sprints/SPRINT-005.md`/`SPRINT-006.md`'s format and rigor
  (anchoring decisions, explicit out-of-scope, phased PR breakdown).

## Success Criteria

- A clear, explicit decision on what "community owned" actually changes about
  edit-control for public sites/zones — not left vague.
- A contributors roster is visible and genuinely reflects who contributed
  (some concrete, defensible trigger for "counts as a contribution").
- An audit history exists for at least the most consequential actions (name,
  visibility, boundary changes) and is attributable per-entry, not a single
  last-writer column.
- Upvoting works, is abuse-resistant in an obvious/cheap way (at minimum: one
  vote per user per row), and its blast radius on existing behavior (ranking,
  matching) is an explicit decision, not an accident.
- Existing single-owner private-site behavior is unchanged; existing public
  sites/zones transition cleanly (a real migration, not a manual fixup).
- Given how large and genuinely ambiguous "community ownership" is compared
  to prior sprints, the plan should be honest about what's safe to ship in
  one sprint vs. what should be its own follow-up (e.g., an actual
  edit-control/permission overhaul might be too large to do safely in one
  pass alongside roster + audit log + upvotes).

## Verification Strategy

- No external reference implementation — this is a product/policy decision as
  much as an engineering one, so verification is largely: does the DoD's
  behavior match what was decided in the interview, and do the existing
  SPRINT-004/005/006 test suites (privacy matrix, ownership, boundary tests)
  still pass unmodified for the private-site case?
- New integration tests needed for: contributor roster membership after an
  edit, audit log entries after name/visibility/boundary changes, upvote
  idempotency (can't double-vote), and — if edit-control changes — the new
  permission boundary (who can/can't edit a community-owned public row).
- Existing `test/sites.integration.test.ts`, `lib/sites/lookup.test.ts`, and
  `scripts/admin-sites.test.ts` patterns (disjoint lat/lon fixture bands
  across files — see prior sprints' lesson) should be followed for any new
  test file.

## Uncertainty Assessment

- **Correctness uncertainty**: Low — the individual mechanisms (join table +
  count, append-only log, roster membership) are well-understood patterns,
  not novel algorithms.
- **Scope uncertainty**: High — "community property" as stated is a product
  vision, not a bounded feature; the interview needs to pin down a
  shippable v1 and be explicit about what's deferred.
- **Architecture uncertainty**: Medium — extends existing patterns (kudos-like
  join tables, SPRINT-006's attribution-column precedent) but the
  edit-control model change (if any) is a genuinely new pattern for this
  codebase, since everything built so far assumes a single accountable owner
  per row.

## Open Questions

1. Does "community owned" change WHO can edit a public site/zone (e.g., any
   contributor, or any signed-in pilot), or does it only add roster/audit/
   upvote as visible signals on top of the EXISTING single-owner edit-control
   model? This is the single biggest scope decision in the sprint.
2. What concretely makes someone a "contributor" — creating the row, editing
   it (name/visibility/boundary), or something else (e.g. a flight matched
   there)?
3. What actions does the audit log cover in v1 — name, visibility, boundary
   changes? Merges? Does it subsume or run alongside SPRINT-006's
   `boundaryUpdatedById`?
4. Upvote mechanics: one vote per user per row forever, or can it be toggled/
   changed? Can the row's own contributor(s) upvote it? Does the vote count
   do anything functionally (ranking, matching) in v1, or is it a pure
   display signal for now?
5. Existing production public sites/zones (already shipped under
   SPRINT-004/005/006 with a single `ownerId`) — how do they transition? Does
   the current owner become the first/sole contributor automatically?
6. Does `ownerId` stay on the row (reinterpreted as "original creator," kept
   for provenance/backfill) or does the whole concept of a single owner
   column go away for public rows?
7. How does this interact with SPRINT-005 decision 4 (site owner's power over
   child zones) and `scripts/admin-sites.ts`'s existing merge/force-merge/
   boundary-preservation guards?
8. Should this be one sprint, or does the interview reveal the edit-control
   change is large/risky enough to warrant being its own follow-up sprint
   after roster + audit + upvote (the additive, lower-risk parts) ship first?
