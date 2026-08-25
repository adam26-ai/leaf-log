# SPRINT-008 — Hide zones (sites only, for now)

> Independent Claude draft for SPRINT-008. Written against
> [`SPRINT-008-INTENT.md`](./SPRINT-008-INTENT.md) and the codebase as of
> SPRINT-007's merge (PR #47).

## Overview

Zones were introduced in SPRINT-005 and refined by SPRINT-006 (boundaries) and SPRINT-007
(community ownership). The user's assessment is that the two-level model is "getting too
complicated" for the current product surface. This sprint hides every zone affordance from
the pilot-facing app — creation, display, matching, boundary editing, community info —
behind a single, centralized, reversible mechanism. No data is deleted; no schema changes;
every existing zone-aware code path, test suite, and database row stays intact. A future
"bring zones back" sprint re-exposes the existing, already-tested machinery rather than
reconstructing it.

Three decisions anchor the sprint:

1. **One env-read boolean, checked at every surface.** `ZONES_ENABLED`, read fresh from
   `process.env` (not cached at module load), mirrors the existing
   `SITE_BOUNDARY_MATCHING=off` kill-switch pattern in `lib/sites/lookup.ts`. When absent
   or set to any value other than `"true"`, zones are hidden. This gives a single,
   documented, externally-flippable lever that a future sprint just turns on.

2. **Existing zone-bound flights show the site name only.** A flight that was matched
   to "Mission Ridge — North Launch" before this sprint now displays as "Mission Ridge."
   The `takeoffZoneId`/`takeoffZoneName`/`landingZoneId`/`landingZoneName` columns on the
   flight row are untouched — the zone data is still there — but every display surface
   suppresses the zone portion. This is implemented in the read path
   (`resolveLocationFields` in `lib/flights/repo.ts`), not by nulling cache columns, so
   reversibility is a config change rather than a backfill.

3. **Server-side rejection on zone mutations, not just UI removal.** Zone creation,
   zone rename, zone boundary edit, zone community actions, and zone endorsement are all
   rejected server-side with a clear, non-leaking error when zones are disabled. UI
   removal alone would be insufficient — a determined caller with the server action's name
   could still create zones. The reject is the real gate; the UI removal is UX.

**Committed scope**

1. A `zonesEnabled()` helper in `lib/sites/zones-enabled.ts`, following the
   `boundaryMatchingEnabled()` pattern.
2. `findLocation` skips the zone pass entirely when zones are disabled — site-only
   matching, zero wasted queries.
3. `resolveLocationFields` strips zone ids and zone names from every display read when
   zones are disabled — already-bound zone data is invisible but preserved.
4. `suggestNearbyLocations` omits nested zone suggestions.
5. `createOrAttachSiteFromFlight` rejects a `zone` choice when zones are disabled.
6. The naming dialog (`name-site-dialog.tsx`) skips the zone step entirely — "Next" on
   the site step submits directly, no "Which spot?" appears.
7. Zone-parallel server actions (`unpublishZoneForFlight`, `deleteZoneForFlight`, zone
   rename/community/boundary via the community dialog) return an error.
8. The boundary picker omits "My spots" and zone-level rows.
9. `SiteNameControl` renders zone names as empty (site name only) and does not open the
   zone-level community dialog.
10. Operator zone commands in `scripts/admin-sites.ts` remain fully functional — they
    operate on existing data, not the pilot-facing product surface.

**Explicitly out of scope** (with reasons)

- **Dropping `Zone` columns/tables or nulling `Flight` zone columns.** The hardest
  constraint in the intent: no schema change, no data migration, no destructive operation.
  Reversibility depends on the data being intact.
- **Removing zone-aware code paths.** The code stays; only its reachability changes. Tests
  that exercise zone logic directly continue to prove the underlying machinery works.
- **Removing zone-specific test files.** `lookup.test.ts`'s zone tests,
  `test/sites.integration.test.ts`'s zone matrix, `test/e2e/zones.spec.ts`, etc. are the
  proof that zones still work correctly when re-enabled. Deleting them would mean
  rebuilding confidence from scratch.
- **Changing `SITE_BOUNDARY_MATCHING`.** That flag is orthogonal and stays as-is.

## Use Cases

1. **A new pilot uploads a flight near a known site.** `findLocation` runs the site pass
   only (the zone pass is skipped). The flight matches "Mission Ridge" and never shows a
   zone name, even if zones exist in the database for that site. Identical behavior on
   web upload and device push.

2. **A pilot opens a flight that was previously matched to a zone.** The flight row still
   has `takeoffZoneId` and `takeoffZoneName` populated. `resolveLocationFields` suppresses
   them: the heading reads "Mission Ridge," not "Mission Ridge — North Launch." The
   SiteNameControl click opens the site community dialog (if public), not the zone's.

3. **A pilot names a new site.** The "Name this site" dialog shows the site step
   (unchanged from SPRINT-004). After choosing or creating a site, the dialog submits
   directly — no "Which spot?" step appears, no "Skip — just the site" button is needed.

4. **Nearby-site suggestions omit zone nesting.** `SiteSuggestion.zones` is always an
   empty array when zones are disabled. The dialog shows flat site cards with no nested
   zone sub-list.

5. **A pilot tries to name a zone via a direct server-action call.** The `nameSite`
   action rejects the request with a clear error ("Zones are not available.") regardless
   of what the client sends — no zone is created.

6. **A pilot who owns a zone boundary opens "Edit a boundary."** The picker lists only
   their sites, not their zones. Zone-level boundary editing is unreachable.

7. **A viewer clicks a site label on someone else's flight.** The community dialog opens
   for the site. If the flight was previously zone-bound, no zone community info is
   shown — the click targets the site, not the zone.

8. **An operator runs `zone-rename` or `zone-audit`.** The command works normally. Operator
   zone commands are unaffected — they operate on the underlying data, which is intact.

9. **A future sprint sets `ZONES_ENABLED=true`.** The zone pass in `findLocation` resumes.
   `resolveLocationFields` starts showing zone names again. The naming dialog's zone step
   reappears. Every existing zone row, flight binding, boundary, audit entry, and
   endorsement is immediately live — no migration, no backfill, no data reconstruction.

## Architecture

### The centralized gate (`lib/sites/zones-enabled.ts`)

```ts
/**
 * SPRINT-008 zone visibility gate: ZONES_ENABLED=true re-enables zones;
 * absent or any other value means zones are hidden from the product surface.
 * Read fresh (not cached at module load) so it's testable and flippable
 * without a redeploy, mirroring SPRINT-006's boundaryMatchingEnabled().
 */
export function zonesEnabled(): boolean {
  return process.env.ZONES_ENABLED === "true";
}
```

One file, one function, one `process.env` read. Every zone-touching surface imports and
checks this. The pattern is identical to `boundaryMatchingEnabled()` in
`lib/sites/lookup.ts` — same file shape, same runtime behavior (read per call, not cached),
same testability (set the env var in a test, restore afterward).

### Matching — skip the zone pass

`lib/sites/lookup.ts`'s `findLocation`:

```ts
const [siteRows, zoneRows] = await Promise.all([
  siteCandidates(db, lat, lon, kind, viewerId),
  zonesEnabled() ? zoneCandidates(db, lat, lon, kind, viewerId) : Promise.resolve([]),
]);
```

When zones are disabled, `zoneCandidates` never runs — no DB query, no wasted I/O. The
rest of `findLocation` proceeds with an empty `zoneRows` array, which means `zoneRanked`
is empty, `zoneWinner` is undefined, and the site-only fallback path always runs. The
function's return shape is unchanged: `{ site, zone: null }` or `null`.

This is the minimal change: one ternary in the `Promise.all`, no restructuring. The
zone-ranking, `canSeeZone` re-checking, and `compareSiteCandidates` code is all still
there — it just has nothing to process.

### The read path — suppress zone display

`lib/flights/repo.ts`'s `resolveLocationFields` already resolves each endpoint's zone id
against the live `Zone` row and strips it when invisible. When zones are disabled, the
change is one early return at the zone-resolution stage:

```ts
// Inside resolveEndpoint, after resolving the site:
if (zoneId === null || !zonesEnabled()) return resolvedSite;
```

This means:
- Every flight on every surface (logbook, profile, feed, flight page) shows site-only.
- The zone data on the `Flight` row is untouched — `takeoffZoneId`, `takeoffZoneName`,
  etc. keep their values.
- Re-enabling zones makes every zone-bound flight immediately show its zone name again,
  with no backfill needed.

### Suggestions — flat sites only

`lib/sites/repo.ts`'s `suggestNearbyLocations`:

When zones are disabled, the zone query is skipped (same pattern as `findLocation`), and
every `SiteSuggestion` is returned with `zones: []`. The site-level distance calculation
uses `ownDistanceM` only — no `nearestZoneDistanceM` adjustment.

### Creation — reject zone choices

`lib/sites/repo.ts`'s `createOrAttachSiteFromFlight`:

```ts
if (input.zone && !zonesEnabled()) {
  throw new Error("Zones are not available.");
}
```

Checked before the transaction begins. A `CreateOrAttachInput` with `zone` omitted
(the SPRINT-004 bare-site path) is unaffected. The result always has `zone: null` and
`createdZone: false` when zones are disabled.

### Server actions — reject zone mutations

Each zone-parallel server action in `app/flights/[id]/site-action.ts`:

- `unpublishZoneForFlight` and `deleteZoneForFlight` return
  `{ ok: false, error: "Zones are not available." }` when zones are disabled.

In `app/flights/[id]/community-action.ts`:

- `getCommunityInfoForRow` with `level: "zone"` returns `null`.
- `renamePublicRow` with `level: "zone"` returns `{ ok: false, error: "..." }`.
- `toggleEndorsement` with `level: "zone"` returns `{ ok: false, error: "..." }`.

In `app/flights/[id]/boundary-action.ts`:

- `listMyBoundaryEditableRows` returns `{ sites, zones: [] }`.
- `saveBoundaryForOwnedRow` and `clearBoundaryForOwnedRow` with `level: "zone"` return
  an error.
- `saveBoundaryForFlightEndpoint` and `clearBoundaryForFlightEndpoint` with
  `level: "zone"` return an error.
- `getBoundaryForOwnedRow` with `level: "zone"` returns `null`.

### The naming dialog — no zone step

`components/flight/name-site-dialog.tsx`:

The `NameSiteDialog` component's `step` state machine currently goes `"site"` →
`"zone"` → (submit). When zones are disabled:

- The initial step for an already-named site is `"site"` (not `"zone"` as today).
- `chooseSiteReuse` and `chooseSiteCreate` call `submit()` directly instead of
  `setStep("zone")`.
- The `ZoneStep` component is never rendered.
- The `Step` type's `"zone"` variant is still defined (the type stays unchanged), just
  never reached at runtime.

`SiteNameControl`:

- The zone name portion of the display (`{zoneName && ...}`) is suppressed — the
  `zoneName` prop is already `null` from `resolveLocationFields`, so this happens
  automatically with no extra check.
- For the non-owner community-dialog path: the `level` is always `"site"`, the `id` is
  always `siteId` — a non-null `zoneId` is never used to open a zone-level community
  dialog.
- For the owner's own naming-dialog path: `onZoneUndone` is never called (there's no zone
  step to undo from).

### The boundary picker — sites only

`BoundaryPickerStep` renders `rows.zones` only when it's non-empty. Since
`listMyBoundaryEditableRows` returns `zones: []`, the "My spots" section simply doesn't
appear. No conditional rendering change needed in the component itself.

### Operator commands — unchanged

`scripts/admin-sites.ts`'s zone commands (`zone-rename`, `zone-force-private`,
`zone-merge`, `zone-boundary-clear`, `zone-audit`) continue to work normally. They
operate on the `Zone` table directly and are not gated by `zonesEnabled()`. An operator
investigating or repairing existing zone data needs these tools regardless of whether
zones are visible in the product.

### Display — `formatLocationLabel` unchanged

`lib/sites/display.ts`'s `formatLocationLabel` already handles `zoneName: null` — it
returns the site name alone. Since `resolveLocationFields` strips zone names, every
consumer of `formatLocationLabel` produces a site-only label with no change to the
function itself.

### Re-association — site-only

`reassociateOwnFlights` is called from `createOrAttachSiteFromFlight` with `zone`
always undefined/null when zones are disabled. The existing code already handles this:
it scans at the site radius, matches site-only, and writes `locationCachePatch(site, null,
endpoint)`. No change needed.

## Implementation

One PR. The changes are small, centralized, and the risk profile is low — every change is
additive gating, not structural modification. Splitting into multiple PRs would add merge
ceremony without improving safety.

### The PR — Hide zones behind `ZONES_ENABLED`

- **New:** `lib/sites/zones-enabled.ts` — the `zonesEnabled()` helper.
- **Modified (matching):** `lib/sites/lookup.ts` — `findLocation` skips the zone
  candidates query.
- **Modified (read path):** `lib/flights/repo.ts` — `resolveEndpoint` suppresses zone
  ids and zone names.
- **Modified (suggestions):** `lib/sites/repo.ts` — `suggestNearbyLocations` skips zone
  query, returns empty zone arrays; `createOrAttachSiteFromFlight` rejects zone choices.
- **Modified (server actions):** `app/flights/[id]/site-action.ts` — zone undo actions
  return errors. `app/flights/[id]/boundary-action.ts` — picker omits zones, zone
  boundary actions return errors. `app/flights/[id]/community-action.ts` — zone
  community/endorsement actions return errors or null.
- **Modified (UI):** `components/flight/name-site-dialog.tsx` — `NameSiteDialog` skips
  the zone step; `SiteNameControl` never opens a zone-level community dialog.
- **Modified (tests):** New test coverage in `lib/sites/lookup.test.ts` verifying
  zone-pass-skipping; new coverage in `test/sites.integration.test.ts` verifying
  zone-display suppression and zone-creation rejection; E2E coverage adapted — existing
  `test/e2e/zones.spec.ts` continues to pass at the library level but the E2E flow
  (which goes through the UI) should confirm zones are unreachable.
- **Modified (release):** `lib/whats-new.ts` — entry explaining the simplification.
  `FEATURES.md` — note that zones are hidden, not removed.
- **Unchanged on purpose (the reversibility proof):**
  - `prisma/schema.prisma` — no column/table changes.
  - `lib/sites/geo.ts` — zone radii, `zoneRadiusForKind`, zone geometry unchanged.
  - `lib/sites/visibility.ts` — `canSeeZone` unchanged.
  - `lib/sites/associate.ts` — zone cache writers, zone transition handlers,
    `locationCachePatch` unchanged.
  - `lib/sites/boundary.ts` — zone boundary validation unchanged.
  - `lib/sites/audit.ts` — zone audit writing unchanged.
  - `lib/sites/endorsements.ts` — zone endorsement functions unchanged.
  - `lib/sites/contributors.ts` — zone contributor queries unchanged.
  - `lib/sites/community.ts` — zone community info queries unchanged.
  - `lib/sites/display.ts` — `formatLocationLabel` already handles null zone.
  - `lib/ingest/ingest-flight.ts` — the seam absorbs it (findLocation returns
    site-only).
  - `scripts/admin-sites.ts` — zone operator commands fully functional.
  - All existing zone-specific tests at the library/integration level — they call
    the underlying functions directly and prove the logic is intact.

## Files Summary

**New:** `lib/sites/zones-enabled.ts`.

**Modified:** `lib/sites/lookup.ts`, `lib/flights/repo.ts`, `lib/sites/repo.ts`,
`app/flights/[id]/site-action.ts`, `app/flights/[id]/boundary-action.ts`,
`app/flights/[id]/community-action.ts`, `components/flight/name-site-dialog.tsx`,
`lib/sites/lookup.test.ts`, `test/sites.integration.test.ts`, `lib/whats-new.ts`,
`FEATURES.md`.

**Unchanged on purpose:** `prisma/schema.prisma`, `lib/sites/geo.ts`,
`lib/sites/visibility.ts`, `lib/sites/associate.ts`, `lib/sites/boundary.ts`,
`lib/sites/audit.ts`, `lib/sites/endorsements.ts`, `lib/sites/contributors.ts`,
`lib/sites/community.ts`, `lib/sites/display.ts`, `lib/sites/name.ts`,
`lib/ingest/ingest-flight.ts`, `app/api/upload/route.ts`, `app/api/ingest/route.ts`,
`scripts/admin-sites.ts`, `scripts/admin-sites.test.ts`,
`lib/sites/write-audit.test.ts`, all existing zone test files.

## Definition of Done

- [ ] `zonesEnabled()` exists in `lib/sites/zones-enabled.ts`, reads `process.env.ZONES_ENABLED`
      fresh per call, returns `true` only for the string `"true"`, and is directly testable
      (set env var, call, restore).
- [ ] `findLocation` issues **one** DB query per endpoint (site candidates only) when zones
      are disabled — verified by a test that zones in range do not match.
- [ ] A zone that was previously matched (flight row has `takeoffZoneId` +
      `takeoffZoneName` populated) renders as site-name-only on every display surface
      (logbook, profile, feed, flight page) — verified by an integration test with a
      zone-bound flight.
- [ ] The `Flight` row's zone columns (`takeoffZoneId`, `takeoffZoneName`,
      `landingZoneId`, `landingZoneName`) are **untouched** — no nulling, no backfill,
      no write of any kind.
- [ ] `suggestNearbyLocations` returns `SiteSuggestion[]` with `zones: []` on every
      entry when zones are disabled — no zone query runs.
- [ ] `createOrAttachSiteFromFlight` rejects an input with a `zone` choice when zones are
      disabled, with a clear error; an input without a zone choice succeeds exactly as
      SPRINT-004.
- [ ] `nameSite` server action rejects a `zone` parameter with
      `{ ok: false, error: "Zones are not available." }`.
- [ ] `unpublishZoneForFlight` and `deleteZoneForFlight` return an error when zones are
      disabled.
- [ ] Zone-level community info, endorsement toggle, and rename via `community-action.ts`
      return null/error when zones are disabled.
- [ ] `listMyBoundaryEditableRows` returns `zones: []`; zone-level boundary save/clear
      actions return an error when zones are disabled.
- [ ] The naming dialog's zone step ("Which spot?") never appears — site selection submits
      directly.
- [ ] `SiteNameControl` never renders zone name text and never opens a zone-level
      community dialog.
- [ ] The boundary picker's "My spots" section does not appear.
- [ ] Zone suggestions do not appear nested under site cards in the naming dialog.
- [ ] `scripts/admin-sites.ts` zone commands (`zone-rename`, `zone-force-private`,
      `zone-merge`, `zone-boundary-clear`, `zone-audit`) work normally on existing data.
- [ ] Existing zone-specific unit tests (`lib/sites/lookup.test.ts` zone tests,
      `lib/sites/geo.test.ts` zone-radius tests, `lib/sites/visibility.test.ts`
      `canSeeZone` tests) pass unchanged — they call underlying functions directly, not
      through the now-hidden UI.
- [ ] Existing zone integration tests (`test/sites.integration.test.ts` zone matrix) pass
      when calling the underlying repo/lookup functions directly (bypassing the
      `zonesEnabled()` gate).
- [ ] New tests verify zone-disabled behavior: matching returns site-only when a zone is
      in range; display suppresses zone names on zone-bound flights; creation rejects zone
      input.
- [ ] Setting `ZONES_ENABLED=true` in the test environment makes all zone-aware tests
      pass exactly as before this sprint — the reversibility proof.
- [ ] All five gates green (`pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
      `pnpm e2e`).
- [ ] `/whats-new` entry added: friendly, benefit-oriented, explains the simplification.
- [ ] `FEATURES.md` notes zones are hidden (not removed), with a note that the underlying
      code and data are preserved for a future re-enabling.

## Risks

- **Missing a zone affordance (highest — scope risk, not correctness risk).** Zones are
  woven through 10+ files. The intent itself flags this: "the real risk is missing a spot
  (a stray zone affordance still reachable) rather than getting any one spot wrong."
  *Mitigation:* the server-side rejections are the safety net — even if a UI path
  accidentally survives, the server action refuses. The manual QA pass must specifically
  search for any remaining zone surface. *Additionally:* `zonesEnabled()` is checked at
  the server action layer (the authority), not just the UI layer (the convenience).

- **Existing zone-specific tests break because they go through the `zonesEnabled()` gate.**
  Zone tests that call `findLocation` or `resolveLocationFields` directly would suddenly
  get site-only results. *Mitigation:* the default state is `ZONES_ENABLED` absent (zones
  disabled), but existing zone-specific tests should set `ZONES_ENABLED=true` in their
  setup to keep testing the underlying logic. A helper or `beforeAll` in each zone test
  file handles this. The point is that these tests prove the logic works — they're not
  testing the gate.

- **`findLocation`'s zone-disabled path silently regresses site-only matching.** If the
  conditional placement is wrong, the site pass could be affected. *Mitigation:* the
  change is one ternary in the `Promise.all` array — `zoneCandidates` is replaced by
  `Promise.resolve([])`, nothing else changes. Existing site-only matching tests
  (SPRINT-004 vintage) are the regression guard.

- **A flight-owner who had zone undo buttons ("Unpublish spot," "Delete spot") on a
  zone-bound flight before this sprint now has no way to reach those buttons, but the
  zone is still bound under the hood.** *Accepted:* the zone binding is harmless (it's
  invisible in every surface), and re-enabling zones restores the undo affordance. If
  an operator needs to clear a zone binding in the meantime, the existing
  `scripts/admin-sites.ts` commands work.

- **Rollback.** If this sprint itself needs reverting after merge: revert the PR, and
  every zone affordance is back, every zone-bound flight shows its zone name again,
  every test passes. The sprint is entirely additive (one new file, conditionals in
  existing files); reverting removes those additions cleanly.

## Security (privacy / authz)

- **Invariant 1 (unchanged):** every SPRINT-004/005/006/007 privacy invariant —
  `canSeeSite`, `canSeeZone`, `siteVisibleWhere`, `zoneVisibleWhere`,
  `resolveLocationFields`, `locationCachePatch`, the eight `Flight` cache columns — is
  unmodified. The zone suppression in `resolveLocationFields` is a *further restriction*
  (showing less, never more), not a relaxation.
- **Invariant 2 (unchanged):** all eight denormalized columns are still written only by
  `lib/sites/associate.ts`. This sprint writes no `Flight` column at all.
- **Invariant 3 (new, narrow):** zone-level server actions are rejected when
  `zonesEnabled()` returns false. A request that somehow reaches a zone mutation (e.g.
  a crafted server-action call) fails with a generic error that reveals nothing about
  whether the zone exists, is private, or is owned by someone else — the same
  "hidden and nonexistent are indistinguishable" posture every existing action uses.
- **No new privacy surface.** This sprint removes pilot-facing surfaces, it doesn't add
  any. No new data is exposed, no new mutation is possible.
- **Zone data stays in the database.** The `Flight` zone columns, the `Zone` table rows,
  audit entries, endorsements, and boundaries are all preserved exactly. This is not a
  security concern — a zone's own visibility (`canSeeZone`, `zoneVisibleWhere`) still
  governs access at the DB query level. The sprint's gate is above that layer.

## Dependencies

- **Internal:** one PR, no ordering constraints beyond "after SPRINT-007 merges."
- **External/stack:** none new. No packages, no services, no schema change.
  `ZONES_ENABLED` is a new env var that defaults to absent (zones disabled). Railway's
  `railway.toml` does not need to set it — absence is the intended production state.
- **Data:** no migration, no backfill, no data change of any kind. The existing
  `Zone` rows, `Flight` zone columns, `LocationAuditEntry` zone entries,
  `ZoneEndorsement` rows, and zone boundaries in `Zone.boundary` are all preserved.
- **Test data:** no new fixtures needed. Existing zone-specific test fixtures continue
  to exercise the underlying logic. New tests for the disabled state use the same
  fixtures with `ZONES_ENABLED` absent.

## Open Questions

Answered here as committed decisions; revisit only if the product changes.

1. **What single mechanism gates all of this?** — **One env-read boolean,
   `zonesEnabled()`, checked at every surface.** Mirrors the existing
   `boundaryMatchingEnabled()` pattern exactly. Not a compile-time constant, not a
   database flag, not a feature-flag service — a `process.env` read, fresh per call.
   The reversibility guarantee is "set `ZONES_ENABLED=true`, restart."

2. **What happens to a flight that already shows "Site — Zone"?** — **It shows just the
   site name.** Implemented in `resolveLocationFields` (the zone id/name are suppressed),
   not by nulling `Flight` cache columns. The zone data is still on the row; re-enabling
   zones restores the display immediately.

3. **Do the zone-parallel server actions need a server-side reject?** — **Yes.** UI
   removal alone is not sufficient for defense-in-depth. Every zone mutation action
   checks `zonesEnabled()` and returns an error. The error message is generic ("Zones
   are not available.") and reveals nothing about the zone's existence or state.

4. **Do operator zone commands stay fully functional?** — **Yes.** They operate on the
   underlying data, which is intact. An operator investigating existing zone data, or
   running a merge/rename/audit, needs these tools regardless of whether zones are
   visible in the product surface.

5. **What happens to existing zone-specific tests?** — **They stay and keep passing.**
   Tests that call underlying functions directly (`findLocation` with zones in range,
   `canSeeZone`, zone creation in `createOrAttachSiteFromFlight`, etc.) set
   `ZONES_ENABLED=true` in their setup and continue to prove the logic works. This is the
   reversibility proof: the tests pass with zones enabled, proving the machinery is ready
   to be re-shown. New tests verify the disabled state separately.

6. **Does new site creation need any change beyond removing the zone step?** — **No.**
   The SPRINT-004 bare-site path (`createOrAttachSiteFromFlight` with no `zone` in the
   input) is already the default when the zone step is skipped. The naming dialog's site
   step flows directly to submission, and the result is byte-identical to a SPRINT-004
   site creation.
