# QA Validation Prompt — Custom boundaries for sites and zones (SPRINT-006)

## Summary

A pilot can now draw a custom polygon boundary for a site or zone they own, in
place of the fixed-radius circle SPRINT-004/005 used. A boundary **replaces**
the circle for that one row — it never widens or narrows anything else — and
a row with no boundary keeps matching exactly as it did before this sprint.
The boundary editor is reachable two ways: a shortcut once a site/zone is
already bound to the flight you're viewing, or — the headline fix this sprint
adds — an **owner-scoped picker** ("Edit a boundary on one of my sites")
reachable from the naming dialog even when nothing is bound yet, so you can
expand a site whose endpoints currently fall outside its old circle.

## Changes Overview

**Storage** — `Site`/`Zone` each gain an optional `boundary` (a GeoJSON
polygon), four derived bbox columns, and a `boundaryUpdatedById` attribution
column. No PostGIS; no new `Flight` column.

**Matching** — `findLocation` unions a boundary-bbox prefilter into the
existing circle-bbox one; a row with a boundary matches by point-in-polygon
**only** (a point inside the old circle but outside a *tighter* boundary no
longer matches; a point outside the old circle but inside a *looser* one
does). Ranking stays anchor-distance-only — a drawn boundary never
out-ranks a nearer, unrelated site by virtue of being a boundary. A
malformed stored boundary is skipped at match time (fails closed), never
thrown into ingest.

**Editing** — reached from the flight-page naming dialog:
- Once a site/zone is bound to the flight you're viewing: "Edit boundary" /
  "Edit site boundary" / "Edit spot boundary" shortcuts appear next to the
  existing Unpublish/Delete affordances.
- **New reachability path:** "Edit a boundary on one of my sites" opens a
  picker listing every site/zone you own or edit-control (including zones
  under sites you own), regardless of whether the current flight is bound to
  anything. This is what makes it possible to expand a site whose endpoints
  are currently outside its circle — there's no flight bound to it yet to
  reach a shortcut from.
- The editor shows the anchor (must stay inside the drawn shape), the old
  circle as a dashed reference ring, the parent site's geometry when editing
  a zone (context only, never enforced), and other nearby visible sites'/
  zones' geometry faintly (context for scale, since zone boundaries are
  **not** capped near the old circle size — see below).
- Tap to add a point, drag a point to move it, tap a point to remove it,
  Undo last point, a confirmed Clear, a confirmed Remove boundary (back to
  circle matching), and live vertex/area/validity feedback while drawing.

**A deliberate, discussed tradeoff:** zone boundaries are **not** capped
near the old 300–400 m circle scale. A pilot can draw a zone boundary several
km² large. This means a big public zone boundary can, via the "zones win
before sites are even considered" rule, out-rank nearby sites for **every**
pilot's ingest — not just the drawer's own. The mitigations are the editor's
nearby-context display, generous-but-present area/vertex caps, a
per-caller daily edit-write cap, and the one-command operator remedy below —
not a tight size limit. If you're specifically stress-testing this sprint,
this is the area most worth extra attention.

**Operator remedy** — `scripts/admin-sites.ts boundary-clear <siteId>` /
`zone-boundary-clear <zoneId>` restore circle matching in one command, no
ownership gate. `merge`/`zone-merge` now refuse to silently drop a source
row's boundary onto a boundary-less target unless run with `--force` (which
carries the boundary across instead). `list <siteId>` now reports boundary
presence, vertex count, area, and who last touched it.

**Rollback lever** — setting `SITE_BOUNDARY_MATCHING=off` in the
environment reverts every row to circle-only matching with no data change,
if boundary matching needs to be turned off in production without a
redeploy.

## Validation Scenarios

### The headline case — reachability

- **Expand a site past its old circle, with no flight bound to it.** Name a
  new public site from one flight. From a **different, unrelated** flight
  (nothing bound), open the naming dialog and click "Edit a boundary on one
  of my sites" — the site you just named should appear in the picker even
  though this flight has nothing to do with it. Draw a shape reaching past
  the old circle in one direction, save. Upload a third flight whose takeoff
  sits past the old circle but inside the new shape — it should auto-name
  itself with **zero** dialog interaction.
- **The bound-flight shortcut still works.** On a flight already bound to a
  site you own, open the dialog — "Edit boundary" (site step) or "Edit site
  boundary" / "Edit spot boundary" (spot step) should appear and jump
  straight to the editor for that row, no picker needed.
- **The parent-site-owner reachability fix.** As a site's owner, use the
  picker to find and edit a **zone** contributed by a *different* pilot
  under your site — this should work even if you've never flown from that
  zone yourself (no flight of yours ever bound to it).

### Matching correctness

- **Tighter than the circle.** Draw a boundary smaller than the existing
  600 m/900 m or 300 m/400 m circle. A flight inside the old circle but
  outside your new shape should no longer auto-match — confirm it lands as
  "Unknown site" (or falls through to a different, still-eligible row).
- **Looser than the circle.** The headline case above already covers this
  for a site; repeat for a zone (draw a zone boundary reaching past its
  300 m/400 m circle, confirm a flight in that gap renders "Site — Zone").
- **No dead ends, still.** A site/zone with no boundary must keep matching
  exactly as before this sprint — spot-check a few existing (pre-SPRINT-006)
  sites still auto-associate flights normally.
- **`kind: "both"` rows.** Draw a boundary on a site/zone used for both
  takeoff and landing; confirm a flight whose *landing* falls in the shape
  auto-names, and separately confirm one whose *takeoff* does too.

### Validation and refusal

- **Anchor exclusion.** Try to draw a shape that doesn't contain the site's/
  zone's own marked location — Save should be disabled and an explanatory
  message shown live, before you even try to submit.
- **Absurd shapes.** Try a self-crossing (bow-tie) outline, a near-zero-area
  sliver, and (if you can zoom out enough) something enormous — each should
  be refused with a specific, readable reason, live while drawing.
- **Server is still the authority.** If you have API/devtools access, try
  submitting a boundary that skips the client (e.g. replay a save request
  with a modified payload) — the server must independently refuse the same
  shapes the client does.

### Undo, clearing, and the operator remedy

- **Clear vs. Remove boundary.** "Clear" during drawing (before saving)
  should require a confirm and reset your in-progress shape. "Remove
  boundary" on an already-saved boundary should require a confirm and
  revert that row to circle matching — confirm a flight that only matched
  via the (now-removed) boundary stops auto-associating afterward, while
  flights that were already bound stay bound.
- **A boundary edit never un-binds anything.** After tightening or removing
  a boundary, confirm flights that were already matched — yours **and**
  another pilot's, if you can arrange a second account — keep their
  binding. Only *future* matching changes.
- **Operator remedy.** `boundary-clear <siteId>` / `zone-boundary-clear
  <zoneId>` should always succeed and restore circle matching immediately.
  `merge <fromId> <intoId>` between a boundary-bearing source and a
  boundary-less target should refuse without `--force`, and carry the
  boundary across when forced — confirm with `list <siteId>` before/after.

## Regression Checks

- Every SPRINT-004/005 scenario in `docs/qa-prompts/QA-PROMPT-2026-08-19-sites.md`
  and `QA-PROMPT-2026-08-20-zones.md` should still hold unchanged — this
  sprint is additive. Spot-check the plain two-step naming flow (create/
  reuse/skip) with no boundary interaction at all.
- Web upload and device-push ingest both still work end to end.
- `/whats-new` shows "Draw the actual shape" at the top.
- The editor works with **no** `NEXT_PUBLIC_MAPTILER_KEY` set (it uses the
  keyless "Map" basemap specifically) and is usable on a touch device —
  tap-to-add, drag-to-move, and the confirm dialogs should all work with
  fat-finger-sized targets.

## Environment Notes

- Every scenario is reachable through the normal browser UI; the
  server-side-bypass validation check needs API/devtools access.
- Two pilot accounts are needed for the parent-site-owner zone reachability
  scenario and the "boundary edit never un-binds another pilot's flight"
  check.
- Existing in-repo coverage to **avoid duplicating**: `lib/sites/geo.test.ts`
  and `lib/sites/boundary.test.ts` cover point-in-polygon, validation, and
  normalization as pure logic; `lib/sites/boundary-editor-state.test.ts`
  covers the editor's vertex/undo/live-validation state machine without
  needing a browser. `lib/sites/lookup.test.ts` and
  `test/sites.integration.test.ts` cover boundary-aware matching, the
  privacy-matrix re-run, the write path, and reachability at the data
  layer. `scripts/admin-sites.test.ts` covers the operator commands.
  `test/e2e/boundaries.spec.ts` drives the real drawing UI end to end
  (picker reachability, drawing past the old circle, and the
  anchor-exclusion refusal). Those were written by the same agent that
  built the feature — **independent exploratory passes on the actual
  drawing interaction** (touch behavior, the live feedback copy, how it
  feels to draw a large shape) are the real gap.
