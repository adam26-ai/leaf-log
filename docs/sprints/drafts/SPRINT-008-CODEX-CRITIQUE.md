# Critique - SPRINT-008 Claude draft (Hide zones, sites only for now)

Reviewed: [`SPRINT-008-CLAUDE-DRAFT.md`](./SPRINT-008-CLAUDE-DRAFT.md) against
[`SPRINT-008-INTENT.md`](./SPRINT-008-INTENT.md), my prior
[`SPRINT-008-CODEX-DRAFT.md`](./SPRINT-008-CODEX-DRAFT.md), and the current
SPRINT-005/006/007 location surfaces in `lib/sites/*`,
`lib/flights/repo.ts`, `app/flights/[id]/*-action.ts`, and
`components/flight/name-site-dialog.tsx`.

**Verdict.** Claude's draft is strong and mostly aligned with the right product
answer: zones are hidden, not deleted; the gate defaults off; already
zone-bound flights collapse to site-only display while stored zone fields stay
intact; and server actions reject stale zone mutations. The final sprint should
keep those decisions. The main issues are precision and coverage: the feature
gate name/value should be settled, the client/server path for the gate is
underspecified, the risk section is too optimistic for a 10+ surface removal,
and the Definition of Done needs stronger import-graph, E2E, and no-write
assertions.

## 1. Strengths

1. **The core product stance is right.** Claude treats this as a reversible
   hide, not a schema cleanup. It explicitly preserves the `Zone` table,
   `Flight` zone cache columns, zone audit/endorsement rows, boundaries,
   operator commands, and legacy tests.

2. **The default-off gate is correctly fail-closed.** `zonesEnabled()` returns
   true only for an explicit env value and reads `process.env` fresh per call.
   That matches the operational shape of `SITE_BOUNDARY_MATCHING=off` better
   than a module-level constant would.

3. **Already-bound-to-a-zone flights are handled correctly.** The draft says a
   flight that previously displayed `Site - Zone` now displays only `Site`,
   for every viewer, without nulling `takeoffZoneId`, `takeoffZoneName`,
   `landingZoneId`, or `landingZoneName`. That is the correct trade-off for a
   product simplification that may be reversed later.

4. **The read-path placement is good.** Suppressing zone ids/names in
   `resolveLocationFields` is stronger than formatting-only hiding. It reduces
   the chance that logbook/feed/profile/flight-page renderers leak stale
   `zoneName` values.

5. **Server-side rejection is treated as mandatory.** The draft does not rely
   on UI removal. It calls out `nameSite`, zone undo, boundary, community,
   rename, and endorsement actions as fail-closed while zones are disabled.

6. **Skipping zone queries is the right matching and suggestion behavior.**
   Hidden zones should not win matching, affect ranking, or pull parent sites
   into suggestions solely because a hidden child is nearby. Claude names that
   for `findLocation` and `suggestNearbyLocations`.

7. **Operator commands are scoped correctly.** Keeping `scripts/admin-sites.ts`
   zone commands available is important because preserved hidden data may still
   need repair, audit, merge, or cleanup by an operator.

8. **The DoD is concrete.** It names exact files, gate semantics, matching,
   display suppression, zone action rejection, UI absence, operator behavior,
   preserved tests, validation gates, and release docs.

## 2. Weaknesses

### 2.1 The gate contract needs one final name/value decision

Claude proposes `ZONES_ENABLED=true`; my draft proposes `SITE_ZONES=on`. Both
default off, both read fresh, and both satisfy the major product requirement.
The final sprint should not leave this as an incidental merge choice.

`ZONES_ENABLED=true` is explicit and readable, but it is broad. Most existing
location toggles are site-scoped, and the precedent named in both drafts is
`SITE_BOUNDARY_MATCHING=off`. `SITE_ZONES=on` is more consistent with that
namespace and with the app's "site/zone" domain language. Either is acceptable,
but the final document must choose exactly one env var, one enabled value, one
default, and one place to document it. Tests should assert all non-enabled
values are off.

### 2.2 The client-component gating path is underspecified

`components/flight/name-site-dialog.tsx` is a `"use client"` component. Claude
correctly says the naming dialog must skip the zone step, but does not say how
that client component learns the server-side gate state. It cannot safely import
a server-only env helper and read `process.env` directly.

The final sprint should require an explicit server-derived prop, or an
equivalent serialized value, passed from server renderers such as
`components/flight/flight-header.tsx` into `SiteNameControl` and
`NameSiteDialog`. Without that, the implementation could accidentally rely on
empty suggestions while still initializing `step` to `"zone"` for an
already-named site, which is the current behavior.

### 2.3 The draft overstates how automatic `SiteNameControl` cleanup is

Claude says zone names are already null from `resolveLocationFields`, so
`SiteNameControl` automatically renders site-only and never opens zone
community. That is true only for callers that receive rows through the
viewer-scoped flight read path. The component itself currently chooses
`level={zoneId ? "zone" : "site"}` and opens `LocationCommunityDialog` for
zones when `zoneId` is non-null.

The final sprint should explicitly make `SiteNameControl` gate-aware or require
all of its call sites to pass `zoneId: null` and `initialZoneName: null` while
zones are hidden. The DoD should include a grep/import review for any direct
renderers or test fixtures that pass cached `Flight` rows without going through
`resolveLocationFields`.

### 2.4 Server action gates may be too shallow unless the import graph is audited

Action-level rejection is the right first line, but the draft assumes those
actions are the only pilot-facing write/read path into zone helpers. Current
code also exposes lower-level helpers through `lib/sites/associate.ts`,
`lib/sites/community.ts`, `lib/sites/endorsements.ts`, and repository functions.

My draft leaves low-level guards optional but requires checking whether any
app path imports them outside the named actions. Claude's draft should add the
same import-graph audit. Otherwise a future or existing server action could
continue to call `renameZone`, `setZoneBoundary`, `toggleZoneEndorsement`, or
zone community readers without the gate.

### 2.5 The test strategy is internally inconsistent around existing zone tests

Claude says existing zone-specific tests should "pass unchanged" because they
call underlying functions directly, then later says zone tests that call
`findLocation` or `resolveLocationFields` should set `ZONES_ENABLED=true`.
Those cannot both be true. `findLocation`, `suggestNearbyLocations`,
`createOrAttachSiteFromFlight`, and `resolveLocationFields` are exactly the
functions receiving gates.

The final sprint should split the rule cleanly:

- tests whose expected behavior is old zone behavior must run with the gate on;
- tests whose expected behavior is shipped product behavior must run with the
  default env;
- tests for low-level pure helpers that never consult the gate can remain
  unchanged.

### 2.6 UI copy cleanup is weaker than the intended product outcome

Claude names the major visible steps, but the current client component contains
many "spot" affordances: zone step labels, nested zone suggestions, zone undo,
zone boundary, zone community, errors, titles, and disabled-state copy. The
draft does not require a default-flow copy sweep.

My draft's DoD has a sharper product acceptance criterion: no client-rendered
copy uses "spot" or "zone" in the default pilot flow, except operator/docs/test
contexts. That should be merged. The goal is not merely preventing mutation; it
is removing the two-level mental model from the pilot experience.

### 2.7 Re-association deserves an explicit no-zone assertion

Claude says `reassociateOwnFlights` is called site-only because
`createOrAttachSiteFromFlight` receives `zone` as undefined/null. That is
plausible, but the draft treats it as "no change needed" without a DoD item.

This matters because a site creation or site reuse can retroactively update
multiple flights. The sprint should require a test that default-off naming
re-associates eligible own flights to the site, writes no new zone bindings,
and does not overwrite existing stored zone cache columns on unrelated
zone-bound flights.

### 2.8 The one-PR plan may be too compressed for review

The implementation may be mechanically small, but it spans matching, display,
repo writes, three server-action files, a large client component, integration
tests, E2E tests, and docs. A single PR is possible, but it is not inherently
lower risk.

If the team wants one PR, the final sprint should at least sequence commits or
review sections: gate + data path, UI, server actions, tests/docs. If review
load matters more than merge overhead, my draft's four phases are safer.

## 3. Gaps in Risk Analysis

1. **Wrong gate default/value in production.** Claude says default off but does
   not call out the operational risk of choosing the wrong env var name,
   setting `"false"`/`"0"`/`"on"` unexpectedly, or documenting a different
   value than the code checks. This deserves a unit test and docs entry.

2. **Client/server state divergence.** The server may strip/reject zones while
   a stale client component still renders a zone step or sends a zone payload.
   Server rejection prevents writes, but the user experience would be broken.
   The risk section should cover stale tabs and client prop drift explicitly.

3. **Hidden zones still influencing nearby context.** Claude covers
   suggestions, but boundary editor nearby-context code also calls
   `suggestNearbyLocations`. The final sprint should verify all consumers get
   site-only context, not just the naming dialog.

4. **Direct read actions leaking zone metadata.** `getBoundLocationInfo`,
   `getBoundaryForOwnedRow`, `getCommunityInfoForRow`, and any public boundary
   read action can expose zone existence even if display rows are stripped.
   Claude lists some, but the risk analysis should treat read leaks separately
   from mutation leaks.

5. **Existing zone-bound owner affordances disappearing.** Claude marks this
   accepted, but the product consequence is real: a pilot who wants to fix,
   unpublish, or remove an old spot from their own flight cannot do it through
   the app while the gate is off. The final sprint should either accept that
   explicitly or preserve an operator-only support path in docs.

6. **Future re-enable drift.** The draft says a future re-enable is just
   setting the env var, but hidden UI code can rot quickly. The mitigation
   should require gate-on coverage for at least matcher, creation, read
   display, community, boundary, and core UI state if cheap.

7. **Action error wording consistency.** Claude uses "Zones are not
   available." while the existing user-facing model says "spot." The risk is
   minor, but inconsistent errors make stale-client behavior feel accidental.
   The final sprint should choose user-facing wording once.

8. **No-write guarantees need broader proof.** "Do not null existing columns"
   is covered, but direct rejected calls should also prove no `Zone`, `Flight`,
   audit, boundary, or endorsement changes are written.

## 4. Missing Edge Cases

1. **Already-named site with an existing zone-bound endpoint.** Current
   `NameSiteDialog` initializes `step` to `"zone"` when `currentSiteName` is
   present. Default-off behavior should open on the site step or submit
   site-only without ever landing on the zone step.

2. **Stale browser tab submits a valid `zone` payload after the deploy.** The
   server should reject before transaction start and revalidation should not
   make the client think a partial save succeeded.

3. **Visible zone in range with parent site outside ordinary site radius.**
   `suggestNearbyLocations` must not include the parent site solely because
   the hidden zone is nearby. Claude mentions this in prose but the DoD should
   require the test.

4. **Existing zone-bound flight whose parent site is hidden from the viewer.**
   `resolveLocationFields` must still respect `canSeeSite`; hiding zones must
   not accidentally reveal the parent site name if the site itself is private
   and invisible.

5. **Public zone under a private parent site.** Community and endorsement reads
   should return null while zones are hidden regardless, but the test is useful
   because SPRINT-005's effective visibility conjunction has been a recurring
   source of subtle bugs.

6. **Boundary picker nearby context with hidden zones.** A site boundary edit
   should not render hidden zone context circles through
   `suggestNearbyLocations`.

7. **Owner vs non-owner label clicks.** For both owners and non-owners,
   zone-bound labels should target site-level community/edit flows only while
   zones are hidden.

8. **Both endpoints on one flight.** A takeoff zone and landing zone can be
   independently bound. Both should collapse to their respective site names,
   and neither should expose zone undo/community/boundary controls.

9. **Gate toggled on in tests after default-off tests.** Because the helper
   reads env fresh, test setup must restore env values reliably to avoid
   cross-test pollution.

10. **Operator command behavior while gate is off.** Zone rename/merge/audit
    should work without requiring the web-app gate to be enabled, and tests
    should prove that distinction.

## 5. Definition of Done Completeness

Claude's DoD is a good base, especially on default-off matching, site-only
display for existing zone-bound flights, preserving stored zone columns,
server-action rejection, UI absence, operator commands, and the five validation
gates. I would merge most of it into the final sprint.

The DoD should be tightened in these places:

1. **Choose one env contract.** Name the env var and enabled value exactly.
   Assert default off, fresh reads, and false for absent/empty/`false`/`0`/any
   non-enabled value.

2. **Require a server-derived client gate.** `SiteNameControl` and
   `NameSiteDialog` must receive gate state from the server or otherwise be
   proven unable to render zone UI while default-off.

3. **Require import-graph coverage.** Search for app imports of zone mutators,
   community readers, endorsement helpers, and boundary helpers. Add low-level
   guards where action-level gates are not the only path.

4. **Expand no-write tests.** Rejected zone creation/mutation/read-write calls
   should prove no changes to `Zone`, `Flight`, audit, boundary, or endorsement
   records.

5. **Add copy-level product acceptance.** No default pilot flow should show
   "spot" or "zone" copy, controls, empty headings, or stale errors.

6. **Split legacy tests explicitly.** Gate-on tests preserve zone machinery;
   default-off tests assert shipped behavior. Do not describe gated tests as
   "unchanged" if their setup must set the env var.

7. **Add E2E coverage across the real surfaces.** Naming dialog has no zone
   step; logbook/feed/profile/flight page display site-only; boundary picker
   lists sites only; community dialog targets sites only; direct stale actions
   are rejected at integration level.

8. **Document accepted support limitation.** If old zone-bound flights cannot
   be unbound by pilots while zones are hidden, the final sprint should state
   that clearly and point operator repair to `scripts/admin-sites.ts`.

9. **Include release/docs completeness.** Claude includes `/whats-new` and
   `FEATURES.md`; my draft also includes `docs/architecture.md` and the sprint
   ledger after final acceptance. The final DoD should keep all required
   project docs in one place.

## 6. Divergence From Codex Draft

1. **Fate of already-bound-to-a-zone flights: no real divergence.** Both drafts
   choose site-only display for everyone while preserving stored zone ids/names.
   This should be treated as settled unless the human explicitly wants owners
   to keep seeing old spot labels. I do not recommend that exception; it keeps
   the two-level model alive in the exact place pilots look most.

2. **Gate default: no real divergence.** Both drafts default zones off and
   require an explicit env setting to re-enable. This should also be treated as
   settled.

3. **Gate name/value: unresolved divergence.** Claude uses
   `ZONES_ENABLED=true`; Codex uses `SITE_ZONES=on`. The final sprint needs a
   concrete choice. My preference remains `SITE_ZONES=on` for domain
   namespacing and consistency with `SITE_BOUNDARY_MATCHING=off`, but
   `ZONES_ENABLED=true` is acceptable if documented and tested exactly.

4. **Client gate plumbing: Codex is more explicit.** My draft requires passing a
   server-derived `zonesEnabled` prop into `SiteNameControl`/`NameSiteDialog`.
   Claude implies UI hiding can fall out of read-path stripping. That is not
   enough for the owner naming flow.

5. **Phasing: Claude favors one PR; Codex favors staged phases.** The final
   sprint can still ship one PR, but should keep the phase boundaries for
   implementation and review.

6. **Risk posture: Codex is stricter.** Claude correctly identifies missed
   affordances as the main risk, but my draft better separates UI leaks,
   direct action writes, read action leaks, client/server divergence, test
   confusion, and future re-enable drift.
