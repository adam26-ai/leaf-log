# SPRINT-007 Codex Draft — Critique

> Reviewed by Claude against the intent document, the Claude draft, and the
> current codebase (`lib/sites/associate.ts`, `prisma/schema.prisma`,
> `lib/sites/visibility.ts`).

## The central divergence: edit-control

The two drafts answer the intent document's open question 8 ("one sprint or
two?") in opposite ways:

- **Codex draft**: one sprint — open community editing (any signed-in pilot can
  rename or redraw a public site/zone boundary) alongside the new
  infrastructure (audit, contributors, votes).
- **Claude draft**: two sprints — ship the infrastructure first (audit,
  contributors, endorsements), defer edit-control broadening to a follow-up.

The Codex draft is more faithful to the user's seed ("NOT owned by one user").
The Claude draft is more conservative, arguing the infrastructure is a
prerequisite for any sane edit-control change and should ship alone. Both
positions are defensible. The critique below evaluates the Codex draft on its
own terms — assuming community editing IS in scope — while flagging where that
decision creates risks the draft doesn't fully address.

---

## Strengths

1. **Directly addresses the user's core ask.** "NOT owned by one user" is hard
   to satisfy without actually changing who can edit. The Codex draft ships a
   real community-edit model, not just community display. A pilot who sees a
   typo on a public site can fix it without asking the creator.

2. **Community footprint as a destructive-action guard.** The
   `hasCommunityFootprint` concept — any non-owner contributor, vote, audit
   event by another actor, or other-owned child zone blocks creator
   delete/demote — is a well-thought-out extension of the existing
   `referencedByOthers` guard. It makes "community property" a concrete,
   testable predicate.

3. **Transactional discipline is explicit and thorough.** The six-step
   transaction (re-read → validate → mutate → contributor upsert → vote cleanup
   → audit append) is spelled out as a contract, not left to implementors. The
   "mutation without audit is worse; audit without mutation is not acceptable"
   framing is the right way to think about atomicity.

4. **Audit table survives merges and deletes.** The polymorphic
   `(targetType, targetId)` design with no FK means audit history isn't
   silently destroyed when an operator merges two sites. This is a genuine
   advantage over the Claude draft's `onDelete: Cascade` approach, where
   deleting a site erases its entire audit trail.

5. **Backfill covers `boundaryUpdatedById`.** The Claude draft only backfills
   `ownerId` as the initial contributor. The Codex draft also seeds the
   boundary updater as a contributor with a `boundary_set` backfill audit
   entry. This captures real history the Claude draft drops.

6. **Operator tooling is in scope.** The Codex draft extends `admin-sites.ts`
   so merges carry forward contributors, votes, and audit. The Claude draft
   defers operator audit to a follow-up, which is a weaker accountability story
   given that operators are the most powerful actors in the system.

7. **Vote/contributor exclusion is conceptually clean.** Separating
   "contributed" from "endorsed" keeps endorsement closer to "outside
   legitimacy" — a count of pilots who agree the site is right, distinct from
   the pilots who shaped it. The transactional vote removal on contribution is
   a nice touch.

---

## Weaknesses

### 1. Bundling edit-control with infrastructure is the highest-risk choice

The intent document rates scope uncertainty as "High." The Codex draft bundles
the riskiest possible scope decision (any signed-in pilot can edit any public
site) with three new table families and a backfill migration. If the
community-edit model needs to change post-ship (too permissive, too
restrictive, needs approval queues), the infrastructure is entangled with the
policy. Shipping the additive signals first would let the community-edit
policy be designed against real data (who contributes? how often? what goes
wrong?).

### 2. No edit-conflict or edit-war mitigation

With single-owner edits, two pilots can't simultaneously rename the same site.
With community edits, they can. The draft mentions "existing validators" and
"rate limits" but doesn't address:

- **Concurrent renames**: two pilots rename "Mission Ridge" at the same
  moment — which name wins? The audit log records both, but the user
  experience is "my rename silently disappeared."
- **Edit wars**: pilot A renames to X, pilot B renames back to Y, repeat.
  There is no cooldown, no lock, no escalation. The existing per-caller
  daily boundary edit cap (`DAILY_BOUNDARY_EDIT_CAP = 20`) applies to
  boundaries but there is no equivalent for renames.
- **Vandalism recovery**: a stranger renames "Mission Ridge" to something
  offensive. Any pilot can rename it back, but the vandal can rename it
  again. The only mitigation is "operator remedy" — manual intervention via
  `admin-sites.ts`. At a handful of sites this is fine; it's worth stating
  explicitly that this is the plan.

### 3. The `canCommunityEditSite` sketch is too permissive

The architecture section shows:

```ts
function canCommunityEditSite(site, callerId): boolean {
  return site.visibility === "public" || site.ownerId === callerId;
}
```

This returns `true` for an unauthenticated caller viewing a public site
(because `callerId` is unused when `visibility === "public"`). The prose says
"requires an authenticated Profile row" but the sketch doesn't enforce it,
and it's the sketch implementors will copy-paste. The function should require
`callerId` to be non-null for the public-edit path.

### 4. Separate contributor tables create a dual-write obligation

Four new tables (`SiteContributor`, `ZoneContributor`, `SiteVote`,
`ZoneVote`) plus the audit table means every mutation has five writes. The
contributor tables are a materialized summary of what the audit log already
records. If a future refactor writes audit but forgets the contributor upsert,
the roster diverges from reality — silently. The Claude draft's approach
(derive contributors from `SELECT DISTINCT actorId` on the audit log) is
always consistent by construction, at negligible query cost at this scale.

The Codex draft's `contributionCount` column on the contributor row adds
another drift risk: if the count gets out of sync with the actual audit
entries, there's no reconciliation mechanism.

### 5. Vote/contributor exclusion adds UX friction for marginal benefit

At this scale (a handful of pilots, single-digit endorsement counts), the
rule "if you fix a typo, your endorsement disappears" will confuse real users
more than it prevents abuse. A pilot who endorsed "Mission Ridge" and later
corrects a boundary vertex loses their endorsement — a penalty for
contributing. The abuse case this prevents (editors inflating their own
endorsement count by one) is not a real threat at this community size.

### 6. The polymorphic audit table trades integrity for durability

`(targetType, targetId)` with no FK means:
- No referential integrity — the application must handle orphan references
  (audit entries pointing to deleted/merged sites) in every read path.
- No Prisma relation — audit queries must use raw SQL or `findMany` with
  manual filtering, not Prisma's relation API.
- The `targetType` string is enforced by a CHECK constraint, but `targetId`
  can point to a nonexistent row with no database-level complaint.

The Claude draft's nullable-FK approach (`siteId? / zoneId?` with
`num_nonnulls = 1` CHECK) gives Prisma relations, referential integrity, and
indexed FK lookups. The tradeoff is that `onDelete: Cascade` destroys audit on
site deletion — but as the Claude draft argues, a site can only be deleted
when no other pilot depends on it, so the destroyed audit records only the
creator's own actions.

Both are defensible; the Codex draft should acknowledge the integrity tradeoff
rather than presenting the no-FK design as purely advantageous.

---

## Gaps in risk analysis

### 1. Private-row audit leaking on publication

The PR2 description says "Update existing create/publish/rename/boundary
set/clear paths to record audit and contributors in the same transaction."
This wires audit into ALL mutations, not just public-row mutations. If a pilot
creates a private site named "My Secret Spot," renames it three times, then
publishes it, the audit entries from the private phase become visible (the row
is now public, and audit entries exist for those private renames).

The draft's "Explicitly out of scope" section says "Public audit for private
edits before publication" and "Publishing records 'published'; it does not
reveal what the private row used to be called." But the implementation section
doesn't describe how this is enforced. Do private-row mutations skip audit
writes entirely? Or are private-phase audit entries filtered out of public
reads? Neither strategy is specified, and the gap creates a real privacy risk.

### 2. No rate limit on community renames

The existing `DAILY_BOUNDARY_EDIT_CAP` (20 per day per caller) applies to
boundary edits. There is no equivalent for renames. A single pilot could
rename a public site 100 times in a day. The risk section mentions "rate
limits" as mitigation but doesn't specify what limits apply to renames.

### 3. "Onboarded" is undefined

The DoD says "any signed-in, onboarded pilot" can community-edit. Open
question 1 asks whether editing should require "at least one ready flight in
the account." Neither the architecture nor the implementation section resolves
this — the community policy sketch checks only for a public row, not for any
onboarding criterion beyond authentication.

### 4. What happens to audit when an operator merges sites?

The risk section mentions that the no-FK audit design survives merges, and
PR4 says merge "carries contributors/votes/audit forward or records exactly
what was dropped." But the architecture section doesn't specify how audit
entries are carried forward. Are `targetId` values rewritten to the merge
survivor? Are they left pointing at the now-deleted source? If left orphaned,
how do read queries find them? The merge behavior needs a concrete design, not
just a goal statement.

### 5. No mention of the `setZoneVisibility` asymmetry

The codebase has a deliberate asymmetry: `setZoneVisibility` is zone-owner-
only (not site-owner), while other zone operations use `findZoneEditableBy`
(zone owner OR site owner). The Codex draft's community edit policy says
"public Zone edit requires the zone and parent site to be effectively public"
but doesn't address whether `setZoneVisibility` should also become community-
editable (which would be a significant escalation — any pilot could publish or
unpublish a zone). The Claude draft doesn't change visibility control at all,
sidestepping the issue.

---

## Missing edge cases

1. **Profile deletion cascade on contributor count.** When a profile is
   deleted, `SiteContributor` cascades — removing that pilot from the roster.
   But `LocationAuditEvent.actorId` is `SetNull`, so the audit entry survives
   as "a deleted pilot renamed this site." The contributor roster and the audit
   log now disagree about who contributed. Is this acceptable? Should the
   contributor count be reconciled?

2. **Curated/null-owner rows.** The backfill section mentions "curated/null-
   owner rows get an actor-null audit entry but no contributor row." But the
   community edit policy doesn't address these rows. Can any signed-in pilot
   edit a public curated site with no owner? The `canCommunityEditSite` sketch
   returns `true` for any public row regardless of `ownerId`, so yes — but
   this means the very first community edit makes that pilot the sole
   contributor, which might surprise the operator who created it.

3. **The "one vote blocks delete" threshold.** Open question 6 asks whether a
   single upvote should block creator demotion/delete. The draft says yes.
   This means a brand-new public site that receives one drive-by upvote before
   the creator decides they made a mistake is permanently locked. The creator's
   only remedy is operator intervention. This is a very low threshold — the
   Claude draft avoids the problem by not tying endorsements to delete guards.

4. **Effective-public zones under private sites.** The draft correctly notes
   that a public zone under a private site is not community-editable (the
   SPRINT-005 conjunction). But what about audit entries already written for
   that zone when it was under a public parent? If the parent is later
   privatized, those audit entries are still in the database. The read API
   section says zone summaries require `canSeeZone(zone, site, viewerId)`, so
   they'd be filtered — but the audit entries themselves contain public names
   that were legitimate at write time. Is this acceptable?

---

## Definition of Done assessment

The DoD is comprehensive — 17 items covering backfill, privacy, authorization,
audit atomicity, contributor criteria, vote mechanics, N+1 prevention,
operator tools, and E2E. Gaps:

| Missing from DoD | Risk |
|---|---|
| Concurrent/conflicting community edits resolve without silent data loss | Edit wars are undetectable without a DoD item |
| Private-row mutations do not create audit entries visible after publication | Privacy leak (see gap 1 above) |
| Community renames are rate-limited | Rename spam is unmitigated |
| "Onboarded" is defined as a concrete, testable predicate | Authorization boundary is ambiguous |
| Backfill is safe to run on a database with existing community tables (re-run after a failed deploy) | Idempotency is mentioned in prose but not in DoD |
| Audit entries for merged targets are findable and display correctly | Merge durability is claimed but not verified |

The existing items are well-written and testable. The sprint would benefit
from adding the six items above.

---

## Summary

The Codex draft is ambitious, thorough, and directly responsive to the user's
ask. Its strongest contributions are the community-footprint guard, the
merge-surviving audit design, the `boundaryUpdatedById` backfill, and the
in-scope operator tooling. Its biggest risk is bundling the edit-control
change with the infrastructure — if community editing needs to be revised
post-ship, the entanglement makes that harder. The missing edit-conflict
mitigation and the private-audit-leak gap are the two issues most likely to
cause real problems in production.

The Claude draft is safer but potentially under-delivers on the user's intent.
Its derived-contributor approach and simpler schema are engineering advantages,
but deferring edit-control means shipping a sprint where "community owned"
means "community can see" — which may not be what the user wanted.

A possible synthesis: ship the Codex draft's community-edit model, but adopt
the Claude draft's derived-contributor approach (no separate contributor
tables), add a rename rate limit, specify the private-audit-leak prevention
strategy, and define "onboarded" as a concrete gate. That gets the user's
core ask without the dual-write risk or the privacy gap.
