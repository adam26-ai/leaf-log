# QA Validation Prompt — Two-level site hierarchy: Site + Zone (SPRINT-005)

## Summary

A pilot can now name a specific spot **within** a site they've already named — a
"North Launch" or "Lower LZ" inside "Mission Ridge" — not just the site itself. The
naming dialog becomes an optional second step: name/reuse the site (unchanged), then
an optional "Which spot?" step with **Skip — just the site** as a first-class action.
Matching is zone-first at a tighter radius, with the site match always available as a
fallback — a bare site (no named spots) keeps working exactly as it did before this
sprint. This extends SPRINT-004's privacy seam one level: zone visibility is
**independent** of its parent site's, so a pilot can keep their own launch spot
private even under a site that's otherwise public to everyone.

## Changes Overview

**Zone model**
- `Zone` belongs to exactly one `Site` (required `siteId`); has its own `ownerId` and
  `visibility` (`private`/`public`, **no column default**).
- `Flight.{takeoff,landing}ZoneId/ZoneName` are a cache, same contract as the
  SPRINT-004 site columns — **except** a deleted zone's cached name is *not* kept as
  history (a deleted site's is); there's nothing to remember about a spot that no
  longer exists.

**Matching**
- Zone radius is tighter than the site radius (300 m takeoff / 400 m landing vs. 600 m
  / 900 m). The site pass always runs as a fallback, regardless of whether the winning
  site has zones — naming one spot at an already-flown site must never "un-name" a
  nearby flight that used to match the bare site.

**Naming a spot** (flight page, same dialog as SPRINT-004, now two steps)
- Step 1 (site) is unchanged. If a site is already bound to the endpoint, the dialog
  opens **directly** to step 2.
- Step 2 ("Which spot?") offers nearby zones to reuse first, a name field, a
  Public/Private toggle (**Public is disabled** when the parent site is private — you
  can't publish a spot under a place nobody else can see), and **Skip — just the
  site** as a first-class button.
- Creating (or reuse-binding) a zone retroactively upgrades the **creator's own**
  already-site-bound flights at that spot too, not only previously-unmatched ones —
  the fix for the "my logbook shows two different names for the same place" problem.
- The daily create cap (10/day per pilot) now counts sites **and** zones together.

**Undo** — same dialog, shown when the currently-bound zone is the viewer's own **or**
they own the parent site:
- **Unpublish** / **Delete** — guarded the same way as SPRINT-004's site undo: refused
  once another pilot's flight depends on it.
- **New this sprint:** the site's own owner can also rename/unpublish/delete a zone a
  *different* pilot contributed under their site — a scoped exception to "no
  moderation," justified because the site owner already has the power to demote/delete
  the whole site (taking every zone with it); this just makes it targetable.

**Operator remedy** — `scripts/admin-sites.ts zone-rename|zone-force-private|zone-merge
<zoneId> ...` and `list <siteId>` (prints a site with its zones), same "no ownership
gate, full DB authority" shape as the SPRINT-004 site commands. `zone-merge` also
handles reparenting a zone to a different site entirely.

## Validation Scenarios

### The privacy matrix — the highest-value area, one dimension deeper

The property from SPRINT-004 still holds, plus a new one: **a private zone's identity
must never reach a viewer who can't see it, even through a flight or site that viewer
legitimately can see — and a public zone's name must never survive its parent site
going private.**

- **Private spot, public site.** Name a site public, then add a private spot under it.
  As the spot's owner: the flight shows "Site — Spot." As anyone else (friend,
  stranger, signed out) on a public flight bound to it: the flight shows just the
  **site** name — never the spot, never "Unknown site" either (the site itself is
  still public).
- **The incoherent row, if you can reach it.** There's no UI path to create a public
  spot under a private site (the Public toggle is disabled) — if you have DB access,
  ask an engineer to hand-write one. It must render as if the spot doesn't exist to
  everyone but the site's owner, on every surface.
- **Demote the site, watch the spot follow.** Name a site public with a public spot,
  confirm both show to a stranger, then unpublish (or force-private) the **site**. The
  spot's name must also disappear for everyone but the owner — with **no separate
  action taken on the spot itself**. Re-publish the site and confirm the spot's name
  comes back automatically (its own visibility was never touched).
- **Cross-surface consistency, one level deeper.** Repeat SPRINT-004's cross-surface
  check (flight page, profile-as-viewed-by-a-friend, friend's feed) with a private
  spot instead of a private site.
- **Stale/hand-edited data, one level deeper.** If you have DB access: hand-write a
  `Flight.takeoffZoneName` pointing at a private zone while the id still points there
  — must still show correctly to a non-owner. Separately, hand-write a zone id that
  belongs to a *different* site than the flight's cached site id — must render the
  site alone, not a mismatched "Site — Spot."

### Naming, dedup, matching, and re-association

- **The core two-step flow.** Upload a flight far from anything → "Unknown site" →
  name the site, public → the dialog advances to "Which spot?" with **Skip — just the
  site** visible → skip it → headline shows just the site name, exactly like
  SPRINT-004. This must feel like nothing changed if you don't engage with step 2.
- **Add a spot to an already-named site.** Re-open the naming dialog on that same
  flight (or a different flight already bound to that site) — it should open
  **directly** to "Which spot?", not re-ask for the site.
- **No dead ends.** Name a spot at a site, then check a flight that lands **outside**
  the spot's radius but still inside the site's — it should still show the bare site
  name, not "Unknown site." (This is the property most likely to regress if the
  matching logic changes.)
- **Retroactive upgrade — the headline scenario.** Fly the same site several times
  *before* anyone names a specific spot there (all showing the bare site name). Then
  name a spot at that location. Your **older** flights at that spot should upgrade to
  "Site — Spot" too, not just new ones — check your logbook right after saving.
- **A public spot name can't collide with another public spot** under the same site —
  try creating one with the same name as an existing public spot; expect a refusal
  with a steer to reuse, not a silent duplicate.
- **A private spot's name never blocks (or gets blocked by) a same-named public
  one** under the same site — this should just work, creating two distinct rows.
- **Public disabled under a private site.** Open "Which spot?" under a site you've
  kept private — the Public toggle should be visibly disabled with an explanation, not
  just silently rejected on save.
- **Opposite-endpoint spot reuse widens its match kind** — name a takeoff spot, then
  on a different flight reuse that same spot for a *landing*; a third flight landing
  there later should auto-match.
- **The shared daily cap** — sites and zones now count against the same 10/day limit;
  confirm hitting it via a mix of both still refuses cleanly.

### Undo, including the new site-owner power

- **Zone creator's own undo** — name a spot, immediately unpublish/delete it (no one
  else has used it yet) — works the same shape as SPRINT-004's site undo.
- **Undo disappears once someone else depends on it** — have a second pilot's flight
  bind to the spot, confirm the original creator's Unpublish/Delete options are gone
  (or refused if attempted).
- **New: the site owner can fix someone else's spot.** As the site's owner, find (or
  create) a flight of yours bound to a spot a *different* pilot contributed under your
  site — confirm you now see Unpublish/Delete for that spot too, even though you
  didn't create it. This only reaches the UI on a flight **you** own that has the
  contributed spot bound to it (there's no "browse sites" page in this release) — if
  you need to fix a spot on someone else's flight entirely, that's still the operator
  script.
- **The site owner's fix is still blocked while the spot's own creator depends on
  it** — if the pilot who created the spot has their own flight bound to it, the site
  owner's delete/unpublish attempt should still be refused.
- **Deleting the last spot under a site leaves it fully working** — delete the only
  spot at a site; the flight should fall back cleanly to the bare site name, and a
  brand-new flight at that same location should still match the site.

### Operator remedy — engineer-run, not pilot-facing

- `zone-rename <zoneId> "<name>"` updates the spot and every flight currently showing
  its cached name.
- `zone-force-private <zoneId>` demotes regardless of who depends on it.
- `zone-merge <fromZoneId> <intoZoneId>` reassigns every flight referencing the first
  spot onto the second (works even across two different sites — this is also the
  reparenting fix for a spot created under the wrong site), then removes the first.
- `list <siteId>` prints a site with every zone under it — useful for confirming any
  of the above landed correctly.

## Regression Checks

- Every SPRINT-004 scenario in `docs/qa-prompts/QA-PROMPT-2026-08-19-sites.md` should
  still hold — this sprint is additive, not a rewrite. Spot-check a few, especially
  the bare-site (no spots at all) path.
- Web upload and device-push ingest both still work end to end with the new
  zone-aware matching in the same transaction.
- `pnpm exec tsx scripts/backfill-sites.ts` still runs cleanly (it remains
  intentionally site-only for now — no zone backfill exists yet, since production has
  no zones to backfill).
- `/whats-new` shows "Launches and LZs, by name" at the top.

## Environment Notes

- Every scenario is reachable through the normal browser UI except the
  incoherent-row and stale-cache-row cases, which need direct DB access (ask an
  engineer to set those up).
- Two-plus pilot accounts needed for the cross-pilot privacy matrix, the site-owner-fixes-a-contributed-spot
  scenario, and the "someone else depends on it" undo-guard tests — for the
  site-owner scenario specifically, you'll want the SAME pilot to own the site and
  have their own flight bound to a spot a *different* pilot created there.
- Existing in-repo coverage to **avoid duplicating**: `lib/sites/geo.test.ts`,
  `visibility.test.ts` (now includes `canSeeZone`'s full truth table), and
  `lib/sites/display.test.ts` (the "Site — Spot" label formatting) are pure logic.
  `test/sites.integration.test.ts` has the full two-level matrix, extended leak sweep,
  stale-row defence, transitions, ingest-race, create/dedup/reuse/cap/reassociate, and
  both the zone-creator and site-owner undo paths. `scripts/admin-sites.test.ts`
  covers the new operator commands. `test/e2e/zones.spec.ts` covers both the bare-site
  and two-level browser paths end to end. Those were written by the same agent that
  built the feature — **independent exploratory passes on the actual UI** (the
  dialog's two-step states, error copy, the disabled-Public-toggle explanation) are
  the real gap, along with anything that only shows up through real human clicking.
