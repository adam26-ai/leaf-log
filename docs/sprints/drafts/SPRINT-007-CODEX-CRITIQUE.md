# Critique - SPRINT-007 Claude draft (Community signals for public sites and zones)

Reviewed: [`SPRINT-007-CLAUDE-DRAFT.md`](./SPRINT-007-CLAUDE-DRAFT.md) against
[`SPRINT-007-INTENT.md`](./SPRINT-007-INTENT.md), my prior
[`SPRINT-007-CODEX-DRAFT.md`](./SPRINT-007-CODEX-DRAFT.md), and the current
location/social patterns in `lib/sites/associate.ts`,
`components/flight/name-site-dialog.tsx`, `lib/social/kudos.ts`, and
`scripts/admin-sites.ts`.

**Verdict.** Claude's draft is a strong, low-risk implementation plan for
accountability signals: audit, contributors, endorsements, backfill, privacy
gating, and PR ordering are mostly concrete. The largest problem is product
fit. The seed says public sites and zones should be "community property" and
"NOT owned by one user"; Claude explicitly keeps the single-owner edit-control
model unchanged. That may be the right v1 if the human chooses a two-sprint
path, but it should not be silently merged as the answer to SPRINT-007. The
final sprint needs a firm interview decision on public-row edit-control, then
must close the read-surface, effective-visibility, audit retention, and
operator-merge gaps below.

## 1. Strengths

1. **The additive architecture is coherent.** If the product decision is
   "signals first, edit-control later," the proposed storage maps well to that
   goal: one audit table, Kudo-like endorsement join tables, no denormalized
   count, no `Flight` schema change, and no matching/ranking behavior change.

2. **The draft respects the existing privacy model.** It correctly treats
   `Flight` cache columns, `canSeeSite`/`canSeeZone`, and the no-site-URL policy
   as load-bearing constraints. Keeping community surfaces inside existing
   flight/location flows is consistent with SPRINT-004/005/006.

3. **Contributor derivation from audit is a defensible v1 choice.** Avoiding a
   separate contributor table eliminates dual-write consistency risk. At the
   expected site/zone edit volume, grouping audit rows is likely cheaper than
   maintaining materialized summaries.

4. **The contribution definition is crisp.** "Deliberate edit, not automatic
   match" is the right boundary. Including create, rename, visibility, and
   boundary set/clear avoids turning every pilot who flew nearby into a steward.

5. **The plan keeps `boundaryUpdatedById` in place.** Running audit alongside
   SPRINT-006's last-writer column is pragmatic. It avoids turning this sprint
   into a cleanup of the boundary subsystem.

6. **PR sequencing is sane.** Schema/backfill first, audit wiring second,
   endorsements/UI third, operator/E2E/release fourth is reviewable and keeps
   rollback mostly additive.

7. **The DoD is unusually executable.** It names concrete constraints, backfill
   behavior, transaction placement, toggle mechanics, display locations,
   privacy behavior, E2E coverage, release docs, and deferred scope.

## 2. Weaknesses

### 2.1 The draft may not satisfy the core "community property" requirement

Claude's central decision is: "The existing single-owner edit-control model is
unchanged." That is the opposite side of the key fork from my draft, which
changes public-row rename and boundary set/clear to signed-in community edits
while keeping destructive actions guarded.

This is not a small implementation detail. Under Claude's plan:

- a public row still has one pilot who controls ordinary edits;
- other pilots can endorse and inspect history, but cannot fix a typo or bad
  boundary unless they are already the owner, the parent-site owner for a zone,
  or an operator;
- `ownerId` remains the actual authority, not just creator/provenance;
- endorsements do not even block a creator from deleting an otherwise
  unreferenced public row.

That can be a sensible incremental sprint, but it is closer to "public rows
with accountability badges" than "community-owned public rows." The intent's
first success criterion requires an explicit decision on what community owned
changes about edit-control. Claude makes that decision, but the risk section
mostly frames the alternative as scope creep instead of a possible requirement.

The final sprint should not merge this without an interview answer:

- **Signals-only v1:** accept Claude's approach, but rename the scope honestly
  and explicitly defer community edit-control as SPRINT-008.
- **Community-edit v1:** adopt the Codex-draft direction: public rename and
  boundary edits become community-editable, destructive demote/delete remains
  guarded/operator-only once a row has community footprint.

### 2.2 The proposed UI surface is not reachable by non-owners today

Claude puts contributors, endorsements, and history in
`components/flight/name-site-dialog.tsx`. The current component is owner-only:
`SiteNameControl` returns plain text when `isOwner` is false. That means the
main use cases "another pilot opens the site name and sees provenance" and
"anonymous/public viewers see counts and rosters" have no reachable UI unless
this sprint also changes the control into a read-only public location dialog
for non-owners.

This is a product-surface blocker, not polish. If the community information is
only visible to the flight owner, it fails the accountability goal.

The final sprint needs to specify:

- non-owner public viewers can open a read-only community dialog from public
  site/zone labels;
- edit actions stay hidden or disabled unless the chosen edit-control policy
  allows them;
- private names keep the current inert text behavior for unauthorized viewers.

### 2.3 Zone endorsement gating ignores effective visibility

Claude says endorsement toggles check a row's own `visibility`, and acknowledges
that "a public zone under a private site is technically endorsable" but
"unreachable in practice." That is too weak for this codebase. SPRINT-005 made
zone visibility an effective conjunction: a zone is public only when the zone
and parent site are both public. The server action must enforce that same rule,
not rely on the UI to avoid calling it.

If a public-zone/private-site id leaks through an owner view, logs, tests, or an
old cache, a stranger should not be able to mutate its endorsement state. Hidden
and nonexistent targets should be indistinguishable.

### 2.4 Audit history can become a privacy leak across publication transitions

The draft logs create, rename, visibility change, and boundary actions for
"every consequential mutation," including private rows if read literally. It
also says private audit is visible only to the owner, but public rows show
history to everyone. The missing case is a private row that is renamed several
times and later published.

If pre-public audit entries become visible after publication, private names and
private editing history leak. If they remain owner-only forever, public history
has to filter by event visibility state or by "created after publication." If
publication is logged, the summary must not include private old names.

Claude's security section asserts the invariant but does not define the data
rule. The final sprint needs a clear event visibility policy and tests for
private -> public -> private -> public transitions.

### 2.5 Existing `boundaryUpdatedById` history is not backfilled into contributors

Claude backfills only one `create` audit entry per existing public row with
`ownerId`. But SPRINT-006 already records a real non-owner contributor via
`boundaryUpdatedById`, especially for zones where the parent-site owner may set
or clear a boundary. My draft seeds `boundaryUpdatedById` as a contributor and
adds a backfill boundary audit note.

Without that, a pilot who actually shaped an existing public boundary before
SPRINT-007 disappears from the contributor roster. The draft keeps
`boundaryUpdatedById` for future fast lookup but fails to use it for migration
truth where it is the only available attribution.

### 2.6 Audit cascade on delete is too dismissive

Claude uses `onDelete: Cascade` for audit entries and argues that deletion is
only possible when there is no third-party accountability to preserve. That is
not fully true:

- an endorsed public site can be deleted by its owner if no other pilot's
  flight or zone depends on it, because endorsements explicitly do not affect
  the guard;
- a site owner can make zone edits under SPRINT-005 decision 4, so third-party
  zone accountability can exist even when a zone is later removable;
- operator merge/delete paths may remove rows after moving references, exactly
  when preserving or carrying audit is most valuable.

If audit is an accountability mechanism, deletion and merge semantics need more
than "the rows cascade." The final sprint should either preserve audit across
merge/delete with target snapshots, or explicitly state that pilot-visible audit
is not durable accountability and operator tooling is the durable record.

### 2.7 Operator merge/drop behavior is under-scoped

Claude adds `admin-sites.ts audit` commands but does not require merge,
force-private, boundary-clear, or zone-merge to write audit or preserve/carry
community state. Existing operator merge directly deletes source sites/zones
after reassigning references. With Claude's FK design, source audit and
endorsements disappear unless the sprint explicitly moves or summarizes them.

My draft includes operator merge behavior that carries contributors/votes/audit
forward or records what was dropped. That is more work, but it matches the
reason this feature exists: accountability around repairs to shared public data.

### 2.8 "Identical to Kudo" overstates the precedent

The endorsement storage and toggle shape can mirror Kudo, but the product rule
does not. Current `toggleKudo` rejects self-kudos. Claude explicitly allows
contributors to endorse their own site/zone. That might be right if endorsement
means "I stand behind this location," but it should not be described as
identical to Kudo except at the join-table/toggle/count level.

The choice also affects signal quality. My draft excludes contributors from
votes so the count means outside legitimacy. Claude allows self-endorsement so
the count means total supporters, including editors. Either can work, but the
final sprint should name the semantic difference in the UI and tests.

## 3. Gaps in Risk Analysis

1. **Product acceptance risk is understated.** The highest risk is not merely
   scope creep; it is shipping a signals-only feature when the requested
   product may require public-row edit-control changes.

2. **Read-surface reachability is missing.** Current non-owner flight labels are
   not interactive, so the draft's public provenance and endorsement use cases
   are unreachable without a deliberate UI behavior change.

3. **Effective-private zone mutation is missing.** The draft treats own
   `visibility = public` as enough for zone endorsement, violating the
   parent-site conjunction used everywhere else.

4. **Private-history disclosure is missing.** Audit rows recorded before
   publication could expose private names or edit history after the row becomes
   public.

5. **Operator data loss is missing.** Merge/delete/force-private can drop or
   obscure the exact community facts the sprint introduces unless they are
   carried, summarized, or intentionally discarded with audit evidence.

6. **Endorsements as community footprint are not analyzed.** Claude says 100
   endorsements do not block owner deletion if no flight/zone references exist.
   That may surprise users who interpret endorsements as community legitimacy.

7. **Append-only is not enforced.** The draft calls the audit log append-only,
   but does not say whether this is an app convention, an allowlist test, a DB
   permission/trigger, or merely a code review norm.

8. **Community info query performance is underspecified.** The draft adds
   endorsement badges to flight headers and suggestions, and rosters/history to
   dialogs. It should explicitly prevent N+1 queries on any repeated surface
   and define batch helpers for every compact-count usage.

9. **Profile deletion effects are underplayed.** `actorId: SetNull` preserves
   events but a derived roster grouped by non-null actors will drop deleted
   contributors. That may be acceptable, but the UI behavior should be named.

## 4. Missing Edge Cases

1. **Private row renamed, published, then viewed by a stranger.** Public history
   must not reveal the private old name or pre-public edit trail.

2. **Public zone under a private site.** Summary reads and endorsement toggles
   should fail closed even when `zone.visibility = public`.

3. **Non-owner public viewer opens community info.** The current owner-only
   `SiteNameControl` path must become a read-only public affordance without
   exposing edit actions.

4. **Existing public boundary updated by a non-owner before migration.**
   Backfill should include `boundaryUpdatedById` as a contributor or explicitly
   explain why existing boundary attribution is discarded from the roster.

5. **Endorsed but unreferenced site deletion.** Decide whether endorsements are
   community footprint that block ordinary delete/demote, or whether they are
   disposable display state.

6. **Contributor self-endorsement.** If allowed, test creator endorsement,
   later contributor endorsement, and count semantics. If disallowed, remove
   prior votes when a voter later contributes.

7. **No-op edits.** Renaming to the same normalized name or clearing an already
   empty boundary should not create noisy audit/contributor events unless the
   sprint deliberately treats attempted actions as history.

8. **Failed writes.** Validation/auth failures must create no audit entry,
   contributor row, or endorsement side effect.

9. **Concurrent toggles.** Endorsement race handling should match the shipped
   `toggleKudo` behavior under double-clicks and parallel requests.

10. **Deleted profile in history and roster.** Recent audit should render a
    deleted actor as "deleted pilot"; contributor rosters should specify
    whether deleted contributors are omitted or shown as tombstones.

11. **Operator merge with source votes/audit.** When `fromSiteId` merges into
    `intoSiteId`, define whether source endorsements are transferred, dropped,
    deduplicated, or summarized.

12. **Audit detail size and sanitization.** Boundary events should store compact
    facts only; names should be bounded and server-generated; arbitrary client
    JSON should never enter `detail`.

## 5. Definition of Done Completeness

Claude's DoD is strong for the signals-only interpretation, but it is not yet
complete enough to merge. Add or revise these items:

1. Add a decision gate for public-row edit-control: signals-only accepted by the
   human, or public rename/boundary edit becomes community-editable in v1.

2. Add a DoD item that public community info is reachable by non-owner viewers
   from public flight/location labels, with edit controls gated separately.

3. Change endorsement authorization for zones to use effective visibility
   (`canSeeZone` / parent-site conjunction), not row visibility alone.

4. Add tests for private -> public publication history so private old names,
   private boundary facts, and pre-public audit events do not leak.

5. Backfill existing `boundaryUpdatedById` as a contributor/audit note for
   public rows, or explicitly document that only owners are seeded.

6. Decide whether endorsements count as community footprint for delete/demote
   guards, and test the chosen behavior.

7. Add operator merge/force-private/boundary-clear requirements: preserve,
   transfer, summarize, or explicitly drop contributors, endorsements, and
   audit with tests.

8. Add "append-only audit" enforcement to the write-audit allowlist or another
   concrete guard, not just a convention.

9. Add failed-validation/failed-authorization tests proving no audit or
   contributor side effects are written.

10. Add no-op mutation tests to prevent noisy audit rows for unchanged names,
    unchanged visibility, and clearing absent boundaries.

11. Add N+1 protections for every count badge surface: flight header,
    suggestions, and any list/logbook surface that later opts in.

12. Clarify contributor self-endorsement semantics in the DoD and UI language;
    do not describe it as fully identical to Kudo if self-voting remains
    allowed.

With those changes, Claude's draft is a good base for a conservative
accountability sprint. The unresolved question is whether that conservative
scope is the sprint the user actually asked for.
