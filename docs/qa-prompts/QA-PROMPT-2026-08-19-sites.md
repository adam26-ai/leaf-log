# QA Validation Prompt — User-generated site locations (SPRINT-004)

## Summary

A pilot can now name their own unmatched takeoff or landing — right on the flight page —
and choose **public** (shared with every pilot, a real addition to the gazetteer) or
**private** (theirs only). A later flight, theirs or anyone else's, web-uploaded or
device-pushed, auto-associates with a public site with no interaction. This is the app's
**first shared, user-generated content**: a public site authored by one pilot lands in
every pilot's logbook, which is why the read path is this pass's highest-priority area —
a private site's name must never leak through a public flight bound to it.

## Changes Overview

**Site model**
- `Site` gains `ownerId` (null for the 12 curated seeds), `visibility` (`private`/`public`,
  **no column default** — every create must state intent), `normalizedName` (dedup key).
- `Flight.{takeoff,landing}SiteName` is now strictly a **public-name cache**. `Site` is
  authoritative whenever the id is non-null; the cache is used only when the id is null
  (a genuinely deleted site's historical fallback).

**Naming a site** (flight page, takeoff headline + a new landing line, owner only)
- Click the headline (or the landing line) → a dialog offers **nearby sites to reuse
  first** (kind-agnostic, ≤5, within 2 km, with distance + bearing), then a naming form
  below with **Public preselected** and consequence copy before save
  ("Public shares this name and location with every pilot").
- Reusing a site from the opposite endpoint (e.g. binding an existing takeoff-kind site
  to a landing) widens its `kind` to `both` and never narrows it.
- Creating near an existing visible site with a matching name is refused with a steer to
  reuse instead of silently creating a near-duplicate.
- Creating retroactively re-associates the **creator's own** other unmatched flights near
  that spot (capped at 200) — other pilots' flights are never touched by this.
- A daily create cap (10/day per pilot) refuses further creates once hit.

**Undo** — same dialog, shown only when the currently-bound site is the viewer's own:
- **Unpublish** (public → private) — only while no other pilot's flight depends on it.
- **Delete** — same guard. Once another pilot's flight references the site (either
  endpoint), it's community property and both options disappear.

**Operator remedy** — `scripts/admin-sites.ts rename|force-private|merge <siteId> ...`,
run outside any session with full DB authority (no moderation queue exists in v1; this is
the only fix for a bad public name once someone else depends on it).

## Validation Scenarios

### The privacy matrix — the highest-value area

This is the property the whole sprint exists to guarantee: **a private site's identity
(id and name) must never reach a viewer who can't see it — even through a flight that
viewer legitimately can see.**

- **The core shadowing case.** Owner names a takeoff **private**, then sets the *flight*
  to **public**. As the owner: the flight page shows the real name. As a friend, a
  stranger, and signed out: the flight is visible (it's public) but the headline reads
  **"Unknown site"** — not the private name, not the site id in any inspectable form
  (view source / network tab on the flight-page request).
- **Same case, landing endpoint.** Repeat with the new landing line — it's a newer code
  path and deserves its own pass, not just "probably the same as takeoff."
- **Cross-surface consistency.** The same shadowing must hold on the flight page, the
  owner's profile page (as viewed by a friend), and the friend's `/feed` — all three read
  through `lib/flights/repo.ts`, so a real bug would likely show on all three, but the
  feed's extra kudos-count join is worth checking hasn't opened a gap.
- **Public site, every viewer.** A public site's name shows identically to the owner, a
  friend, a stranger, and signed out. This is the positive control — if this breaks,
  something is over-hiding, not under-hiding.
- **Friends-only flight.** A friend sees the site name; a non-friend is denied the
  **flight itself** (redirect/404), so the site-name question never even arises for them.
- **Orphaned private site.** Not easily reachable through the UI — ask an engineer to
  demote a site to private and then null its `ownerId` directly (simulating the account
  behind it being deleted). Confirm it's visible to literally nobody, including signed out.
- **Stale/hand-edited data.** If you have DB access, hand-write a `Flight.takeoffSiteName`
  pointing at a private site's name while `takeoffSiteId` still points at that private
  site. The flight page must still show "Unknown site" to a non-owner — the read path is
  supposed to re-verify the live `Site` row every time, not trust the cached column.

### Naming, dedup, and re-association

- **Happy path.** Upload a flight far from every curated site (a training hill, a random
  field) → headline reads "Unknown site" → name it, Public, save → headline updates
  **without a page reload**. Reload the page — it's still there.
- **Reuse-first.** Name a site near (but outside the auto-match radius of) an existing
  one — the dialog should offer it as a suggestion before you get to the "create new"
  form. Tapping "Use this site" must not create a second site (confirm site count).
- **Duplicate name is refused.** Try to name a *new* site with the same name as one
  already within ~2 km — expect a rejection with a message pointing at reuse, not a
  silently-created near-duplicate.
- **Opposite-endpoint reuse widens kind.** Create a site by naming a takeoff, then on a
  different flight, name the *landing* by reusing that same site. It should now match on
  **both** ends for future flights (ask an engineer to confirm `kind` in the DB, or just
  confirm a third flight's landing near that spot auto-associates).
- **Auto-association, no interaction.** After naming a public site, upload a **second,
  distinct** IGC (not a byte-identical re-upload — dedupe would just no-op) from nearby.
  It should land already named, with zero clicks in the naming dialog.
- **Retroactive fix on your own history.** If you have older flights near a spot you're
  about to name, naming it should immediately update those older flights' headlines too —
  check your logbook right after saving, not just the flight you were on.
- **Private site is invisible to auto-match for anyone else.** Name a private site, then
  (as a different pilot, or ask an engineer to simulate) upload a flight from the same
  spot — it must **not** auto-associate; that pilot still sees "Unknown site" and can name
  their own.
- **The daily cap.** Ten site creates in a day (from one account) should refuse an
  eleventh with a clear "try again tomorrow" message, not a silent failure or a crash.
- **No fix, no affordance.** A flight missing a landing GPS fix (short/corrupt IGC) should
  not offer a clickable landing line at all — confirm there's nothing to tap, not a broken
  dialog if tapped.
- **Name validation, quick pass:** a 1-character name is rejected; a 61-character name is
  rejected; "Unknown Site" / "unnamed" / "n/a" are rejected as reserved; a name in a
  non-Latin script (e.g. accented French, CJK, Cyrillic) is accepted and displays
  correctly everywhere it's shown.

### Undo

- **Unpublish.** Name a site public, immediately unpublish it (no one else has flown from
  there yet) — the flight-page headline should still show the name **to you**, but a
  signed-out check of the same (still-public) flight should now show "Unknown site."
- **Delete.** Same setup, delete instead — the flight reverts to "Unknown site" for
  everyone, including you.
- **Undo disappears once someone else depends on it.** Name a site public, have a second
  pilot's flight auto-associate or explicitly reuse it, then confirm neither Unpublish nor
  Delete is offered to the original creator anymore (or, if offered, that clicking it is
  refused with a clear message rather than silently succeeding).

### Operator remedy (`scripts/admin-sites.ts`) — engineer-run, not pilot-facing

- `rename <siteId> "<name>"` updates the site and every flight currently showing its
  cached name.
- `force-private <siteId>` demotes regardless of who depends on it (this is the one
  override of the undo guard, by design) — confirm cached names clear everywhere.
- `merge <fromSiteId> <intoSiteId>` reassigns every flight referencing the first site onto
  the second, then removes the first — confirm no flight is left pointing at a
  now-deleted id, and the target's `kind` widens if needed.

## Regression Checks

- Web upload and device-push ingest still work end to end (flight page renders, metrics
  correct) — the shared `ingestFlight()` seam changed to a transaction with an
  in-transaction site re-check.
- The friends/kudos/feed privacy matrix from SPRINT-003 is unaffected — re-run a quick
  smoke pass on `/feed` and a friend's profile page.
- `scripts/backfill-sites.ts` (the pre-existing backfill sweep) still runs cleanly; it now
  covers landing sites too (previously takeoff-only) and takes `--site-id`/`--public-only`.
- `/whats-new` shows the new "Name your own launch" entry at the top.

## Environment Notes

- Every scenario is reachable through the normal browser UI except the orphaned-site and
  stale-cache-row cases, which need direct DB access (ask an engineer to set those up).
- Two-plus pilot accounts needed for the cross-pilot privacy matrix and the "someone else
  depends on it" undo-guard tests.
- Existing in-repo coverage to **avoid duplicating**: `lib/sites/geo.test.ts`,
  `visibility.test.ts`, and `name.test.ts` (pure logic — radius math, the visibility truth
  table, name normalization/validation) and `test/sites.integration.test.ts` (the full
  matrix, leak sweep, stale-row defence, transitions, the ingest-race test, feed cursor
  stability, create/dedup/reuse/cap/reassociate, and the undo guard). Those were written
  by the same agent that built the feature — **independent exploratory passes on the
  actual UI** (the dialog's states, error copy, the "no fix, no affordance" edge case) are
  the real gap, along with anything that only shows up through real human clicking rather
  than a scripted matrix.
