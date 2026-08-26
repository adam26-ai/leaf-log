# QA Validation Prompt — Hide zones, sites only for now (SPRINT-008)

## Summary

Zones — the "spot within a site" concept from SPRINT-005, with boundaries
(SPRINT-006) and community ownership (SPRINT-007) added on top — are hidden
from the pilot-facing product. A pilot can no longer create, see, match
against, edit the boundary of, or view community info for a zone anywhere in
the app. **This is a hide, not a delete**: every `Zone` row, every `Flight`
zone column, and all zone-aware matching/boundary/audit/endorsement code
stays exactly as it was — only reachability changed, behind one centralized,
fail-closed, default-off gate (`ZONES_ENABLED`). Sites are completely
unaffected: naming, matching, boundaries, and community ownership on sites
all work exactly as they did before this sprint.

## Changes Overview

**The gate** — `lib/sites/zones-enabled.ts`'s `zonesEnabled()` reads
`process.env.ZONES_ENABLED` fresh on every call. `true` only for the literal
string `"true"`; absent (the production default), empty, `"false"`, or
anything else means hidden.

**Matching** — a flight endpoint always resolves to a site now; the zone
pass in `findLocation` never runs when the gate is off.

**Display** — a flight bound to a zone *before* this sprint (existing data)
now shows just its site name to every viewer, including the flight's own
owner. Nothing was deleted from the `Flight` row — only what the read path
returns changed.

**Naming dialog** — no "Which spot?" step. Choosing or creating a site saves
and closes the dialog directly, the same one-step outcome SPRINT-004
originally shipped.

**Boundary picker** — "Edit a boundary on one of my sites" no longer lists a
"My spots" section, only "My sites."

**Server actions** — every zone-parallel action (naming a zone, unpublishing/
deleting a zone, editing a zone's boundary, viewing/renaming/endorsing a
zone's community info) is rejected server-side with a generic "Zones are not
available" message, not just hidden from the UI.

**Operator tooling is unaffected** — `scripts/admin-sites.ts`'s `zone-*`
commands (rename, force-private, merge, boundary-clear, audit) keep working
regardless of the gate, for cleaning up existing zone data if ever needed.

## Validation Scenarios

### The headline case — zones are simply not there

- **Naming a brand-new site.** Upload a flight to an unnamed location, tap
  "Unknown site," enter a name, choose Public or Private, and save — the
  dialog should close immediately with the new site name showing. No
  "Which spot?" step, no "Skip — just the site" button (there's nothing to
  skip), no mention of "spot" anywhere in the dialog.
- **Reusing a nearby site.** Upload a second flight near the first — the
  "Nearby sites" suggestion list should offer the site with no nested
  "spots" sub-list under it. Choosing it should bind and close immediately.
- **Re-opening an already-named site.** Open the dialog on a flight whose
  site is already named — it should land on the site-editing view (rename/
  unpublish/delete/edit boundary/contributors), never a "Which spot?" step.
- **The boundary picker.** From the naming dialog, tap "Edit a boundary on
  one of my sites" — the picker should list "My sites" only. No "My spots"
  section should appear, even for a pilot who owns real zones from before
  this sprint.

### Existing zone-bound flights degrade gracefully

- **A flight named "Site — Spot" before this sprint.** Find (or use an
  operator command to inspect) a flight bound to both a site and a zone from
  before SPRINT-008. Its flight-page header should now show just the site
  name — no " — Spot" suffix — for every viewer, including the flight's own
  owner. This should hold on the logbook, a public profile, and the feed
  too, not just the single-flight page.
- **The owner isn't offered the old zone via the dialog either.** Open the
  naming dialog on that same flight as its owner — it should behave exactly
  like any other already-site-bound flight (no zone step, no "Current"
  zone badge, no way to re-select or remove the old zone binding from the
  UI). The zone binding is inert, not reachable, not editable.

### Server-side rejection (defense in depth)

- These are best confirmed by an engineer via a direct call or DevTools,
  not by clicking through the UI (the UI never offers the affordance to
  begin with) — worth a quick spot-check rather than skipping:
  - Calling the naming action with a zone choice attached should be
    refused with "Zones are not available," and should create no `Zone`
    row.
  - Calling the zone-boundary-edit or zone-community actions directly
    (with a real, pre-existing zone id from before this sprint) should be
    refused the same way, with no change to that zone's row.

### Operator tooling still works

- `pnpm exec tsx scripts/admin-sites.ts zone-rename <zoneId> "New Name"` on
  an existing zone should still succeed and update the row, even though no
  pilot can see the result anywhere in the product.
- `pnpm exec tsx scripts/admin-sites.ts zone-audit <zoneId>` should still
  print that zone's full history.

## Regression Checks

- Every SPRINT-004/006/007 **site**-level scenario in the prior QA prompts
  should still hold unchanged — site naming, matching, boundaries, and
  community ownership are untouched by this sprint.
- Site-level community info (contributors, history, endorsements) should
  still be fully reachable and functional — only the zone half of SPRINT-007
  is hidden.
- `/whats-new` shows "Simplifying: just sites for now" at the top, and reads
  as a simplification, not a data-loss warning.
- No new N+1 query pattern or visible slowdown on any list/feed/logbook
  view — the gate should be invisible performance-wise, not just
  functionally.

## Environment Notes

- **One pilot account is enough** for nearly every scenario above — unlike
  SPRINT-007, this sprint's changes don't require cross-pilot interaction to
  observe.
- A flight bound to both a site and a zone from before this sprint is the
  one fixture worth setting up deliberately (`ZONES_ENABLED=true` briefly,
  or a local operator/DB action, to create one) — everything else uses
  ordinary post-SPRINT-008 flows.
- Existing in-repo coverage to **avoid duplicating**: `lib/sites/lookup.test.ts`,
  `test/sites.integration.test.ts`, and `test/server-actions.zones-disabled.
  test.ts` cover the gate's matching/display/creation/rejection behavior at
  the data layer, including the "existing zone-bound flight degrades to
  site-only" case. `test/e2e/zones.spec.ts` (repurposed this sprint) drives
  the default-off naming flow end to end. Those were written by the same
  agent that built the feature — **an independent read of the naming
  dialog and boundary picker** (does anything still *feel* like it's
  referencing a "spot" or "zone" that isn't actually there anymore? does the
  simplified flow feel like a regression or an improvement?) is the real
  gap.
