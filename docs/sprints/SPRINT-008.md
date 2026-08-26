# SPRINT-008 — Hide zones (sites only, for now)

## Overview

SPRINT-005 introduced a two-level `Site` → `Zone` hierarchy. SPRINT-006 gave
both levels custom GeoJSON boundaries. SPRINT-007 gave both levels
community ownership — an audit log, a contributor roster, endorsements,
community-edit v1. Three sprints of real engineering investment, and the
user's own assessment after living with it is direct: "the zones are
getting too complicated." This sprint acts on that immediately — a pilot
should no longer be able to create, see, match against, edit, or otherwise
interact with a zone anywhere in the app.

This is a **hide, not a delete**. No schema change. No data migration. No
column nulling, no row deletion. The `Zone` table, every existing zone row,
`Flight`'s four zone columns, zone audit entries, zone endorsements, and
zone boundaries all stay exactly as they are in the database. What changes
is the product surface: a single, centralized, fail-closed gate —
`ZONES_ENABLED`, defaulting to off — checked at every place a pilot could
otherwise reach a zone. A future "bring zones back" sprint should be a
small re-exposure pass (flip the gate, verify the preserved gate-on test
suites still pass), not a reconstruction.

This sprint was planned via the same multi-agent `sprint-plan` workflow as
SPRINT-005/006/007 (Claude opus + Codex gpt-5.5 — Gemini's CLI still can't
authenticate on the free tier). Unlike SPRINT-007, the two independent
drafts converged almost completely on every product-facing question —
hide vs. delete, gate default, the fate of already zone-bound flights,
server-side rejection as mandatory. The value of the cross-critique pass
here wasn't resolving a product disagreement; it was catching a genuine
**implementation bug** both critiques independently found in the same
place: `components/flight/name-site-dialog.tsx` is a client component that
cannot read the server-only gate directly, and its zone-step logic isn't
data-driven in the first place — a fix that would have shipped broken
without the cross-critique. Full reasoning trail:
[`drafts/SPRINT-008-INTENT.md`](./drafts/SPRINT-008-INTENT.md),
[`drafts/SPRINT-008-CLAUDE-DRAFT.md`](./drafts/SPRINT-008-CLAUDE-DRAFT.md),
[`drafts/SPRINT-008-CODEX-DRAFT.md`](./drafts/SPRINT-008-CODEX-DRAFT.md),
[`drafts/SPRINT-008-CLAUDE-CRITIQUE.md`](./drafts/SPRINT-008-CLAUDE-CRITIQUE.md),
[`drafts/SPRINT-008-CODEX-CRITIQUE.md`](./drafts/SPRINT-008-CODEX-CRITIQUE.md),
[`drafts/SPRINT-008-MERGE-NOTES.md`](./drafts/SPRINT-008-MERGE-NOTES.md).

### Anchoring decisions

1. **One centralized, fail-closed, default-off gate: `ZONES_ENABLED`.**
   `lib/sites/zones-enabled.ts` exports `zonesEnabled(): boolean`, reading
   `process.env.ZONES_ENABLED` fresh on every call (never cached at module
   load) — the exact operational shape of SPRINT-006's
   `boundaryMatchingEnabled()`. Returns `true` only for the literal string
   `"true"`; absent, empty, `"false"`, `"0"`, or anything else means
   hidden. Zones are hidden the moment this sprint deploys, with no
   separate "now turn it off" step — that's what "default off" delivers.
2. **A flight already bound to a zone shows its site name only — for
   every viewer, including the owner.** Implemented in the read path
   (`lib/flights/repo.ts`'s `resolveLocationFields`/`resolveEndpoint`),
   which already re-resolves every non-null zone id against the live row
   before deciding what to return — the change is one early return when
   the gate is off. The `Flight` row's `takeoffZoneId`/`takeoffZoneName`/
   `landingZoneId`/`landingZoneName` are never written by this sprint.
   Re-enabling the gate makes every zone-bound flight show its zone name
   again immediately, with no backfill.
3. **Server-side rejection is the real gate; UI removal is UX, not
   security.** Every zone-parallel server action — zone creation, zone
   rename, zone boundary set/clear, zone unpublish/delete, zone community
   info/rename/endorsement — rejects with a generic, non-leaking error
   when the gate is off, regardless of what a stale client tab or a
   hand-crafted request sends. This was true of every prior sprint's
   authorization posture; hiding zones doesn't get a pass on it.
4. **Client components that need to know the gate state receive it as an
   ordinary server-derived prop — they never read `process.env`
   themselves.** `components/flight/flight-header.tsx` (a server
   component) calls `zonesEnabled()` once and passes the boolean down:
   `FlightHeader` → `SiteNameControl` → `NameSiteDialog`. This is the fix
   the cross-critique surfaced: the naming dialog's zone-step logic is a
   feature-availability decision made *before* any per-row zone data is
   relevant (it decides whether to render a "Which spot?" step at all,
   independent of whether *this* flight has a zone), so it cannot simply
   fall out of `resolveLocationFields` returning `zoneId: null` the way
   `SiteNameControl`'s own label rendering can.
5. **Existing zone-specific test coverage is preserved, not deleted or
   broadly skipped — split into "default-off" and "gate-on legacy"
   families.** A test whose *expected outcome* depends on old zone
   behavior (zone matching wins, zone creation succeeds, a zone-bound
   flight displays its zone name) sets `ZONES_ENABLED=true` in its own
   setup and becomes explicit gate-on legacy coverage — the concrete proof
   that reversibility is real, not just claimed. A test of a pure,
   gate-agnostic helper (`canSeeZone`, `zoneRadiusForKind`, boundary
   validation, the audit/contributor/endorsement library functions) is
   genuinely unchanged, because those functions never consult the gate at
   all — only the product-surface call sites (matching, creation, display,
   server actions) do.
6. **Operator commands (`scripts/admin-sites.ts` `zone-*`) stay fully
   functional, ungated.** They operate on preserved data outside any
   pilot's session — the same posture the existing docstring already
   states for why this script exists at all. An operator repairing,
   merging, or auditing existing zone data needs these regardless of
   whether the pilot-facing product currently shows zones.

### Explicitly out of scope (with reasons)

- **Any schema change, data migration, column nulling, or row deletion.**
  The single hardest constraint from the user's own interview answer. This
  sprint proves reversibility by construction — there is nothing to
  migrate back.
- **Removing zone-aware library code.** `lib/sites/associate.ts`'s zone
  cache writers and transition handlers, `lib/sites/boundary.ts`'s zone
  validation, `lib/sites/audit.ts`/`endorsements.ts`/`contributors.ts`/
  `community.ts`'s zone-level functions, `lib/sites/geo.ts`'s zone radii —
  all untouched. Only reachability changes.
- **Removing zone-specific test files.** Explicitly the opposite of what
  this sprint does — see anchoring decision 5.
- **A gate-on E2E CI job.** Would require a second dev-server run with a
  different environment — real infrastructure cost with no product
  requirement behind it. Gate-on reversibility proof lives at the
  unit/integration level, which is the layer that actually exercises the
  underlying machinery; E2E's job is proving UI *reachability*, and there
  is intentionally no UI left to reach for the old flow.
- **Pushing the gate into low-level `lib/sites/associate.ts` mutators.**
  Considered, rejected — it would make gate-on legacy tests harder to
  write (they need to call these functions directly), and the action-layer
  gate plus an explicit import-graph audit (PR3) gives equivalent
  coverage without that cost.
- **Changing `SITE_BOUNDARY_MATCHING`.** Orthogonal, unrelated flag, stays
  exactly as SPRINT-006 shipped it.
- **New site-level metadata, a replacement one-level-plus hierarchy, or
  any other product idea for what comes after zones.** This sprint is a
  subtraction. Nothing new ships.

## Use Cases

1. **A new pilot uploads a flight near a known site.** `findLocation`
   performs the site pass only — no `Zone` query at all. The flight
   matches "Mission Ridge," never a zone, even if zones exist in the
   database for that site and would have won under SPRINT-005 rules.
2. **A pilot opens a flight that was matched to a zone before this
   sprint.** The row still has `takeoffZoneId`/`takeoffZoneName`
   populated. The heading reads "Mission Ridge," not "Mission Ridge —
   North Launch," for the flight's own owner and for any other viewer
   alike.
3. **A flight has independently different zone states on each endpoint** —
   e.g. a takeoff zone bound, a landing zone unbound, or both bound to
   different zones. Both endpoints collapse to site-only display
   independently; there are four columns, not one state to suppress.
4. **A pilot names a new site.** The naming dialog shows the site step
   (unchanged from SPRINT-004) and submits directly on choosing or
   creating a site — no "Which spot?" step ever renders, no "Skip — just
   the site" button is needed because there's nothing to skip.
5. **Nearby-site suggestions never nest zones, and a hidden zone's
   proximity never pulls its parent site into suggestions that wouldn't
   otherwise qualify.** `SiteSuggestion.zones` is always `[]`; the ranking
   distance is the site's own distance only.
6. **A stale browser tab, or a hand-crafted request, tries to name or
   mutate a zone directly.** Every zone-parallel server action rejects
   with a generic, non-leaking error. Nothing is written — no `Zone` row,
   no `Flight` column, no audit entry, no endorsement.
7. **The owner-scoped boundary picker lists only sites.** Zone rows never
   appear; zone-level boundary editing is unreachable from any entry
   point.
8. **A viewer clicks a site label on any flight, own or someone else's.**
   The community dialog opens for the site only. If the flight was
   previously zone-bound, no zone-level community info is shown or
   reachable.
9. **A zone-bound flight whose parent site is private to the current
   viewer.** The existing `canSeeSite` check still governs — hiding the
   zone must never accidentally reveal a site name the viewer couldn't
   already see.
10. **An operator runs `zone-rename`, `zone-merge`, or `zone-audit`.**
    Every command works exactly as SPRINT-007 shipped it — these operate
    on the underlying data, unaffected by the pilot-facing gate.
11. **A future sprint sets `ZONES_ENABLED=true`.** The zone pass in
    `findLocation` resumes, zone display returns, the naming dialog's zone
    step reappears, the boundary picker lists zones again, community info
    is reachable again — every existing zone row, boundary, audit entry,
    and endorsement is immediately live. No migration, no backfill, no
    reconstruction.

## Architecture

### The gate (`lib/sites/zones-enabled.ts`)

```ts
/**
 * SPRINT-008 zone visibility gate: ZONES_ENABLED=true re-enables zones;
 * absent or any other value means zones are hidden from the product
 * surface. Read fresh (never cached at module load) so it's testable and
 * flippable without a redeploy — the same operational shape as
 * lib/sites/lookup.ts's boundaryMatchingEnabled().
 */
export function zonesEnabled(): boolean {
  return process.env.ZONES_ENABLED === "true";
}
```

One file, one function, one fresh `process.env` read. Every server-side
zone-touching surface imports and checks this directly. No caching, no
build-time inlining — a production toggle is a config change, not a
redeploy.

### Matching — skip the zone pass entirely

`lib/sites/lookup.ts`'s `findLocation`:

```ts
const [siteRows, zoneRows] = await Promise.all([
  siteCandidates(db, lat, lon, kind, viewerId),
  zonesEnabled() ? zoneCandidates(db, lat, lon, kind, viewerId) : Promise.resolve([]),
]);
```

When disabled, `zoneCandidates` never runs — no DB query. `zoneRanked` is
empty, there's no zone winner, and the existing unconditional site-fallback
path (SPRINT-005's "no dead ends" decision) always runs. `findLocation`'s
return shape is unchanged: `{ site, zone: null }` or `null`. The
zone-ranking and `canSeeZone` re-checking code stays exactly as it is —
it simply has nothing to process when the gate is off.

### The read path — suppress zone display, preserve zone data

`lib/flights/repo.ts`'s `resolveEndpoint` (called by `resolveLocationFields`
for every flight row on every surface) already resolves each endpoint's
zone id against the live `Zone` row and strips it when not visible to the
viewer. The change is one additional early return at the same point:

```ts
if (zoneId === null || !zonesEnabled()) return resolvedSite;
```

This governs logbook, feed, profile, and flight-page rendering uniformly —
one change point, not per-component suppression. The stored `Flight`
columns are never written by this code path; only what's *returned* to a
caller changes.

### Suggestions — flat sites, no hidden-zone influence

`lib/sites/repo.ts`'s `suggestNearbyLocations` skips the zone query
(mirroring the `findLocation` change) and every returned `SiteSuggestion`
has `zones: []`. Critically, the site-level distance calculation must use
`ownDistanceM` only — not `min(ownDistanceM, nearestZoneDistanceM)` — so a
site whose own anchor is out of range cannot be pulled into suggestions
solely because a now-invisible zone under it happens to be closer. This
is a real, testable behavior change (a suggestion that appears today for
this reason would stop appearing) and needs its own test, not just prose
description.

### Creation — reject a zone choice before any write

`lib/sites/repo.ts`'s `createOrAttachSiteFromFlight`:

```ts
if (input.zone && !zonesEnabled()) {
  throw new Error("Zones are not available.");
}
```

Checked before the transaction opens. An input with `zone` omitted (the
SPRINT-004 bare-site path) is completely unaffected — this is already the
shape the naming dialog produces once its zone step is gone (Architecture
→ UI, below).

### Server actions — reject, don't just hide

Every zone-parallel action across the three flight-scoped action files
rejects or null-returns when the gate is off:

**`app/flights/[id]/site-action.ts`**
- `nameSite` rejects a request carrying a `zone` choice.
- `unpublishZoneForFlight`, `deleteZoneForFlight` reject.

**`app/flights/[id]/boundary-action.ts`**
- `listMyBoundaryEditableRows` returns `{ sites, zones: [] }`.
- `saveBoundaryForFlightEndpoint`/`clearBoundaryForFlightEndpoint` with
  `level: "zone"` reject.
- `saveBoundaryForOwnedRow`/`clearBoundaryForOwnedRow` with `level: "zone"`
  reject.
- `getBoundaryForOwnedRow`/`getBoundaryForPublicRow` with `level: "zone"`
  return `null`.

**`app/flights/[id]/community-action.ts`**
- `getCommunityInfoForRow` with `level: "zone"` returns `null`.
- `renamePublicRow` with `level: "zone"` rejects.
- `toggleEndorsement` with `level: "zone"` rejects.

Error text is generic and consistent ("Zones are not available.") and
reveals nothing about whether a given zone exists, is private, or is
owned by someone else — the same "hidden and nonexistent are
indistinguishable" posture every prior sprint's actions already use.

**Import-graph audit (a task, not an assumption).** Before this sprint is
considered done, grep every caller of `lib/sites/associate.ts`'s zone
mutators (`renameZone`, `setZoneVisibility`, `deleteZone`,
`unpublishOwnZone`, `setZoneBoundary`, `clearZoneBoundary`), and of
`lib/sites/community.ts`/`endorsements.ts`'s zone-level functions, and
confirm every single caller is one of the gated actions above. If a caller
exists outside that set (a future page, a script, anything), it needs its
own explicit gate check or an explicit justification for why it's exempt
(operator tooling is the one legitimate exemption, per anchoring decision
6).

### UI — the client gate plumbing fix

This is the piece the cross-critique caught. `components/flight/
name-site-dialog.tsx` is `"use client"`; it cannot read
`process.env.ZONES_ENABLED` itself, and its zone-step decision isn't
data-driven (it's made before any specific row's zone state matters).

```text
app/flights/[id]/page.tsx (server component)
  └─ FlightHeader (server component — no hooks, plain props)
       reads zonesEnabled() directly (server-only, safe)
       └─ SiteNameControl (client component)
            receives zonesEnabled as a prop
            └─ NameSiteDialog (client component)
                 receives zonesEnabled as a prop
```

With `zonesEnabled === false` passed through:

- `NameSiteDialog`'s initial `step` is always `"site"`, even when
  `currentSiteName` is already set (today it jumps to `"zone"` in that
  case — this must not happen while the gate is off).
- `chooseSiteReuse` and `chooseSiteCreate` call `submit()` directly
  instead of `setStep("zone")`.
- `ZoneStep` is never rendered; the `Step` type keeps its `"zone"` variant
  (the type doesn't need to shrink, since it's never reached at runtime;
  removing it would be a larger, more invasive diff for no behavioral
  gain).
- `SiteStep`'s and the render tree's zone-related buttons (zone undo, zone
  boundary edit, zone community info) are not rendered when the target
  row has no reachable zone context — in practice this is already implied
  once no zone step exists to reach them from, but any standalone zone
  affordance surfaced directly on `SiteStep`/`ZoneStep` for an
  already-bound row must also check the prop.
- `SiteNameControl` forces `level` to `"site"` for its community-dialog
  trigger regardless of the (already-null, but now doubly-guarded)
  `zoneId` it receives — defense in depth on top of the data-stripping in
  the read path, not a replacement for it.

The boundary picker (`BoundaryPickerStep`) needs no direct code change:
since `listMyBoundaryEditableRows` now returns `zones: []`, its existing
"only render the zones section when non-empty" logic already produces the
right result. This is the one surface where the read-path change alone is
sufficient — worth naming explicitly so implementation doesn't add an
unnecessary redundant check.

### Operator commands — unchanged

`scripts/admin-sites.ts`'s `zone-rename`, `zone-force-private`,
`zone-merge`, `zone-boundary-clear`, `zone-audit` continue to operate on
the `Zone` table directly, outside the pilot-facing gate. No code change
in this file.

### Test strategy

- **Default-off tests** (new): assert the shipped behavior — matching
  returns site-only even with a winning zone in range, a zone-bound
  flight displays site-only on every read surface, zone creation is
  rejected, the naming dialog never shows a zone step, the boundary
  picker never lists zones, community/endorsement actions reject or
  return null for `level: "zone"`.
- **Gate-on legacy tests** (existing, adapted): any existing test whose
  expected outcome is old zone behavior sets `ZONES_ENABLED=true` in its
  own setup (a `beforeAll`/`beforeEach` or per-test env set-and-restore).
  This is the reversibility proof — these tests passing with the gate on
  demonstrates the preserved machinery still works correctly.
- **Unchanged tests**: anything testing a pure, gate-agnostic helper
  (`canSeeZone`, `zoneRadiusForKind`, zone boundary validation, the
  library-level audit/contributor/endorsement functions) needs no change
  at all — these functions never consult the gate.
- **E2E**: `test/e2e/zones.spec.ts` is repurposed to assert the new
  default-off behavior end to end (no "Which spot?" step reachable, a
  flight cannot land on a zone through the UI). The zone-specific
  scenarios inside `test/e2e/boundaries.spec.ts` and `test/e2e/
  community.spec.ts` (zone-level boundary editing, zone-level community
  dialog reachability) are removed as e2e scenarios — the UI they tested
  no longer exists to reach — with their coverage superseded by the
  gate-on unit/integration suites above, not silently dropped.

## Implementation

Four phases, landed as commits on one branch/PR — matching how SPRINT-007
actually shipped (multiple validated commits under one GitHub PR, not
multiple separate PRs). Each phase passes all five gates before the next
begins.

### PR1 — The gate, matching, read path, creation (~30% of effort)

**Files:**
- `lib/sites/zones-enabled.ts` (new) — `zonesEnabled()`.
- `lib/sites/lookup.ts` — `findLocation` skips the zone candidates query
  when disabled.
- `lib/sites/repo.ts` — `suggestNearbyLocations` skips zone query, returns
  `zones: []`, uses site-own-distance only for ranking;
  `createOrAttachSiteFromFlight` rejects a `zone` input.
- `lib/flights/repo.ts` — `resolveEndpoint` suppresses zone id/name when
  disabled.
- `lib/sites/lookup.test.ts`, `test/sites.integration.test.ts` — default-off
  matching/suggestion/creation tests; existing zone-outcome tests adapted
  to set `ZONES_ENABLED=true`.

**Tasks:**
- [ ] `zonesEnabled()` returns `false` for absent/empty/`"false"`/`"0"`/any
      non-`"true"` value, `true` only for `"true"`, reads fresh per call.
- [ ] `findLocation` issues zero `Zone` queries when disabled; a zone in
      range that would have won under the gate-on rules does not match.
- [ ] A zone-bound flight's `resolveLocationFields` result has
      `zoneId: null`/`zoneName: null` for both endpoints independently when
      disabled; the underlying `Flight` row is unchanged (verified by a
      direct DB read after the call).
- [ ] `suggestNearbyLocations` returns `zones: []` on every entry when
      disabled, and does not include a site that only qualified via a
      hidden zone's proximity.
- [ ] `createOrAttachSiteFromFlight` rejects a `zone` input when disabled,
      writing no `Zone` row; succeeds exactly as SPRINT-004 with no `zone`
      input.
- [ ] Gate-on legacy tests (existing zone matching/creation/suggestion
      tests, adapted to set `ZONES_ENABLED=true`) pass unchanged in
      outcome.
- **Depends on:** nothing.

### PR2 — UI: the client gate plumbing fix (~25% of effort)

**Files:**
- `components/flight/flight-header.tsx` — reads `zonesEnabled()` server-side,
  passes it as a prop.
- `components/flight/name-site-dialog.tsx` — `SiteNameControl` and
  `NameSiteDialog` both accept and thread the `zonesEnabled` prop; step
  machine, `SiteStep`/`ZoneStep` zone affordances, and the community-dialog
  `level` selection all respect it.
- `app/flights/[id]/boundary-action.ts` — `listMyBoundaryEditableRows`
  returns `zones: []` (already implied by PR1's read-path change flowing
  through, verified here explicitly for the picker).

**Tasks:**
- [ ] `FlightHeader` passes a real, server-computed `zonesEnabled` boolean
      into both `SiteNameControl` call sites (takeoff and landing).
- [ ] `NameSiteDialog`'s initial step is `"site"` regardless of
      `currentSiteName` when `zonesEnabled` is false; `ZoneStep` is never
      rendered; site choice submits directly.
- [ ] `SiteNameControl` never renders zone-name text (already true via data
      stripping) and never opens a zone-level community dialog (now also
      true structurally, via the prop, not just because `zoneId` happens to
      be null).
- [ ] The boundary picker's zone/"My spots" section does not render.
- [ ] Manual QA + a copy sweep: no rendered dialog/button copy in the
      default pilot flow references "spot" or "zone" (scoped to actual
      UI text, not a blind grep that would false-positive on unrelated
      strings).
- **Depends on:** PR1 (the prop's value is meaningless without the
  underlying behavior already gated).

### PR3 — Server action rejection + import-graph audit (~25% of effort)

**Files:**
- `app/flights/[id]/site-action.ts`, `boundary-action.ts`,
  `community-action.ts` — every zone-parallel action rejects/null-returns
  per the Architecture section's enumeration above.
- `test/sites.integration.test.ts`, `test/community.integration.test.ts` —
  direct-call tests proving rejection and zero writes.

**Tasks:**
- [ ] Every action listed in Architecture → "Server actions" rejects or
      null-returns when disabled, with generic, non-leaking error text.
- [ ] A rejected zone mutation writes no `Zone` row, no `Flight` column, no
      `LocationAuditEntry`, no `ZoneEndorsement` — verified by a direct DB
      read before/after the rejected call.
- [ ] Import-graph audit completed: every caller of
      `lib/sites/associate.ts`'s zone mutators and
      `community.ts`/`endorsements.ts`'s zone-level functions is one of the
      gated actions above, or is explicitly justified as operator tooling.
- [ ] A public zone under a private parent site, and a zone-bound flight
      whose parent site is private to the current viewer, both fail closed
      identically to before this sprint (the suppression doesn't
      accidentally reveal anything).
- **Depends on:** PR1.

### PR4 — Tests, docs, release pass (~20% of effort)

**Files:**
- `test/e2e/zones.spec.ts` — repurposed to assert default-off behavior.
- `test/e2e/boundaries.spec.ts`, `test/e2e/community.spec.ts` — zone-specific
  scenarios removed; site-only scenarios unaffected.
- `scripts/admin-sites.test.ts` — confirms operator zone commands still
  work with the pilot-facing gate off (no change needed to the commands
  themselves, just a confirming test).
- `docs/architecture.md` — documents zones as hidden-but-preserved, names
  the gate.
- `FEATURES.md` — the SPRINT-005/006/007 zone entries get a note that
  zones are currently hidden pending this decision; a new entry documents
  this sprint.
- `lib/whats-new.ts` — a friendly, benefit-oriented entry (newest first)
  explaining the simplification without implying data loss.
- `docs/qa-prompts/` — a QA prompt for this sprint, following precedent.
- `docs/sprints/ledger.tsv` — synced after acceptance.

**Tasks:**
- [ ] `test/e2e/zones.spec.ts` passes asserting no zone step/UI is
      reachable.
- [ ] Zone-specific scenarios in `boundaries.spec.ts`/`community.spec.ts`
      removed; remaining site-only scenarios in both files still pass
      unmodified.
- [ ] Operator zone commands verified functional with the pilot-facing gate
      off.
- [ ] `docs/architecture.md`, `FEATURES.md`, `lib/whats-new.ts` updated.
- [ ] QA prompt written.
- [ ] All five gates green: `pnpm build`, `pnpm test`, `pnpm typecheck`,
      `pnpm lint`, `pnpm e2e`.
- **Depends on:** PR1–PR3.

## Files Summary

**New:** `lib/sites/zones-enabled.ts`,
`docs/qa-prompts/QA-PROMPT-<date>-hide-zones.md`.

**Modified:** `lib/sites/lookup.ts`, `lib/sites/repo.ts`,
`lib/flights/repo.ts`, `app/flights/[id]/site-action.ts`,
`app/flights/[id]/boundary-action.ts`,
`app/flights/[id]/community-action.ts`,
`components/flight/flight-header.tsx`,
`components/flight/name-site-dialog.tsx`, `lib/sites/lookup.test.ts`,
`test/sites.integration.test.ts`, `test/community.integration.test.ts`,
`scripts/admin-sites.test.ts`, `test/e2e/zones.spec.ts`,
`test/e2e/boundaries.spec.ts`, `test/e2e/community.spec.ts`,
`docs/architecture.md`, `FEATURES.md`, `lib/whats-new.ts`,
`docs/sprints/ledger.tsv`.

**Unchanged on purpose (the reversibility proof):**
`prisma/schema.prisma`, `lib/sites/geo.ts`, `lib/sites/visibility.ts`,
`lib/sites/associate.ts`, `lib/sites/boundary.ts`, `lib/sites/audit.ts`,
`lib/sites/endorsements.ts`, `lib/sites/contributors.ts`,
`lib/sites/community.ts`, `lib/sites/display.ts`, `lib/sites/name.ts`,
`lib/ingest/ingest-flight.ts`, `app/api/upload/route.ts`,
`app/api/ingest/route.ts`, `components/flight/boundary-editor.tsx`,
`components/flight/location-community-dialog.tsx`,
`scripts/admin-sites.ts`, `lib/sites/write-audit.test.ts`, every existing
zone-specific test's underlying assertions (adapted to set the gate, not
rewritten).

## Definition of Done

- [ ] `zonesEnabled()` exists in `lib/sites/zones-enabled.ts`, reads
      `process.env.ZONES_ENABLED` fresh per call, returns `true` only for
      the literal string `"true"`.
- [ ] `findLocation` performs zero `Zone` queries and returns `zone: null`
      when disabled, even when a visible zone in range would have won
      under gate-on rules.
- [ ] With `ZONES_ENABLED=true`, every existing zone-first-matching,
      site-fallback, private-zone-visibility, parent-conjunction, and
      boundary-bearing-zone test still passes.
- [ ] `suggestNearbyLocations` returns `zones: []` on every entry, and does
      not include a site that only qualifies via a hidden zone's proximity,
      when disabled.
- [ ] A flight already bound to a zone (either or both endpoints
      independently) returns `zoneId: null`/`zoneName: null` from every
      viewer-scoped read path when disabled; the stored `Flight` row is
      byte-for-byte unchanged.
- [ ] `createOrAttachSiteFromFlight` rejects a `zone` input when disabled,
      writing nothing; succeeds identically to SPRINT-004 with no `zone`
      input.
- [ ] Every zone-parallel server action listed in the Architecture section
      rejects or null-returns when disabled, with generic non-leaking
      error text, and writes no `Zone`/`Flight`/audit/endorsement change.
- [ ] The naming dialog never renders a zone step, regardless of whether
      the target flight/site already has zone history — verified via the
      `zonesEnabled` prop threaded from `FlightHeader`, not by relying on
      per-row data being absent.
- [ ] `SiteNameControl` never renders zone name text and never opens a
      zone-level community dialog.
- [ ] The boundary picker never lists zone rows.
- [ ] Operator commands (`zone-rename`, `zone-force-private`, `zone-merge`,
      `zone-boundary-clear`, `zone-audit`) work normally regardless of the
      pilot-facing gate.
- [ ] An import-graph audit confirms every caller of `associate.ts`'s zone
      mutators and `community.ts`/`endorsements.ts`'s zone-level functions
      is a gated action or explicitly-justified operator tooling.
- [ ] A public zone under a private parent site, and a zone-bound flight
      whose parent site is private to the current viewer, both fail closed
      exactly as before this sprint.
- [ ] Gate-on legacy tests (existing zone-outcome tests, adapted to set
      `ZONES_ENABLED=true`) pass, proving the preserved machinery works.
- [ ] `test/e2e/zones.spec.ts` passes asserting default-off product
      behavior; zone-specific scenarios in `boundaries.spec.ts`/
      `community.spec.ts` are removed, remaining scenarios unaffected.
- [ ] No rendered dialog/button copy in the default pilot flow references
      "spot" or "zone" — verified by manual QA reading, not an automated
      grep gate (which would false-positive).
- [ ] All five gates green on every phase: `pnpm build`, `pnpm test`,
      `pnpm typecheck`, `pnpm lint`, `pnpm e2e`.
- [ ] `/whats-new` entry added, friendly and non-alarming (no implication
      of data loss). `FEATURES.md` and `docs/architecture.md` updated. A
      QA prompt exists under `docs/qa-prompts/`. Ledger synced.
- [ ] Deferred items **not** shipped: any schema change, any data
      migration, any low-level `associate.ts` gating, a gate-on E2E CI job,
      new site metadata, a replacement location hierarchy.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A zone affordance survives somewhere unaudited (10+ surfaces touched) | Medium | Medium | Server-side rejection is the real gate — even a surviving UI path can't write anything; the import-graph audit (PR3) and manual QA copy sweep (PR2/PR4) are the systematic sweep, not a hope-we-got-it-all approach |
| Client/server gate-state divergence (a stale tab renders zone UI the server will reject) | Low/Medium | Low | Server rejection prevents any actual write; a broken UX for a stale tab is acceptable and self-resolves on reload — explicitly named, not silently accepted |
| `findLocation`'s zone-skip regresses site-only matching | Low | Medium | The change is one ternary in one `Promise.all`; existing SPRINT-004-vintage site-only matching tests are the regression guard, unmodified by this sprint |
| Gate-on legacy tests and default-off tests get confused/miscategorized | Medium | Low | Explicit naming convention (`describe` blocks or file-level comments marking "gate-on legacy" vs. "default-off") required, not left implicit |
| A pilot who had zone-level undo (unpublish/delete a spot) on their own flight can no longer reach it while the gate is off | High by design | Low | Accepted, explicit product trade-off — the zone binding is harmless while hidden; operator remedy (`scripts/admin-sites.ts`) is documented as the escape hatch in the interim |
| Future re-enable discovers hidden code has rotted | Medium over time | Medium | Gate-on legacy tests for matcher, creation, display, community, boundary, and operator paths are required now specifically so rot is caught by CI before a future re-enable, not discovered during it |
| Rollback | — | — | The sprint is purely additive gating (one new file, conditionals in existing files, prop threading). Reverting the whole sprint restores every zone affordance immediately — no data was touched at any point |

## Security (privacy / authz)

- **Invariant 1 (unchanged, verified):** every SPRINT-004/005/006/007
  privacy invariant — `canSeeSite`, `canSeeZone`, `siteVisibleWhere`,
  `zoneVisibleWhere`, `resolveLocationFields`, `locationCachePatch`, the
  eight `Flight` cache columns — is unmodified. Zone suppression is a
  *further* restriction (showing less), never a relaxation.
- **Invariant 2 (unchanged):** all eight denormalized `Flight` columns
  remain written only by `lib/sites/associate.ts`. This sprint writes to
  no `Flight` column at all — it only changes what a read returns.
- **Invariant 3 (new, narrow):** every zone-mutation server action checks
  `zonesEnabled()` and rejects with a generic, non-leaking error when
  false — the same "hidden and nonexistent are indistinguishable" posture
  every prior action already has, extended to "gate is off" as an
  additional reason for the same generic refusal.
- **No new privacy surface, no new mutation path.** This sprint removes
  pilot-facing surfaces; it adds none. `Zone` row visibility
  (`canSeeZone`, `zoneVisibleWhere`) still governs DB-level access exactly
  as before — this sprint's gate sits entirely above that layer, as a
  product-surface decision, not a privacy boundary.
- **Zone data stays fully protected, not merely hidden by omission.** The
  gate prevents reachability; the existing visibility model still governs
  what *would* be returned if the gate were on. These are independent,
  and this sprint doesn't conflate them.

## Dependencies

- **Internal:** PR2 ⟵ PR1; PR3 ⟵ PR1; PR4 ⟵ PR1–PR3.
- **External/stack:** none new. No packages, no services, no schema
  change. `ZONES_ENABLED` is a new env var; its absence is the intended
  production state — `railway.toml` needs no change.
- **Data:** zero migration, zero backfill. Every existing `Zone` row,
  `Flight` zone column, `LocationAuditEntry` zone entry, `ZoneEndorsement`
  row, and zone boundary is preserved exactly.
- **Precedent reused directly:** `SITE_BOUNDARY_MATCHING=off`'s fresh-read,
  env-controlled, no-redeploy-needed kill-switch pattern
  (`lib/sites/lookup.ts`).

## Open Questions

Answered here as committed decisions from the two-draft convergence plus
cross-critique correction; revisit only if the product changes.

1. **What single mechanism gates this?** — **One env-read boolean,
   `ZONES_ENABLED`, default off, read fresh per call.**
2. **What happens to an already zone-bound flight?** — **Site-only display
   for every viewer; stored zone data untouched.**
3. **Do zone-parallel server actions need a server-side reject?** — **Yes,
   always** — UI removal alone is insufficient.
4. **Do operator zone commands stay functional?** — **Yes, fully, ungated**
   — they're maintenance tooling for preserved data.
5. **What happens to existing zone tests?** — **Split into gate-on legacy
   (proves reversibility) and default-off (proves shipped behavior); pure
   gate-agnostic helper tests are untouched.**
6. **How does a client component learn the gate state?** — **A
   server-derived prop, threaded from `FlightHeader` through
   `SiteNameControl` into `NameSiteDialog`.** This is the fix the
   cross-critique surfaced; without it, the naming dialog's zone step
   would not actually be suppressed.
7. **Should e2e zone coverage run gate-on in CI?** — **No** — the
   infrastructure cost (a second server env) isn't justified; gate-on
   reversibility proof lives at the unit/integration level.

**Genuinely still open** (not blocking, deliberately unanswered):

- Should a future "bring zones back" sprint reconsider the two-level model
  entirely (e.g., a lighter-weight variant), or simply re-flip this exact
  gate? Not this sprint's decision to make.
- Should `ZONES_ENABLED` eventually become a UI-configurable
  operator/admin setting rather than a deploy-time env var, if the
  product wants to toggle it more casually than "for now" implies? Left
  for whenever (if ever) that need materializes.
- Should the "no zone undo for an already-bound flight" limitation (Risk
  table) eventually get a dedicated pilot-facing remedy (e.g., a one-time
  "detach this old spot" action) short of a full re-enable? Not required
  now; operator remedy suffices at current data volume.
