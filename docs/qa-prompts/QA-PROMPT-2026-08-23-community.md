# QA Validation Prompt — Community-owned public sites and zones (SPRINT-007)

## Summary

A public `Site`/`Zone` is community property now, not one pilot's exclusive
record. Any **signed-in, onboarded** pilot can rename it or redraw its
boundary — not just its creator. Every change is attributed in an
append-only history, a contributor roster shows who's shaped a place, and any
pilot can endorse a site with a one-tap upvote. Destructive actions (delete,
demote to private) stay creator-only and now also lock once another pilot has
made a real edit — a bare endorsement never blocks it. Private sites/zones
are completely unaffected — still owner-only, exactly as before this sprint.

## Changes Overview

**Storage** — `LocationAuditEntry` (append-only, `siteId?`/`zoneId?`
discriminated), `SiteEndorsement`/`ZoneEndorsement` (composite-PK, one vote
per pilot per row). No new `Flight` column. The audit log only ever records
a mutation made while the row is public — a private row's edit history is
never written, so nothing leaks if it's later published.

**Edit-control** — public rename and boundary set/clear are open to any
onboarded pilot. Publishing/unpublishing a row and deleting it stay
owner-only. Deleting/demoting a public row is additionally refused once
another pilot has made a real edit (an endorsement alone does not count).

**Reachability** — a public site/zone's name is now clickable from **any**
flight that shows it, including one you don't own, including while signed
out (read-only then). This opens a new dialog — separate from the existing
"name this site" flow, which still only lets the flight's own owner choose
which site/zone applies to *that* flight:
- Contributors (who's edited this, oldest contribution first)
- Recent history (expandable — who did what, when)
- An endorsement count + toggle (signed-in pilots)
- Rename and "Redraw boundary" actions (signed-in, onboarded pilots)

**Operator remedy** — `scripts/admin-sites.ts merge`/`zone-merge` carry a
merged-away row's history and endorsements onto the survivor instead of
dropping them. `boundary-clear`/`zone-boundary-clear` now log an
operator-attributed entry. New `audit <siteId>` / `zone-audit <zoneId>`
print a row's full history.

## Validation Scenarios

### The headline case — reachability and community editing

- **A stranger reaches and edits a public site from someone else's
  flight.** Pilot A uploads a flight and names a public site. Pilot B (a
  different account, never having flown there) views Pilot A's **public**
  flight, taps the site name, and should see the community dialog — not the
  inert text from before this sprint. Pilot B renames the site. Reload both
  Pilot A's and Pilot B's views of the flight — both should show the new
  name.
- **Redraw a boundary you didn't create.** From the same dialog, Pilot B
  redraws the site's boundary (reuses the SPRINT-006 editor). Confirm the
  new shape saves and a flight inside the new area but outside the old one
  auto-associates.
- **Binding stays separate from editing.** Pilot A (the flight owner)
  should still see their own existing "name/rebind this site" flow
  unchanged, alongside (or via) the new community info — confirm choosing a
  *different* site for their own flight still works exactly as before.
- **Anonymous/signed-out reach.** View a public flight while signed out —
  the site name should be clickable, the dialog should show contributors/
  history/endorsement count, but no "Endorse," "Rename," or boundary-edit
  affordance should be usable (or they should prompt for sign-in).
- **Private stays private.** A private site's/zone's label must remain
  plain, non-clickable text for anyone but its owner — confirm no community
  dialog is reachable for it under any circumstance.

### Accountability signals

- **Contributor roster.** After two different pilots have each made a
  deliberate edit (rename, boundary) to the same public site, both should
  appear in its contributors list — ordered by first contribution, creator
  first. A pilot whose flight merely auto-matched there (no edit) should
  **not** appear.
- **History.** Expand a public site's history — a rename should show the
  old and new name; a boundary change should show a vertex count, not raw
  geometry; each entry should show who did it and roughly when.
- **Endorsements.** Endorse a public site as a pilot who has never edited
  it — the count increments. Endorse it again as the site's own creator or
  a prior editor — should also succeed (self-endorsement is allowed by
  design). Tap "Endorse" a second time as the same pilot — it should toggle
  off and the count should drop back down.

### The delete/demote guard

- **A creator can still undo their own honest mistake.** Create a new
  public site, don't let anyone else touch it, delete it as the creator —
  should succeed exactly as before this sprint.
- **A creator can no longer quietly delete community-edited work.** Create
  a public site, have a *different* pilot rename it or redraw its boundary,
  then try to delete or demote it as the original creator — should be
  refused with a clear "other pilots have contributed" style message.
- **An endorsement alone does not lock it.** Create a public site, have a
  different pilot **only** endorse it (no edit), then delete it as the
  creator — should still succeed. This is a deliberate distinction from the
  case above; worth double-checking specifically.

### Rate limiting

- **The daily community-edit cap.** As a signed-in pilot, rename or redraw
  boundaries on 20 different public rows in one day (yours or others') —
  the 21st rename-or-boundary-edit attempt that day should be refused with
  a daily-limit message, **regardless of whether the first 20 were renames,
  boundary edits, or a mix of both** (one shared counter, not two
  independent per-action budgets).

### Operator remedy

- **Merge carries history forward.** Create two public sites, have a
  non-owner rename one of them (so it has real audit/contributor history),
  then `pnpm exec tsx scripts/admin-sites.ts merge <fromId> <intoId>` —
  `audit <intoId>` afterward should show the rename entry AND a new `merge`
  entry, not just what the survivor already had.
- **`audit`/`zone-audit`.** Run both against a site/zone with some history —
  confirm output is most-recent-first and identifies each actor by handle
  (or "operator/deleted pilot" where there's no attributable pilot).
- **Operator boundary-clear is attributed.** Run `boundary-clear <siteId>`
  on a boundary-bearing public site, then `audit <siteId>` — the resulting
  `boundary_cleared` entry should show no pilot handle (operator-attributed,
  distinct from a pilot's own clear).

## Regression Checks

- Every SPRINT-004/005/006 scenario in the prior QA prompts should still
  hold unchanged — this sprint is additive to matching/privacy/boundary
  behavior, and changes ONLY who may rename/boundary-edit a public row.
- Private-site/zone behavior (naming, boundary editing, delete/unpublish)
  is byte-for-byte unchanged — spot-check the existing owner-only flows.
- `/whats-new` shows "Sites you make public are community property now" at
  the top.
- No new N+1 query pattern on any list/feed/logbook view — those views
  should look and load exactly as before; the new community info only
  appears in the flight-page dialog.

## Environment Notes

- **Two pilot accounts are required** for nearly every scenario above — this
  sprint's whole point is cross-pilot editing. A third account is useful for
  the contributor-roster-with-two-editors and endorsement-toggle checks.
- Existing in-repo coverage to **avoid duplicating**: `test/community.
  integration.test.ts` covers the audit log, derived contributor roster,
  endorsement mechanics (including the effective-visibility conjunction for
  zones), the onboarded-caller check, the community-footprint delete guard,
  and the daily cap at the data layer. `test/sites.integration.test.ts`'s
  "SPRINT-006 PR3: boundary write path" and "zone transitions" sections
  cover the community-edit-vs-private-row authorization boundary directly.
  `scripts/admin-sites.test.ts` covers merge/boundary-clear history
  carrying and the `audit`/`zone-audit` commands. `test/e2e/community.
  spec.ts` drives the real reachability/rename/endorse flow end to end
  across three separate pilot sessions. Those were written by the same
  agent that built the feature — **independent exploratory passes on the
  actual community dialog** (does it feel discoverable? is "Endorse" vs.
  "Rename" vs. "Redraw boundary" clear at a glance? does the history read
  naturally?) are the real gap.
