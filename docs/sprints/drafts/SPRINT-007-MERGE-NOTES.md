# SPRINT-007 Merge Notes

Gemini could not participate — its CLI's free-tier auth is still not supported
(`IneligibleTierError`), the same gap as SPRINT-005 and SPRINT-006. Proceeded
with Claude (opus, max effort) and Codex (gpt-5.5, extra-high effort) per the
weather report's Sprint Planning consensus pair; the report itself now notes
"Gemini can improve consensus in some cases" rather than requiring it.

## The central fork

Both drafts agreed on almost everything — storage shapes, backfill necessity,
privacy discipline, PR ordering — but split on the one question that actually
matters: does "community owned" change **who can edit** a public site/zone,
or only add visibility on top of the existing single-owner model?

- **Claude's draft**: signals only. `ownerId` and all edit-control stay
  exactly as today; audit/roster/endorsements are pure additions. Argued this
  as the lower-risk path, deferring edit-control to a follow-up sprint.
- **Codex's draft**: community-edit v1. Any signed-in, onboarded pilot can
  rename or redraw the boundary of a *public* site/zone; destructive actions
  (delete, demote) stay guarded and lock once the row has a community
  footprint.

Each draft's cross-critique zeroed in on exactly this fork and refused to
let it pass silently — both critiques independently concluded the sprint
could not be merged without a human decision here, and both sketched what
the DoD would need to add depending on which way it went. That's the
strongest signal in this entire planning pass: two independently-run agents,
each grading the *other's* draft, arrived at the same "this is the one
question that must be asked" conclusion.

**Interview answer: Community-edit v1.** The user picked the Codex-draft
direction — this sprint changes who can edit public rows, not just what's
displayed about them.

## Claude draft strengths adopted

- **Derived contributor roster** (`DISTINCT actorId` on the audit log) over
  Codex's separate `SiteContributor`/`ZoneContributor` tables. Both critiques
  converged here: a materialized table is a second write that can drift from
  the audit log if a future refactor forgets it; deriving is always
  consistent by construction, and at this scale (single-digit to low-hundred
  edits per row) the query cost is negligible. Codex's own critique of the
  Claude draft *conceded* this point (critique §2, strength 3) even while
  arguing the opposite fork on edit-control.
- **Nullable-FK audit table** (`siteId?`/`zoneId?` with a `num_nonnulls = 1`
  CHECK) over Codex's polymorphic `(targetType, targetId)` no-FK design.
  Real Prisma relations, real referential integrity, real indexed FK lookups
  — Claude's own critique of the Codex draft (§6) made this case and Codex's
  critique of Claude's draft (§2.6) only pushed back on the *cascade*
  behavior, not the FK itself. Resolved below by keeping the FK but changing
  what happens on operator merge (not by dropping the FK).
- **No dedicated `endorsementCount` column** — batch `groupBy` counts,
  matching the shipped `Kudo` pattern exactly. Both drafts agreed here.
- **Endorsements never affect matching/ranking, PR ordering (schema → wire
  writes → endorsements/UI → operator/E2E), and the "audit is display
  context, not a restoration mechanism" framing.** Unchanged from Claude's
  draft; Codex didn't meaningfully contest any of it.

## Codex draft strengths adopted

- **The community-edit policy itself** (now that the interview picked this
  fork): public rename and boundary set/clear open to any signed-in,
  onboarded pilot; `setSiteVisibility`/publish stays owner-only (a private
  row going public is still that owner's privacy call); destructive actions
  gain a `hasCommunityFootprint` guard.
- **`hasCommunityFootprint` as a concrete, testable predicate** extending the
  existing `referencedByOthers`/`siteHasOtherOwnedZone` guards. Both
  critiques praised this as a well-shaped generalization of a pattern the
  codebase already has.
- **Backfilling `boundaryUpdatedById` as a contributor**, not just `ownerId`.
  Claude's critique of the Codex draft explicitly flagged this as something
  the Claude draft's backfill missed (§5 of "strengths," gap acknowledged).
  Adopted as-is: the backfill migration seeds a contributor (via a backfilled
  audit entry) for both the current owner and the existing
  `boundaryUpdatedById` value where they differ.
- **Operator merge must carry audit/contributors/endorsements forward**, not
  silently drop them. Both critiques agreed this was underspecified in both
  drafts. Resolved *without* adopting Codex's no-FK table: on
  `scripts/admin-sites.ts merge`/`zone-merge`, re-point surviving audit
  entries' `siteId`/`zoneId` to the merge target (an `UPDATE`, not a
  cascade-delete-and-lose) *before* the source row is deleted, and re-run the
  contributor/endorsement upsert against the survivor. The FK model supports
  this exactly as well as a no-FK model would — the gap was a missing
  requirement, not a schema limitation.
- **Rename rate limiting.** Claude's critique of the Codex draft flagged the
  missing symmetry with `DAILY_BOUNDARY_EDIT_CAP`; adopted directly — a new
  `DAILY_RENAME_CAP` (same value, 20/day/caller) applies to community
  renames the same way the existing cap applies to boundary edits.
- **Effective-visibility gating for zone endorsement/edit**, not a check
  against the zone's own `visibility` in isolation. Both critiques caught
  that Claude's original sketch checked the zone's own field instead of the
  SPRINT-005 conjunction (`canSeeZone`'s zone-AND-parent-site rule). Fixed in
  the final design: every new mutation/read path for a zone reuses the exact
  conjunction the codebase already enforces elsewhere, not a parallel check.

## The biggest gap neither draft actually solved: UI reachability

Codex's critique of the Claude draft (§2.2) caught something both drafts'
own "Use Cases" sections quietly assumed away: `SiteNameControl`
(`components/flight/name-site-dialog.tsx`) is owner-only today —
`if (!isOwner) return <As>{label}</As>;` — plain, non-interactive text for
every other viewer. Both drafts describe a stranger opening "the naming
dialog" to see contributors/endorsements/history, and — now that the
interview picked community-edit v1 — to actually rename or redraw a
boundary. None of that is reachable through the current component.

This is promoted from "gap" to a first-class, required piece of this
sprint's UI work: `SiteNameControl` needs a **public, read-first mode** for
non-owner viewers of a public site/zone (community info always visible;
edit actions visible and enabled once the row is public, regardless of
ownership; private rows keep today's inert-text behavior for everyone but
the owner). This is not new-scope-for-its-own-sake — without it, the
sprint's actual product ask ("other users can upvote," "a roster of who
contributed," and now "any pilot can edit") has no way to happen.

## Interview refinements applied

1. **Edit-control scope → Community-edit v1.** Resolves the central fork.
   Public site/zone rename and boundary set/clear open to any signed-in,
   onboarded pilot. Destructive actions (delete, demote to private) stay
   creator-only and gain the `hasCommunityFootprint` guard.
2. **Self-endorsement → allowed, still exactly one vote per pilot per row.**
   The user's own phrasing ("yes but only one upvote per user max") confirms
   both halves of Claude's original design: no restriction on endorsing your
   own contribution, and the composite PK (`[siteId, profileId]`) is what
   actually enforces the one-vote cap — not a self-endorsement exclusion.
   Codex's vote-removal-on-later-contribution mechanic is **not** adopted —
   the interview answer makes it unnecessary complexity.
3. **Delete guard → unchanged from today.** Endorsements and the contributor
   roster do **not** block ordinary delete/demote. The existing guard
   (`referencedByOthers`/`siteHasOtherOwnedZone` — blocks only when another
   pilot's flight or zone actually depends on the row) is extended by
   `hasCommunityFootprint` to *also* block once another pilot has made a
   community edit (a real, load-bearing contribution) — but a bare
   endorsement, with no edit behind it, never blocks deletion. This is a
   narrower footprint definition than Codex's original draft (which counted
   votes too) and directly answers Claude's critique's flagged edge case
   ("a brand-new site with one drive-by upvote gets permanently locked") by
   simply not counting votes toward the guard.
4. **Edit eligibility → signed in + onboarded, no flight-count minimum.**
   Matches how endorsements and most of the rest of the app already gate
   access. The backstop against abuse is the rename/boundary rate caps, the
   audit trail, and operator remedy — not a flight-count gate at the door.

## Rejected/deferred ideas, with reasoning

- **Codex's separate contributor tables with `contributionCount`.** Rejected
  in favor of the derived roster (see above) — both critiques converged on
  this being the safer choice regardless of which edit-control fork won.
- **Codex's vote-removal-on-later-contribution.** Made moot by interview
  answer 2 (self-endorsement is simply allowed).
- **Codex's polymorphic no-FK audit table.** Rejected — the FK design gets
  the same merge-survivability property via an explicit re-pointing
  requirement on `admin-sites.ts merge`, without giving up referential
  integrity or Prisma relations.
- **Approval queues, edit proposals, moderation voting, comments, reports,
  trust levels, notifications.** Both drafts explicitly excluded these;
  neither critique contested it. Stays out of scope — this sprint is
  "accountable direct edits," not a governance system.
- **New metadata fields (wind, hazards, parking, etc.).** Explicitly
  out-of-scope per the user's own seed ("later on we can add additional
  metadata"). Both drafts agreed; kept out.
- **Curated/null-owner site handling (Codex draft's backfill edge case).**
  No longer applicable — the curated site seed was removed entirely
  (`feat(sites): remove the curated site seed — fully community-driven`,
  merged before this sprint). Every `Site`/`Zone` row has a non-null
  `ownerId` by construction now; the backfill has no null-owner case to
  handle.
- **Private-row audit trail that only becomes visible on publish.** Neither
  draft specified an enforcement mechanism (both critiques caught this as a
  live privacy gap, from opposite directions). Resolved by the simplest rule
  that closes it completely: **audit entries are only written while the row
  is public at the time of the mutation.** A private row's create/rename/
  visibility history produces zero audit rows — there is nothing to leak,
  because nothing was recorded. When a private row is published, a
  `published` audit entry is written (no reference to the prior private
  name). The contributor roster (derived from audit) therefore only ever
  reflects a row's public history, which is exactly the scope the feature
  asked for ("community property... if it is public").
- **Rename-collision/edit-war resolution (locking, merge UI, etc.).** Both
  critiques flagged the total absence of conflict handling as a real gap.
  Full resolution (locking, last-write-wins-with-warning, etc.) is
  out-of-scope for v1 — Postgres's own row-level serialization makes
  concurrent renames land as ordinary last-write-wins (whoever's transaction
  commits second wins, both are recorded in the audit log), which is no
  worse than the status quo for any other multi-writer field in the app and
  doesn't need new machinery to be safe. Called out explicitly as an
  accepted risk, not silently ignored.
