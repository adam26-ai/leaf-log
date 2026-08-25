# Sprint 008: Hide Zones, Keep Sites

## Overview

SPRINT-005, SPRINT-006, and SPRINT-007 built a rich two-level location model:
`Site` as the named flying place, and optional `Zone` rows for specific
launches or LZs under that site. That model is technically coherent, but the
product surface has become too heavy for the current stage of Leaf Log. The
next product step is to remove zones from the pilot experience for now and
return the app to the simpler mental model: name a site, match a site, edit a
site, and show a site.

This sprint is a hide, not a delete. The `Zone` table, all existing zone rows,
the four `Flight` zone cache columns, zone audit/endorsement rows, boundary
columns, operator commands, and the already-tested underlying code stay in the
codebase. The app stops exposing them through matching, display, dialogs,
public community surfaces, and server actions while a centralized feature gate
is off. A future "bring zones back" sprint should be a small re-exposure pass:
turn the gate on, update copy if needed, and re-run the preserved test suites.

The key implementation decision is a single server-side feature gate, patterned
after `SITE_BOUNDARY_MATCHING=off` in `lib/sites/lookup.ts`, but inverted for the
product decision: zones default to hidden unless explicitly enabled. Product
code asks that gate at every zone entry point. Existing zone behavior remains
testable by forcing the gate on in targeted legacy tests; new tests assert the
default off behavior.

## Use Cases

1. **Name a new place with no zone step**: A pilot opens an unknown flight,
   names "Mission Ridge," picks visibility, and saves. There is no "Which
   spot?" step, no spot name field, and no "Skip - just the site" decision
   because the site-only path is now the only path.
2. **Match future flights to the site only**: A flight uploaded from inside a
   known zone's old radius still matches the parent site, not the zone. The
   headline reads "Mission Ridge" even if the database still contains "North
   Launch."
3. **Existing zone-bound flights collapse to site display**: A flight that
   previously showed "Mission Ridge - North Launch" now shows "Mission Ridge"
   to every viewer, including the owner. The zone id/name remain in the
   database and can reappear if zones are re-enabled later.
4. **Edit a site boundary without seeing spots**: The owner-scoped boundary
   picker lists sites only. Zone boundaries are neither listed nor editable
   from the app while zones are hidden.
5. **Use public community info at the site level only**: A viewer can open
   contributors, history, endorsements, rename, and boundary edit for a public
   site. The same affordances never target a zone while zones are hidden.
6. **Direct client calls cannot create or mutate zones**: A stale browser tab
   or hand-written request that submits a zone choice, zone boundary edit,
   zone rename, zone endorsement, or zone undo receives a controlled failure
   and writes nothing.
7. **Operators can still repair stored zone data**: `scripts/admin-sites.ts`
   zone commands remain available as operator maintenance tools, because this
   sprint is not a data deletion or data abandonment sprint.
8. **A future re-enable is low risk**: Targeted tests can run with zones
   enabled and prove the underlying zone matcher, visibility conjunction,
   cache writer, boundary editor, community model, and operator paths still
   work.

## Architecture

### Feature gate

Create a small location feature module:

```ts
// lib/sites/features.ts
export function zonesEnabled(): boolean {
  return process.env.SITE_ZONES === "on";
}
```

The function is deliberately read fresh, not cached at module load, matching
the SPRINT-006 `boundaryMatchingEnabled()` precedent. Default is off. The
production product therefore hides zones without requiring an environment
change; tests or a future re-enable can set `SITE_ZONES=on`.

Client components should not read `process.env` directly. Server components
that render `SiteNameControl` pass a `zonesEnabled` boolean prop derived from
the server gate. Server actions and repositories still call the gate directly
because they are the authority and must reject stale or forged requests.

### Data flow when zones are hidden

```text
Flight ingest / naming / display

  findLocation()
    -> siteCandidates only
    -> returns { site, zone: null }

  createOrAttachSiteFromFlight()
    -> accepts SiteChoice
    -> rejects ZoneChoice
    -> writes only site cache fields

  resolveLocationFields()
    -> resolves/scopes site as today
    -> strips zoneId and zoneName from returned rows

  SiteNameControl / NameSiteDialog
    -> renders site label only
    -> starts on SiteStep
    -> no ZoneStep, no nested spot rows
```

Stored zone data remains untouched. Existing `takeoffZoneId`,
`takeoffZoneName`, `landingZoneId`, and `landingZoneName` values stay in
Postgres. The read path simply withholds them from every app surface while the
gate is off.

### Matching

`lib/sites/lookup.ts` becomes the primary behavioral switch. When
`zonesEnabled()` is false, `findLocation` must not query `db.zone`, must not
rank zone candidates, and must not return a zone. Site matching, including
site boundaries and `SITE_BOUNDARY_MATCHING=off`, remains unchanged.

When `zonesEnabled()` is true, the existing SPRINT-005/006 behavior remains:
zone candidates and site candidates run in parallel, zone-first precedence is
preserved, `canSeeZone` re-checks the conjunction, and site fallback stays
unconditional.

### Suggestions and creation

`suggestNearbyLocations` should still return the same `SiteSuggestion` shape,
but `zones` is always `[]` while the gate is off, and nearby zone rows do not
pull their parent site into suggestions. This matters: surfacing a site only
because a hidden zone is nearby would still make zones influence the product
experience.

`createOrAttachSiteFromFlight` remains the single write path for binding
flights to locations. With zones hidden, any non-undefined `input.zone` is
rejected before a transaction writes anything. Site reuse, site creation,
site kind widening, site duplicate probes, site boundary-aware duplicate
checks, and site re-association stay unchanged.

### Display

The display decision belongs in the viewer-scoped read path, not only in
formatting. `lib/flights/repo.ts` should strip zone ids and names from
`resolveLocationFields` when `zonesEnabled()` is false. That guarantees:

- `SiteNameControl` receives `zoneId: null` and `initialZoneName: null`.
- `LocationCommunityDialog` is opened for sites, not zones.
- Logbook/feed/profile rows using `formatLocationLabel` naturally render the
  site-only label.
- A stale cached private zone name cannot leak through a forgotten component.

`formatLocationLabel` can stay unchanged. It already renders site-only when
`zoneName` is null and never renders a bare zone name.

### UI surfaces

`components/flight/name-site-dialog.tsx` needs a site-only mode controlled by
the prop passed into `SiteNameControl`:

- Initial step is always `"site"` while zones are hidden.
- `chooseSiteReuse` and `chooseSiteCreate` submit the site immediately instead
  of moving to `"zone"`.
- `ZoneStep` is not rendered.
- Nested spot rows under nearby site suggestions are not rendered.
- Zone undo, zone boundary, and zone community buttons are not rendered.
- Boundary picker displays only site rows.

The implementation should prefer removing zone props from rendered paths over
sprinkling copy changes. If the gate is off, a pilot should not encounter the
concept of a "spot" at all.

### Server action enforcement

Hiding client UI is not enough. Every zone server action must fail closed while
zones are hidden:

- `nameSite` rejects a valid-looking `zone` payload.
- `unpublishZoneForFlight` and `deleteZoneForFlight` reject.
- `saveBoundaryForFlightEndpoint(..., "zone", ...)`,
  `clearBoundaryForFlightEndpoint(..., "zone")`,
  `saveBoundaryForOwnedRow("zone", ...)`,
  `clearBoundaryForOwnedRow("zone", ...)`,
  `getBoundaryForOwnedRow("zone", ...)`, and
  `getBoundaryForPublicRow("zone", ...)` reject or return null.
- `getCommunityInfoForRow("zone", ...)`, `renamePublicRow("zone", ...)`, and
  `toggleEndorsement("zone", ...)` reject or return null.

The error wording does not need to advertise the feature gate. It should be
controlled and non-leaky: "Spots are not available." is sufficient.

### Tests preserve reversibility

Existing zone-specific tests should not be deleted. Split coverage into two
families:

- **Default-off tests** assert the shipped product behavior: site-only
  matching, site-only display, zone actions rejected, zone UI unreachable.
- **Gate-on legacy tests** set `SITE_ZONES=on` around existing zone suites or
  selected cases, proving the hidden machinery still works.

E2E tests that currently create zones through the UI should be rewritten as
site-only product tests by default. If UI-level zone e2e coverage is kept, it
must run only in a gate-on describe block or separate spec.

## Implementation

### Phase 1: Feature gate and site-only matching (~25% of effort)

**Files:**
- `lib/sites/features.ts` - New centralized `zonesEnabled()` gate.
- `lib/sites/lookup.ts` - Skip zone candidate query/ranking when the gate is
  off; keep existing behavior when on.
- `lib/sites/repo.ts` - Return site suggestions with `zones: []` and reject
  `input.zone` while off.
- `lib/flights/repo.ts` - Strip zone ids/names from resolved rows while off.
- `lib/sites/lookup.test.ts` - Add default-off matching tests; preserve
  existing zone tests behind `SITE_ZONES=on`.
- `test/sites.integration.test.ts` - Add display/cache stripping coverage.

**Tasks:**
- [ ] Add `zonesEnabled()` with default-off semantics and fresh env reads.
- [ ] Update `findLocation` so off mode performs no zone query and returns
      `zone: null`.
- [ ] Update `suggestNearbyLocations` so off mode performs no zone query and
      never promotes a site because of a hidden zone.
- [ ] Update `createOrAttachSiteFromFlight` to reject `input.zone` before
      writing.
- [ ] Update `resolveLocationFields` to clear returned `zoneId`/`zoneName`
      while keeping stored DB values intact.
- [ ] Add tests proving a zone that would have won now falls through to the
      parent site, and a flight already bound to a zone displays site-only.

### Phase 2: Site-only naming and boundary UI (~30% of effort)

**Files:**
- `components/flight/name-site-dialog.tsx` - Site-only mode for naming,
  existing label editing, boundary picker, and community shortcuts.
- `components/flight/flight-header.tsx` - Pass `zonesEnabled` into
  `SiteNameControl`.
- `components/logbook/flight-row.tsx` and any other direct label renderers -
  Verify no extra change is needed once read data strips zone fields.
- `app/flights/[id]/boundary-action.ts` - Hide/list/reject zone boundary paths.
- `test/e2e/zones.spec.ts` - Replace default product coverage with site-only
  expectations or gate existing zone UI tests on `SITE_ZONES=on`.
- `test/e2e/boundaries.spec.ts` - Update boundary picker expectations to sites
  only by default.

**Tasks:**
- [ ] Add a `zonesEnabled` prop to `SiteNameControl` and carry it into
      `NameSiteDialog`.
- [ ] Make site reuse/create submit immediately in off mode.
- [ ] Prevent `ZoneStep` and nested spot suggestion rows from rendering in off
      mode.
- [ ] Hide zone undo, zone boundary, and zone community controls for already
      zone-bound flights.
- [ ] Make the boundary picker list only sites in off mode.
- [ ] Add e2e coverage that the naming dialog has no spot step and the
      boundary picker has no spot rows.

### Phase 3: Server action and community gates (~25% of effort)

**Files:**
- `app/flights/[id]/site-action.ts` - Reject zone choices and zone undo actions
  while off.
- `app/flights/[id]/boundary-action.ts` - Reject or null-return zone boundary
  reads/writes while off.
- `app/flights/[id]/community-action.ts` - Reject or null-return zone community
  reads/writes while off.
- `lib/sites/associate.ts` - Optionally add low-level guards to zone mutators
  called by server actions, while leaving tests able to exercise them with the
  gate on.
- `lib/sites/community.ts` and `lib/sites/endorsements.ts` - Add guards here
  only if action-level gating leaves another app call path.
- `test/community.integration.test.ts` - Add zone community hidden/rejected
  cases by default and preserve existing gate-on cases.

**Tasks:**
- [ ] Reject stale `nameSite({ zone })` calls before
      `createOrAttachSiteFromFlight`.
- [ ] Reject zone unpublish/delete server actions.
- [ ] Return `{ sites, zones: [] }` from `listMyBoundaryEditableRows` while
      zones are hidden.
- [ ] Reject zone boundary reads/writes from both bound-flight and picker
      paths.
- [ ] Return null for zone community info and reject zone rename/endorsement.
- [ ] Assert direct action calls write no `Zone`, `Flight`, audit, boundary,
      or endorsement changes.

### Phase 4: Preservation, docs, and release pass (~20% of effort)

**Files:**
- `scripts/admin-sites.ts` - Leave zone maintenance commands functional; update
  help/comments only if needed to clarify they are operator maintenance for
  hidden data.
- `scripts/admin-sites.test.ts` - Keep zone command tests, preferably with
  `SITE_ZONES=on` only when the command reaches app-level zone helpers that
  consult the gate.
- `docs/architecture.md` - Document zones as hidden/inactive, not removed.
- `FEATURES.md` - Move the sprint outcome into the developer-facing log.
- `lib/whats-new.ts` - Add user-facing release note about simpler site naming.
- `docs/sprints/ledger.tsv` - Sync after final sprint acceptance.

**Tasks:**
- [ ] Keep operator zone commands available for repair/inspection of stored
      data.
- [ ] Update architecture docs to name the feature gate and the default
      site-only product mode.
- [ ] Add a `/whats-new` entry before release, per project convention.
- [ ] Ensure legacy zone tests still run in a deliberate gate-on context.
- [ ] Run the required gates: `pnpm build`, `pnpm test`, `pnpm typecheck`,
      `pnpm lint`, and `pnpm e2e`.

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `lib/sites/features.ts` | Create | Central default-off `zonesEnabled()` gate, read fresh from `SITE_ZONES`. |
| `lib/sites/lookup.ts` | Modify | Site-only matching when zones are hidden; preserve zone-first matching when enabled. |
| `lib/sites/repo.ts` | Modify | Site-only suggestions and creation; reject zone choices while hidden. |
| `lib/flights/repo.ts` | Modify | Strip zone ids/names from viewer-scoped results while hidden. |
| `app/flights/[id]/site-action.ts` | Modify | Reject stale zone choices and zone undo actions. |
| `app/flights/[id]/boundary-action.ts` | Modify | Return site-only picker data and reject zone boundary calls. |
| `app/flights/[id]/community-action.ts` | Modify | Hide/reject zone community reads, renames, and endorsements. |
| `components/flight/name-site-dialog.tsx` | Modify | Remove zone step, nested spot rows, zone boundary controls, and zone community controls while hidden. |
| `components/flight/flight-header.tsx` | Modify | Pass server-derived zone feature state into `SiteNameControl`. |
| `components/flight/location-community-dialog.tsx` | Verify/Modify | Ensure no zone path is reachable when callers pass site-only targets. |
| `components/flight/boundary-editor.tsx` | Verify | No direct change expected; it remains level-capable for future re-enable. |
| `lib/sites/associate.ts` | Verify/Modify | Add lower-level zone guards only where action-level gating is insufficient. |
| `lib/sites/community.ts` | Verify/Modify | Ensure zone community info cannot bypass the action gate if imported elsewhere. |
| `lib/sites/endorsements.ts` | Verify/Modify | Ensure zone endorsement cannot bypass the action gate if imported elsewhere. |
| `scripts/admin-sites.ts` | Verify/Modify | Keep operator zone commands available; clarify maintenance-only posture if needed. |
| `lib/sites/lookup.test.ts` | Modify | Add default-off matching tests; keep legacy zone matching behind gate-on setup. |
| `test/sites.integration.test.ts` | Modify | Assert zone-bound flights render site-only while stored zone data remains. |
| `test/community.integration.test.ts` | Modify | Assert zone community actions are hidden/rejected by default; preserve gate-on legacy coverage. |
| `scripts/admin-sites.test.ts` | Modify | Keep operator zone coverage aligned with the gate. |
| `test/e2e/zones.spec.ts` | Modify | Convert default e2e to site-only naming/matching or gate old zone UI tests. |
| `test/e2e/boundaries.spec.ts` | Modify | Assert boundary picker is site-only by default. |
| `test/e2e/community.spec.ts` | Modify | Assert community dialog targets sites only by default. |
| `docs/architecture.md` | Modify | Document zones as hidden, preserved data. |
| `lib/whats-new.ts` | Modify | Add user-facing release note. |
| `FEATURES.md` | Modify | Update developer-facing feature log. |
| `docs/sprints/ledger.tsv` | Modify | Sync sprint ledger after final sprint is accepted. |

## Definition of Done

- [ ] No schema migration exists for this sprint. No `Zone` table, zone
      column, zone audit row, zone endorsement row, boundary JSON, or cached
      `Flight` zone value is deleted or nulled as part of the hide.
- [ ] `zonesEnabled()` exists in one shared module, defaults false, reads
      `process.env.SITE_ZONES` fresh, and is used by matching, read display,
      creation, and server actions.
- [ ] With default env, `findLocation` performs site matching only and returns
      `zone: null` even when a visible zone is in range and would have won
      under SPRINT-005 rules.
- [ ] With `SITE_ZONES=on`, existing zone-first matching tests still pass,
      including site fallback, private-zone visibility, parent conjunction,
      boundary-bearing zones, and deterministic collision behavior.
- [ ] `suggestNearbyLocations` returns no nested zones and does not include a
      parent site solely because a hidden zone is nearby.
- [ ] The naming dialog has no "Which spot?" step, no spot name input, no
      nested spot rows, and no spot visibility copy while zones are hidden.
- [ ] Naming a site from an unknown flight still creates or reuses a site,
      binds the endpoint, re-associates the creator's own eligible flights,
      and never creates or attaches a zone.
- [ ] A direct `nameSite` call carrying a syntactically valid `zone` choice is
      refused while zones are hidden and writes no site/zone/flight changes
      beyond whatever existed before the call.
- [ ] A flight already bound to a zone returns `zoneId: null` and
      `zoneName: null` from all viewer-scoped flight read paths while zones
      are hidden, but the database row keeps its stored zone id/name.
- [ ] Logbook, feed, profile, and flight-page labels render "Site" rather
      than "Site - Zone" for existing zone-bound flights.
- [ ] Zone-level unpublish/delete server actions are rejected while hidden.
- [ ] The boundary picker lists sites only; zone boundary reads/writes are
      rejected or return null from every action path.
- [ ] The community dialog is reachable for public sites only; zone community
      info, zone rename, and zone endorsement are rejected or return null.
- [ ] No client-rendered copy uses "spot" or "zone" in the default product
      flow, except operator/docs/test-only contexts.
- [ ] Operator zone commands remain functional for maintenance of preserved
      data and have tests proving they still repair hidden zone rows safely.
- [ ] Existing zone test coverage is preserved in gate-on tests rather than
      deleted or broadly skipped.
- [ ] E2E covers site-only naming and future site-only auto-match. E2E also
      confirms no spot step appears and no zone boundary/community affordance
      is reachable by default.
- [ ] All five validation gates pass: `pnpm build`, `pnpm test`,
      `pnpm typecheck`, `pnpm lint`, and `pnpm e2e`.
- [ ] `/whats-new`, `FEATURES.md`, and `docs/architecture.md` are updated.
- [ ] Deferred items not shipped: schema cleanup, data deletion, zone
      migrations, new site metadata, zone browse pages, and a replacement
      location hierarchy.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| A missed UI affordance still exposes zones | Medium | Medium | Gate at both display data and component rendering; e2e sweeps naming, boundary, and community paths. |
| A direct server action can still mutate zones | Medium without action gates | High | Reject zone payloads/actions server-side, not just in the client. Add direct action/integration tests. |
| Existing zone-bound flights lose useful precision for pilots | High by design | Low/Medium | This is the accepted product simplification; data is preserved and can be re-shown by re-enabling zones. |
| Hidden zones still influence site suggestions or matching | Medium | Medium | Skip zone queries entirely in `findLocation` and `suggestNearbyLocations` while off. |
| Test suite becomes confusing because hidden features still have passing tests | Medium | Low | Split default-off product tests from explicit gate-on legacy tests and name the suites clearly. |
| Gate defaults wrong in production | Low | Medium | Default hidden in code; enabling requires explicit `SITE_ZONES=on`. Add a unit test for default-off. |
| Client and server gate state diverge | Low/Medium | Medium | Client receives server-derived prop; server actions remain authoritative and reject stale requests. |
| Operator commands bypass app posture | Low | Low | Treat admin CLI as maintenance, not pilot product surface; keep auth/environment assumptions unchanged and document the distinction. |
| Future re-enable discovers stale hidden code | Medium over time | Medium | Keep gate-on tests for matcher, repo, display, community, boundaries, and operator commands. |
| Rollback/revert confusion | Low | Medium | No schema/data changes. Reverting the sprint restores zone exposure; forward-fix is changing the gate or UI/action checks. |

## Security

- **No new privacy dimension.** Hiding zones reduces the public surface. The
  existing `canSeeSite`, `canSeeZone`, `siteVisibleWhere`, `zoneVisibleWhere`,
  and read-path firewall remain the authority for the preserved zone code when
  the gate is on.
- **Read stripping is mandatory.** The default-off display guarantee must be
  enforced in `lib/flights/repo.ts`, before data reaches client components.
  Component-only hiding would be insufficient because another renderer could
  still receive `zoneName`.
- **Hidden and unavailable zone actions write nothing.** Any request carrying
  a zone id or zone choice while zones are hidden must fail before mutation.
  This includes boundary, community, endorsement, rename, unpublish, delete,
  and bind paths.
- **No data destruction.** This sprint must not null or delete private zone
  names, boundaries, audit rows, endorsements, or cached flight values. A
  privacy bug introduced by this sprint should fail toward showing less, not
  deleting or rewriting history.
- **Untrusted ids stay server-verified.** The boundary picker and community
  dialog already re-read ids server-side; the new gate is an additional
  condition, not a replacement for authorization.
- **Operator tools remain privileged maintenance.** Keeping zone CLI commands
  does not expose pilot data through the web app. They should continue using
  existing guarded helper functions or explicit operator logic and tests.
- **Release copy should avoid implying deletion.** User-facing notes should
  say the app is simplifying site naming for now, not that old spot data has
  been erased.

## Dependencies

- **Internal:** Phase 2 depends on Phase 1's gate and read stripping; Phase 3
  can proceed in parallel with UI work once the gate module exists; Phase 4
  depends on the behavior being settled.
- **External/stack:** none new. No npm packages, no service, no Prisma
  migration, no Postgres extension. Prisma remains v6, NextAuth v5 and Next
  16 conventions remain unchanged.
- **Existing precedents:** `SITE_BOUNDARY_MATCHING=off` fresh env read in
  `lib/sites/lookup.ts`; SPRINT-005's optional site-only binding; SPRINT-006's
  "rollback without data change" framing; SPRINT-007's strict separation
  between product affordance and server-side authorization.
- **Test data:** Existing zone fixtures are still useful. New default-off
  fixtures should include at least one flight already bound to a zone and one
  coordinate where a zone would beat its parent if the gate were on.
- **Release process:** Per `CLAUDE.md`, a user-facing release requires a
  `/whats-new` entry in `lib/whats-new.ts` before deploy.

## Open Questions

1. **Should the feature gate be env-controlled (`SITE_ZONES=on`) or a hard
   constant?** This draft recommends env-controlled, default off, fresh-read
   server behavior. It keeps reversibility high and lets tests prove the
   preserved zone code still works.
2. **Should site owners see old zone names on their own existing flights?**
   This draft recommends no. The product surface is simpler if every viewer,
   including the owner, sees site-only labels while zones are hidden.
3. **Should low-level `lib/sites/associate.ts` zone mutators check the gate,
   or only server actions?** This draft recommends action-level gates first,
   with lower-level guards only for functions imported outside those actions.
   Keeping low-level helpers testable with `SITE_ZONES=on` preserves
   reversibility.
4. **Should operator zone commands require `SITE_ZONES=on`?** This draft
   recommends no. Operators may need to inspect or repair hidden data even
   while the pilot app hides it.
5. **Should existing zone e2e tests still run in CI?** This draft recommends
   converting default CI e2e to the site-only product and keeping targeted
   gate-on zone coverage at unit/integration level unless maintaining a
   separate gate-on e2e job is cheap.
6. **Should the UI remove all references to "spot" copy or leave some in
   maintenance dialogs?** This draft recommends removing it from the pilot web
   app default path entirely. Operator/docs/test contexts can still say zone.
