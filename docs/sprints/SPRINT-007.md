# SPRINT-007 — Community-owned public sites and zones

## Overview

SPRINT-004 made site locations user-generated. SPRINT-005 split them into a
two-level `Site` → `Zone` hierarchy. SPRINT-006 let owners draw the actual
shape that drives matching. All three shipped with the same load-bearing
simplification: every `Site`/`Zone` row has exactly one `ownerId`, and every
consequential write — rename, unpublish, delete, draw a boundary — is gated
through that one pilot. SPRINT-005 stretched this once, letting a site's
owner also rename/delete zones other pilots contributed under their site,
but the model has never let a stranger fix so much as a typo on a public
site.

That's too small for a public flying-site gazetteer. "Mission Ridge" isn't
one pilot's private note that happens to be visible — it's a shared fact the
local flying community converges on. This sprint makes that real: a public
`Site` or `Zone` becomes a community-editable record. Any signed-in,
onboarded pilot can fix its name or redraw its boundary. Every consequential
change is attributed in an append-only audit log. A contributor roster shows
who has actually shaped the place. Other pilots can endorse a site with a
one-tap, one-per-pilot upvote. Destructive actions — deleting or demoting a
public row back to private — stay creator-gated and lock once the row has
real community investment behind it, so opening up editing doesn't also open
up a way to quietly delete something other pilots depend on.

`ownerId` doesn't go away. It stays as the row's creator/provenance, keeps
driving publish/unpublish authority, keeps anchoring the delete guard, and
keeps SPRINT-005 decision 4's site-owner-over-child-zones power. What
changes is that it stops being the *only* accountable identity on a public
row — the audit log and contributor roster are now equally load-bearing, and
the audit log is what makes opening up editing safe rather than reckless.

This sprint was planned via the multi-agent `sprint-plan` workflow (Claude
opus + Codex gpt-5.5 — Gemini's CLI still can't authenticate on the free
tier, same gap as SPRINT-005/006). The two independent drafts agreed on
almost everything except the single question that mattered most — whether
"community owned" changes *who can edit*, or only adds *visibility* on top
of the existing model — and both cross-critiques independently flagged that
exact question as the one thing that couldn't be decided without asking.
Full reasoning trail: [`drafts/SPRINT-007-INTENT.md`](./drafts/SPRINT-007-INTENT.md),
[`drafts/SPRINT-007-CLAUDE-DRAFT.md`](./drafts/SPRINT-007-CLAUDE-DRAFT.md),
[`drafts/SPRINT-007-CODEX-DRAFT.md`](./drafts/SPRINT-007-CODEX-DRAFT.md),
[`drafts/SPRINT-007-CLAUDE-CRITIQUE.md`](./drafts/SPRINT-007-CLAUDE-CRITIQUE.md),
[`drafts/SPRINT-007-CODEX-CRITIQUE.md`](./drafts/SPRINT-007-CODEX-CRITIQUE.md),
[`drafts/SPRINT-007-MERGE-NOTES.md`](./drafts/SPRINT-007-MERGE-NOTES.md).

### Anchoring decisions (from the stakeholder interview)

1. **Community-edit v1, not signals-only.** Any signed-in, onboarded pilot
   can rename or redraw the boundary of a *public* `Site`/`Zone`. Private
   rows are completely unaffected — still owner-only, exactly as today.
   Destructive actions (delete, demote to private) stay creator-gated and
   gain a new `hasCommunityFootprint` guard that blocks them once another
   pilot has made a real edit (not merely endorsed — see decision 3).
2. **Self-endorsement is allowed, capped at one vote per pilot per row.** A
   pilot who created or edited a site can also endorse it. The composite
   primary key on the endorsement table is what actually prevents
   double-voting — there's no separate "you can't endorse your own thing"
   rule, and no vote-removal side effect when a pilot who already endorsed
   later makes an edit.
3. **Endorsements never block deletion.** The existing delete/demote guard
   (blocks only when another pilot's flight or zone actually depends on the
   row) is extended to *also* block once another pilot has made a real
   community edit — but a bare endorsement, with no edit behind it, never
   locks a creator out of undoing their own mistake.
4. **Edit eligibility is "signed in and onboarded," full stop.** No
   minimum-flight-count gate. The backstop against abuse is the audit trail,
   a daily edit-rate cap, and operator remedy — not a bar at the door.
5. **Contributors are derived from the audit log, not a separate table.**
   `SELECT DISTINCT actorId` against `LocationAuditEntry` for a row. No dual
   write, no drift risk — the roster is consistent with the log by
   construction, and at this scale (single-digit to low-hundred edits per
   row) the query is trivial.
6. **The audit log uses a nullable-FK + CHECK design**
   (`siteId?`/`zoneId?`, `num_nonnulls = 1`), not a polymorphic
   `(targetType, targetId)` table with no FK. Real Prisma relations, real
   referential integrity, real indexed lookups. Operator merges are required
   to re-point surviving audit rows to the merge target *before* deleting
   the source — the FK design gets the same merge-survivability a no-FK
   design would, without giving up integrity.
7. **Audit entries are written only while the row is public at the time of
   the mutation.** A private row's create/rename/visibility history produces
   *zero* audit rows — there's nothing to leak later, because nothing was
   recorded. Publishing a private row writes a `published` entry with no
   reference to the prior private name. This is the one clean rule that
   closes the private→public disclosure gap both drafts' critiques caught
   from opposite directions.
8. **`SiteNameControl` gets a second, non-owner-reachable mode.** Today it's
   plain, inert text for anyone but the flight's own owner. That's
   incompatible with "any pilot can edit a public site" — there'd be no way
   to reach the edit action. A public site/zone's label is now clickable for
   *any* viewer (including on someone else's flight), opening a
   community-focused dialog: info always, edit actions and the endorsement
   toggle for signed-in pilots. Binding a *different* site to one's own
   flight (the existing SiteStep/ZoneStep flow) stays flight-owner-only —
   editing a site's own name/boundary and choosing which site a flight
   points to are two different actions now, not one.

### Explicitly out of scope (with reasons)

- **Approval queues, edit proposals, moderation voting, rollback-to-a-prior-
  version.** This sprint ships accountable *direct* edits (audit trail +
  operator remedy as the backstop), not a governance system. A future sprint
  can build proposals/review on top of the audit log this one establishes.
- **Comments, reports, reputation scores, trust levels, badges,
  notifications, user blocking.** Moderation/social products, not
  prerequisites for community ownership. None of the interview's anchoring
  decisions depend on any of them existing.
- **Endorsement-weighted matching or ranking.** Endorsements are a display
  legitimacy signal only. Coupling them to `findLocation`'s ranking is a
  correctness-critical change that deserves real usage data first, per both
  drafts' agreement.
- **New metadata fields** (wind direction, hazards, parking, local rules,
  site descriptions). Explicitly deferred by the user's own seed ("later on
  we can add additional metadata"). The schema doesn't paint itself into a
  corner — `LocationAuditEntry.detail` and a future `Site`/`Zone` metadata
  column are both additive — but nothing here designs that column now.
- **Dedicated `/sites/<id>` or `/zones/<id>` pages, a browsable site
  directory.** The standing no-site-URL policy stays closed. Reachability
  for the new community dialog comes from any flight that already shows the
  site/zone's name (see decision 8), not from a new browse surface.
- **Rename/edit-conflict resolution (locking, merge UI, "someone else is
  editing" warnings).** Concurrent community edits land as ordinary
  Postgres last-write-wins, exactly like every other multi-writer field in
  the app today — both the old and new state are recorded in the audit log,
  so nothing is silently lost, just possibly overwritten by a later edit.
  Real locking/conflict UI is a follow-up if usage shows it's actually
  needed, not a v1 requirement.
- **Vote-removal-on-later-contribution.** Considered in Codex's draft,
  dropped per the interview: self-endorsement is simply allowed, so there's
  no vote to remove when a pilot who already endorsed later edits.
- **A minimum-flight-count gate on edit eligibility.** Considered, rejected
  per the interview (decision 4).
- **Operator-action audit logging beyond merge re-pointing.** Operators
  already have structured console output (`scripts/admin-sites.ts`); folding
  every operator action into the pilot-facing audit log is a separable
  cleanup, not required for this sprint's accountability goal. Operator
  *merge* specifically must re-point audit ownership (decision 6) because
  without that, community history for merged rows is silently destroyed —
  that's the one operator-side requirement this sprint does need.

## Use Cases

1. **Fix a typo on a shared public site.** A pilot notices "Mission Rdigde"
   on a flight that isn't theirs, opens the now-clickable label, and renames
   it to "Mission Ridge." The flight's own cached display columns
   recompute exactly as today (SPRINT-004/005's `locationCachePatch`), the
   pilot is added to the contributor roster, and an audit entry records the
   old and new name.
2. **Correct a public boundary someone else drew.** A pilot redraws a public
   zone's boundary they didn't create. SPRINT-006's geometry validation and
   the (now-generalized) daily community-edit cap still apply. The edit is
   attributed in `boundaryUpdatedById` (fast last-writer lookup, unchanged)
   and in the audit log (full history).
3. **See who shaped a place.** A pilot opens a public site's info and sees
   its contributor roster (creator first, then everyone else who's made a
   deliberate edit, most recent contribution shown per pilot), a compact
   "History" of recent renames/boundary changes/visibility changes, and an
   endorsement count.
4. **Endorse a site you trust.** Any signed-in pilot taps "Endorse" on a
   public site or zone. The count increments, `hasEndorsed` flips true for
   them, tapping again removes it. Works the same whether or not they've
   ever edited that row.
5. **Private stays completely private.** A stranger cannot rename,
   boundary-edit, endorse, or view the contributor roster/history for
   another pilot's private site or zone. The label stays plain, inert text
   for anyone but the owner — byte-for-byte the same behavior as today.
6. **A creator can still undo their own honest mistake.** A pilot creates
   "Eagle Peak" by accident, decides to remove it minutes later — no other
   pilot has edited or flown there yet — and deletes it normally, exactly as
   today. An endorsement someone drive-by-tapped in the meantime does not
   block this.
7. **A creator can no longer quietly delete a place the community relies
   on.** A pilot who created "Mission Ridge" tries to delete it after
   another pilot has renamed or redrawn its boundary. The action is refused
   with a clear "other pilots have contributed to this" error, pointing at
   operator remedy instead of a silent, community-affecting deletion.
8. **Zone accountability respects the parent.** A public zone under a
   public site has its own contributor roster, audit history, and
   endorsement count, independent of the parent site's. A zone under a
   *private* site is not community-editable and shows no community info to
   anyone but the site's owner — the SPRINT-005 visibility conjunction
   applies exactly the same way it does everywhere else.
9. **Existing production sites transition with real history, not a blank
   slate.** After the migration, every existing public site/zone shows its
   current owner as a contributor (backfilled), and — where
   `boundaryUpdatedById` names a *different* pilot — that pilot too. No
   manual fixup, no data loss for what's actually knowable.
10. **Operator investigates and repairs.** An admin runs
    `scripts/admin-sites.ts audit <siteId>` and sees every actor, action,
    and timestamp for a row. A `merge` correctly carries the losing site's
    audit history, contributors, and endorsements onto the survivor instead
    of silently dropping them.
11. **Anonymous (logged-out) viewers see the signals, not the actions.** A
    logged-out visitor viewing a public shared flight sees the site's
    contributor roster, history, and endorsement count. They see no
    "Endorse" button and no edit affordance — those require sign-in.

## Architecture

### Data model

```prisma
model LocationAuditEntry {
  id        String   @id @default(cuid())
  siteId    String?
  site      Site?    @relation("SiteAuditEntries", fields: [siteId], references: [id], onDelete: Cascade)
  zoneId    String?
  zone      Zone?    @relation("ZoneAuditEntries", fields: [zoneId], references: [id], onDelete: Cascade)
  actorId   String?
  actor     Profile? @relation("LocationAuditEntries", fields: [actorId], references: [id], onDelete: SetNull)
  action    String   // create | published | renamed | boundary_set | boundary_cleared | merge
  detail    Json?    // action-specific display context — never raw geometry, never a private name
  createdAt DateTime @default(now())

  @@index([siteId, createdAt])
  @@index([zoneId, createdAt])
  @@index([actorId])
}

model SiteEndorsement {
  siteId    String
  site      Site     @relation("SiteEndorsements", fields: [siteId], references: [id], onDelete: Cascade)
  profileId String
  profile   Profile  @relation("SiteEndorsements", fields: [profileId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([siteId, profileId])
  @@index([siteId, createdAt])
}

model ZoneEndorsement {
  zoneId    String
  zone      Zone     @relation("ZoneEndorsements", fields: [zoneId], references: [id], onDelete: Cascade)
  profileId String
  profile   Profile  @relation("ZoneEndorsements", fields: [profileId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([zoneId, profileId])
  @@index([zoneId, createdAt])
}

model Site {
  // ...unchanged...
  auditEntries LocationAuditEntry[] @relation("SiteAuditEntries")
  endorsements SiteEndorsement[]    @relation("SiteEndorsements")
}

model Zone {
  // ...unchanged...
  auditEntries LocationAuditEntry[] @relation("ZoneAuditEntries")
  endorsements ZoneEndorsement[]    @relation("ZoneEndorsements")
}

model Profile {
  // ...unchanged...
  locationAuditEntries LocationAuditEntry[] @relation("LocationAuditEntries")
  siteEndorsements     SiteEndorsement[]    @relation("SiteEndorsements")
  zoneEndorsements     ZoneEndorsement[]    @relation("ZoneEndorsements")
}
```

**Raw SQL appended to the migration** (Prisma v6 precedent — CHECKs it can't
express declaratively, same pattern SPRINT-006 used for the boundary bbox):

```sql
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "audit_target_check"
  CHECK (num_nonnulls("siteId", "zoneId") = 1);

ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "audit_action_check"
  CHECK ("action" IN ('create','published','renamed','boundary_set','boundary_cleared','merge'));
```

No new column on `Site`/`Zone`. No `SiteContributor`/`ZoneContributor`
table. No denormalized endorsement count. `ownerId` is untouched in shape
and column type — only its *exclusivity* as an editor changes, and only for
rename/boundary on public rows.

**Why `onDelete: Cascade` on the audit FKs, and why that's now safer than it
sounds.** A site can only be deleted when `hasCommunityFootprint` is false
— meaning no other pilot has a dependent flight/zone *and* no other pilot
has made a real edit. At that point the audit log for the row contains only
the creator's own actions, so cascading it away loses nothing a third party
would care about. The one case where a heavily-audited row gets deleted is
an **operator** merge/force-action, and that path is required (decision 6)
to re-point surviving audit rows to the merge target first — so the cascade
never actually fires on a row with real community history unless an
operator has explicitly decided the row itself is going away for good.

**Why `onDelete: SetNull` on `actorId`.** A deleted profile shouldn't erase
the audit trail; the entry survives with `actorId = null`, rendered as "a
deleted pilot." The derived contributor roster (`DISTINCT actorId`) then
naturally drops that pilot from the roster while the history entry itself
remains — an accepted, documented asymmetry, not an oversight.

### The audit writer (`lib/sites/audit.ts`)

```ts
export type AuditAction =
  | "create" | "published" | "renamed"
  | "boundary_set" | "boundary_cleared" | "merge";

export interface AuditTarget {
  siteId?: string;
  zoneId?: string;
}

/**
 * Writes an entry INSIDE the caller's own transaction. A no-op (does not
 * write) when `visibility` is "private" — see decision 7. Every mutation
 * site passes its own post-mutation visibility, not a cached value, so a
 * simultaneous visibility change and rename in one transaction is recorded
 * correctly.
 */
export async function writeAuditEntry(
  tx: AuditWriteDb,
  target: AuditTarget,
  actorId: string,
  action: AuditAction,
  visibility: "public" | "private",
  detail?: Record<string, unknown>,
): Promise<void>;
```

| action | detail | written when |
|---|---|---|
| `create` | `{ name }` | a new PUBLIC site/zone is created |
| `published` | `{}` | visibility flips private → public |
| `renamed` | `{ from, to }` | name changes on a public row |
| `boundary_set` | `{ vertexCount, areaM2 }` (never raw geometry) | boundary set/replaced on a public row |
| `boundary_cleared` | `{}` | boundary removed on a public row |
| `merge` | `{ fromId, intoId }` | operator merge, written on the survivor |

A row created or edited while **private** writes nothing (decision 7) — the
`published` entry is the first thing a row's history ever shows if it
started private. A row created directly as public writes a `create` entry
immediately.

### Community edit-control (`lib/sites/associate.ts`)

Two new predicates, sitting alongside the existing `findZoneEditableBy`:

```ts
/** True once the row is either owned by the caller, or public (any signed-in,
 *  onboarded caller may edit rename/boundary on a public row). Requires a
 *  non-null, authenticated callerId for the public branch — an anonymous
 *  caller never satisfies this even for a public row. */
function canCommunityEditSite(site: { visibility: Visibility; ownerId: string | null }, callerId: string): boolean;

/** Same shape, but for a zone: requires EFFECTIVE public (zone AND parent
 *  site both public — the exact SPRINT-005 conjunction `canSeeZone` already
 *  uses elsewhere), or ownership (zone owner or parent site owner, the
 *  existing findZoneEditableBy set). */
function canCommunityEditZone(zone: {...}, site: {...}, callerId: string): boolean;
```

**What changes and what doesn't:**

- `renameSite` / `renameZone` — gate changes from "caller owns this row" to
  `canCommunityEditSite`/`canCommunityEditZone`. Everything downstream
  (name validation, `locationCachePatch`, cache recompute) is unchanged.
- `setSiteBoundary` / `clearSiteBoundary` / `setZoneBoundary` /
  `clearZoneBoundary` — same gate change. SPRINT-006's geometry validation,
  `boundaryUpdatedById` attribution, and the daily edit cap are unchanged in
  *shape*; the cap is generalized (see below) to count rename actions too.
- `setSiteVisibility` / `unpublishOwnSite` / `setZoneVisibility` /
  `unpublishOwnZone` — **unchanged, owner-only.** Publishing or
  unpublishing a row is still the owner's own privacy decision, exactly as
  today. This is the one mutation family community-edit v1 deliberately
  does not touch.
- `deleteSite` / `deleteZone` — gains the `hasCommunityFootprint` check
  (below) alongside the existing `referencedByOthers` /
  `siteHasOtherOwnedZone` guards. Still owner-only to *attempt*; now also
  blocked once the row has real community investment.

```ts
/** True if ordinary creator delete/demote must be refused: another pilot's
 *  flight or zone still depends on this row (existing guard, unchanged), OR
 *  another pilot has made a real community edit (a LocationAuditEntry for
 *  this row with actorId != ownerId). Endorsements do NOT count — decision
 *  3. */
async function hasCommunityFootprint(tx, level: "site" | "zone", id: string, ownerId: string): Promise<boolean>;
```

**The daily community-edit cap.** SPRINT-006's `DAILY_BOUNDARY_EDIT_CAP`
(20/caller/day) is generalized to `DAILY_COMMUNITY_EDIT_CAP`, now covering
`renamed` + `boundary_set` + `boundary_cleared` together — a vandal
alternating rename and boundary spam to dodge a per-action-type cap doesn't
get 40 edits by splitting across two counters. The count is now derived
directly from `LocationAuditEntry` (today's entries for that `actorId`
across those three actions) rather than SPRINT-006's own counting query —
one less mechanism, since the audit log this sprint adds is a strictly
better source of truth for "how many edits has this caller made today."

### Endorsements (`lib/sites/endorsements.ts`)

Unchanged from the Claude draft's design — mirrors `lib/social/kudos.ts`
exactly:

```ts
export interface EndorsementSummary {
  count: number;
  hasEndorsed: boolean;
}

export async function toggleSiteEndorsement(siteId: string, viewerId: string): Promise<{ endorsed: boolean }>;
export async function toggleZoneEndorsement(zoneId: string, viewerId: string): Promise<{ endorsed: boolean }>;
export async function siteEndorsementSummary(siteId: string, viewerId: string | null): Promise<EndorsementSummary>;
export async function zoneEndorsementSummary(zoneId: string, viewerId: string | null): Promise<EndorsementSummary>;
export async function siteEndorsementCounts(siteIds: string[]): Promise<Map<string, number>>;
export async function zoneEndorsementCounts(zoneIds: string[]): Promise<Map<string, number>>;
```

- **Toggle mechanic**: identical to `toggleKudo` — delete-if-exists, else
  create, converging on P2002 race. Signed-in pilots only.
- **No self-endorsement restriction** (decision 2). The composite PK is the
  only thing preventing double-voting.
- **Public/effective-public rows only.** `toggleZoneEndorsement` checks the
  SPRINT-005 conjunction (zone AND parent site public) via the same helper
  `canSeeZone` uses — not the zone's own `visibility` field in isolation.
  This closes a real gap Claude's original draft sketch had (checking only
  the row's own field, not the conjunction).
- **Batch counts** follow `kudoCountsFor`'s `groupBy` pattern exactly.

### Contributor roster (`lib/sites/contributors.ts`)

```ts
export interface Contributor {
  profileId: string;
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | null;
  firstContributedAt: Date;
  lastContributedAt: Date;
  actionCount: number;
}

export async function contributorsForSite(siteId: string): Promise<Contributor[]>;
export async function contributorsForZone(zoneId: string): Promise<Contributor[]>;
```

`GROUP BY actorId` over `LocationAuditEntry` (non-null actors only), joined
to `Profile` for display fields, ordered by `firstContributedAt` (creator —
or first publisher, for a row that started private — is always first).
Nothing materialized, nothing to drift.

### Read APIs (`lib/sites/community.ts`)

```ts
export interface LocationCommunityInfo {
  contributors: Contributor[];
  recentAudit: AuditEntryView[]; // capped at 20, most recent first
  endorsement: EndorsementSummary;
}

export async function siteCommunityInfo(siteId: string, viewerId: string | null): Promise<LocationCommunityInfo | null>;
export async function zoneCommunityInfo(zoneId: string, viewerId: string | null): Promise<LocationCommunityInfo | null>;
```

Returns `null` for a private row viewed by anyone but its owner (matching
today's inert-text behavior exactly), or for a zone whose effective
visibility fails the conjunction. Every field is derived fresh from the
three query modules above — no new cache, no new denormalized column, no
new `Flight`-adjacent state.

### UI: `SiteNameControl` gets a public mode

`components/flight/name-site-dialog.tsx`'s `SiteNameControl` currently
returns inert text for anyone who isn't the *flight's* owner. That's the
UI-reachability gap both cross-critiques caught (see merge notes) — with
community-edit v1, editing a site's name/boundary is no longer tied to
flight ownership at all, so the control needs a path that doesn't run
through "is this my flight."

- **The label becomes clickable for any viewer whenever the underlying
  site/zone is public** — including on someone else's flight, including
  when logged out (read-only in that case). Private rows keep exactly
  today's behavior: inert text for anyone but the flight's owner.
- **Two distinct dialogs, not one bigger one:**
  - The **existing** `NameSiteDialog` (bind/rename/boundary-picker,
    reusing/creating a site for *this flight*) stays reachable only to the
    flight's own owner, exactly as today — this is about which site a
    flight points to, unrelated to who may edit that site's own record.
  - A **new**, lighter `LocationCommunityDialog` opens for any viewer
    (including non-owners) on a public site/zone's label: contributors,
    recent history, endorsement count/toggle (signed-in only), and — for a
    signed-in, onboarded pilot — rename and redraw-boundary actions gated
    by `canCommunityEditSite`/`canCommunityEditZone`. The flight's own
    owner, opening their own flight, sees BOTH entry points (bind-a-
    different-site via the existing flow, and edit-this-site via the new
    one) since nothing about being the flight owner disqualifies them from
    also being a community editor.
- **List/logbook/feed views stay unchanged** — no endorsement badges, no
  community affordance there. The label click only exists in the flight
  header and inside the existing naming-dialog surfaces, matching the "no
  new list-query cost" constraint both drafts agreed on.

## Implementation

Five ordered PRs (one more than SPRINT-006's four — community-edit v1 has
materially more surface than a signals-only sprint would have). Each PR
passes all five gates independently.

### PR1 — Schema, audit writer, contributors, endorsements (no user-visible change)

- Migration `20260824xxxxxx_location_community`: `LocationAuditEntry`,
  `SiteEndorsement`, `ZoneEndorsement` tables, indexes, the two raw-SQL
  CHECKs (target discriminator, action enum). Purely additive.
- Backfill (in the same migration or a follow-up script, matching
  SPRINT-006's precedent): for every public `Site`/`Zone`, insert a
  `create` `LocationAuditEntry` for `ownerId` dated at the row's
  `createdAt`; where `boundaryUpdatedById` is set and differs from
  `ownerId`, additionally insert a `boundary_set` entry for that pilot
  (adopting Codex's draft's backfill improvement). Idempotent
  (`ON CONFLICT DO NOTHING` semantics or an existence check) so it's safe
  to re-run.
- `lib/sites/audit.ts`: `writeAuditEntry`, `AuditAction`, `AuditTarget` —
  a no-op on a private target (decision 7).
- `lib/sites/contributors.ts`: `contributorsForSite`, `contributorsForZone`.
- `lib/sites/endorsements.ts`: full toggle/summary/batch-count API,
  effective-visibility-checked for zones.
- Unit + integration tests: audit CHECK constraints (mixed/both-null target
  refused, bad action refused); a private-row mutation writes zero audit
  rows; a public-row mutation writes exactly one; the backfill seeds both
  `ownerId` and a differing `boundaryUpdatedById`; endorsement toggle/count/
  race behavior; endorsement refused on a private or effective-private
  (public zone, private parent) target.
- **Depends on:** nothing.

### PR2 — Community edit-control wired into mutations

- `lib/sites/associate.ts`: `canCommunityEditSite`, `canCommunityEditZone`,
  `hasCommunityFootprint`, `DAILY_COMMUNITY_EDIT_CAP` (generalizing
  SPRINT-006's boundary-only cap to also count renames, sourced from the
  audit log).
- `renameSite` / `renameZone` / `setSiteBoundary` / `clearSiteBoundary` /
  `setZoneBoundary` / `clearZoneBoundary`: gate changed from strict
  ownership to the new community-edit predicates; each now calls
  `writeAuditEntry` inside its existing transaction.
- `deleteSite` / `deleteZone`: gain the `hasCommunityFootprint` check
  alongside the existing guards, with a distinct, clear refusal reason.
- `createOrAttachSiteFromFlight` (`lib/sites/repo.ts`): writes a `create`
  audit entry when it creates a new public site/zone (no entry for a
  private one, per decision 7).
- `setSiteVisibility` / `unpublishOwnSite` / `setZoneVisibility` /
  `unpublishOwnZone`: unchanged authorization; publishing now additionally
  writes a `published` audit entry.
- Integration tests: a non-owner CAN rename/boundary-edit a public
  site/zone; a non-owner CANNOT do either on a private one; a stranger
  CANNOT edit a public zone under a private site (conjunction holds); the
  daily cap blocks a 21st community edit regardless of rename/boundary mix;
  a creator CAN still delete/demote a public row no one else has touched;
  a creator CANNOT delete/demote one another pilot has edited; an
  endorsement alone does NOT block deletion (decision 3, explicit
  regression test); a site owner renaming a zone under their site
  (SPRINT-005 decision 4) still works and is attributed to them in the
  audit log; publishing a private row writes exactly one `published` entry
  referencing no prior name.
- **Depends on:** PR1.

### PR3 — UI: public community dialog + edit reachability

- `components/flight/name-site-dialog.tsx`: `SiteNameControl` gains the
  public-clickable mode (decision 8); a new `LocationCommunityDialog`
  component (contributors, history, endorsement toggle, rename/boundary
  edit actions gated client-side by the same predicates the server
  enforces — client gating is UX only, the server call is the real gate).
  The existing `NameSiteDialog` (bind-to-this-flight) is untouched in
  behavior, just no longer the only reachable dialog.
- `app/flights/[id]/community-action.ts` (new server actions):
  `renamePublicRow`, `toggleEndorsement`, `getCommunityInfoForRow` — each
  re-authorizes server-side regardless of what the client believes. Boundary
  set/clear reuse the existing `saveBoundaryForOwnedRow`/
  `clearBoundaryForOwnedRow` from SPRINT-006 verbatim, since PR2 already
  made those accept any onboarded pilot on a public row — nothing
  boundary-specific was left to re-derive.
- **Implemented smaller than originally sketched here:** no separate
  endorsement-count badge was added to `flight-header.tsx` — the count is
  visible inside the community dialog itself, which satisfies the DoD's
  actual checklist item (reachability + visible count), and keeps the
  header exactly as uncluttered as before this sprint. Revisit only if real
  usage shows the count needs to be visible without opening the dialog.
- E2E: a second pilot opens a flight that ISN'T theirs, renames the public
  site shown on it, and the change is visible on the original flight too;
  a third pilot endorses it and the count updates; the same flow attempted
  on a private site is unreachable (no clickable label, no dialog).
- **Depends on:** PR2.

### PR4 — Operator tooling: merge/audit preservation

- `scripts/admin-sites.ts`: `audit <siteId>` / `zone-audit <zoneId>`
  (print the log, most recent first); `merge` / `zone-merge` updated to
  re-point the losing row's `LocationAuditEntry`, `SiteEndorsement`/
  `ZoneEndorsement` rows onto the survivor (an `UPDATE ... SET siteId =`,
  not a delete-and-lose) *before* the existing delete step runs, then
  writes a `merge` audit entry on the survivor. `boundary-clear` /
  `zone-boundary-clear` gain a `boundary_cleared` audit entry (operator
  actor, distinguishable from a pilot's own clear).
- `scripts/admin-sites.test.ts`: merge preserves audit/endorsement rows
  from the losing side; re-running a merge or audit command is safe;
  operator boundary-clear is attributed and distinguishable from a pilot
  clear.
- **Depends on:** PR1–PR3 (needs the tables and the mutation paths that
  populate them to test against realistically).

### PR5 — Release pass

- `lib/whats-new.ts` entry (newest first): "Sites and zones you make public
  are community property now — any pilot can help keep the name and shape
  accurate, and you can see who's contributed and endorse the ones you
  trust."
- `FEATURES.md`: "Community-Owned Public Sites & Zones" entry updated to
  note what shipped (community edit-control, audit, roster, endorsements)
  vs. what's still deferred (approval queues, metadata fields, notifications).
- `docs/architecture.md`: new subsection alongside the SPRINT-005/006 site+
  zone privacy-seam section, documenting the audit log, the
  community-edit predicates, and the "audit only while public" rule.
- Full manual QA prompt in `docs/qa-prompts/` following the SPRINT-005/006
  precedent.
- **Depends on:** PR1–PR4.

## Files Summary

**New:** `lib/sites/audit.ts` (+`audit.test.ts`), `lib/sites/contributors.ts`
(+`contributors.test.ts`), `lib/sites/endorsements.ts`
(+`endorsements.test.ts`), `lib/sites/community.ts` (+`community.test.ts`),
`app/flights/[id]/community-action.ts`,
`prisma/migrations/20260824xxxxxx_location_community/`,
`test/community.integration.test.ts` (new fixture lat/lon band, disjoint
from every prior integration test file), `test/e2e/community.spec.ts`,
`docs/qa-prompts/QA-PROMPT-<date>-community.md`.

**Modified:** `prisma/schema.prisma` (`LocationAuditEntry`,
`SiteEndorsement`, `ZoneEndorsement` + relation fields on `Site`/`Zone`/
`Profile`), `lib/sites/associate.ts` (community-edit predicates,
`hasCommunityFootprint`, generalized daily cap, audit calls inside every
existing mutation transaction), `lib/sites/repo.ts` (`create` audit entry on
site/zone creation), `components/flight/name-site-dialog.tsx` (public mode
+ new community dialog), `components/flight/flight-header.tsx` (endorsement
badge), `scripts/admin-sites.ts` (audit commands, merge re-pointing),
`scripts/admin-sites.test.ts`, `lib/whats-new.ts`, `FEATURES.md`,
`docs/architecture.md`.

**Unchanged on purpose:** `Flight` model and all eight location cache
columns (no new column, no new cache — endorsements/audit are not privacy
or matching state), `lib/sites/lookup.ts` (matching/ranking unaffected),
`lib/sites/visibility.ts` and `canSeeSite`/`canSeeZone` (no new privacy
dimension — community info visibility is derived from the existing
visibility check, not a parallel one), `lib/sites/boundary.ts` (geometry
validation unchanged), `lib/sites/geo.ts`, `lib/sites/display.ts`,
`lib/ingest/ingest-flight.ts` and the whole ingestion seam,
`app/api/upload/route.ts`, `app/api/ingest/route.ts`,
`lib/sites/write-audit.test.ts` (the pre-existing `Flight`-cache write
audit — no new `Flight` column means nothing new to allowlist there; the
name collision with this sprint's own `LocationAuditEntry` is coincidental
and worth a one-line note in that test file so a future reader doesn't
confuse the two).

## Definition of Done

- [x] `LocationAuditEntry`, `SiteEndorsement`, `ZoneEndorsement` exist per
      the schema above; the target-discriminator and action-enum CHECKs are
      enforced at the DB level, not just in application code.
- [x] Backfill seeds a `create` contributor entry for every existing public
      site/zone's `ownerId`, and an additional `boundary_set` entry for a
      differing `boundaryUpdatedById`; re-running it is a no-op.
- [x] Any signed-in, onboarded pilot can rename or set/clear the boundary of
      a public `Site`/effectively-public `Zone` — verified by a non-owner
      integration test, not just a code-read.
- [x] The exact same actions are refused for a private row, and for a
      public zone under a private site (conjunction holds).
- [x] `setSiteVisibility`/`unpublishOwnSite`/`setZoneVisibility`/
      `unpublishOwnZone` remain owner-only — unchanged.
- [x] A private-row mutation writes **zero** `LocationAuditEntry` rows.
      Publishing writes exactly one `published` entry with no reference to
      the prior private name.
- [x] Every public create/rename/boundary-set/boundary-clear writes exactly
      one audit entry, attributed to the actual caller, inside the same
      transaction as the mutation — verified by a test that a failed
      validation/authorization writes neither the mutation nor the audit
      row.
- [x] The contributor roster (`DISTINCT actorId` over the audit log) lists
      every pilot who has made a deliberate public edit, ordered by first
      contribution; a pilot whose flight was merely auto-matched there does
      NOT appear.
- [x] `DAILY_COMMUNITY_EDIT_CAP` (20/caller/day) blocks a 21st rename-or-
      boundary edit regardless of the mix between the two action types.
- [x] `toggleSiteEndorsement`/`toggleZoneEndorsement` toggle exactly like
      `toggleKudo` (create/delete/P2002-race-converge); one vote per pilot
      per row, enforced by the composite PK; self-endorsement allowed with
      no special-casing.
- [x] Endorsing a private row, or a public zone under a private site, is
      refused (fails closed on the same conjunction `canSeeZone` uses).
- [x] `hasCommunityFootprint` blocks creator delete/demote once another
      pilot has made a real edit; an endorsement with no edit behind it
      does **not** block it (explicit regression test for decision 3).
- [x] A creator can still delete/demote a public row nobody else has
      touched, exactly as today.
- [x] `SiteNameControl`'s label is clickable for any viewer (including
      anonymous, read-only) whenever the row is public; it remains
      byte-for-byte inert text for a non-owner viewing a private row.
- [x] The new community dialog is reachable from a flight that isn't the
      viewer's own, for a public site/zone.
- [x] The existing bind-a-site-to-my-flight dialog is unchanged and still
      flight-owner-only.
- [x] `scripts/admin-sites.ts merge`/`zone-merge` re-point the losing row's
      audit/endorsement rows onto the survivor before deleting the source —
      verified by a test that they're queryable against the survivor's id
      afterward, not silently dropped.
- [x] `scripts/admin-sites.ts audit <id>` / `zone-audit <id>` print a row's
      history, most recent first.
- [x] No list/feed/logbook view gains an N+1 community query; every compact
      count uses the batch helper.
- [x] `Flight` has no new column; `lib/sites/write-audit.test.ts` passes
      unmodified.
- [x] E2E covers: a non-owner renames a public site reached from someone
      else's flight; an endorsement toggle updates the count visible from
      both pilots' views; a creator is blocked from deleting a
      community-edited public site with a clear error.
- [x] All five gates green on every PR; `/whats-new` entry added;
      `FEATURES.md` updated; `docs/architecture.md` documents the new
      model; a QA prompt exists under `docs/qa-prompts/`.
- [x] Deferred items **not** shipped: approval queues/moderation voting,
      comments/reports/trust scores/notifications, endorsement-weighted
      ranking, new metadata fields, `/sites/<id>` pages, edit-conflict
      locking UI, a minimum-flight-count edit gate.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Public community edits degrade shared data (bad renames, ugly boundaries) | Medium | Medium | Scoped edit types (rename + boundary only, never delete), existing SPRINT-006 geometry validation reused as-is, full audit attribution, generalized daily cap, operator remedy as the backstop |
| Vandalism / edit wars on a contested public site | Low (small community today) | Medium | Every edit attributed and rate-capped; `hasCommunityFootprint` blocks the ORIGINAL creator from unilaterally deleting it out from under the community, but any pilot can rename it back; true conflict resolution deliberately deferred (see out-of-scope) as an accepted, documented risk at current scale |
| Private → public audit disclosure leak | Low if decision 7 is implemented as specified | High | Audit writes are a no-op for private-row mutations — there is nothing recorded to leak; explicit tests for private→public and private→public→private→public transitions |
| Operator merge silently drops community history | Medium without PR4 | Medium | PR4 makes re-pointing audit/endorsement rows onto the merge survivor a required, tested step, not an afterthought |
| The generalized daily cap breaks existing SPRINT-006 boundary-cap tests | Low | Low | The cap's *value* and *scope* (per-caller-per-day) are unchanged, only its *source* (audit log instead of a separate count) — existing boundary-cap tests are the regression guard |
| `hasCommunityFootprint` query adds latency to every delete attempt | Low | Low | One indexed `EXISTS` query against `LocationAuditEntry(siteId/zoneId, actorId)`; delete is not a hot path |
| The new `LocationCommunityDialog` duplicates too much of `NameSiteDialog`'s existing UI code | Medium | Low | Explicitly scoped smaller (info + two edit actions + endorsement, no site-creation/zone-picker flow); share the existing boundary editor component from SPRINT-006 rather than rebuilding it |
| Rollback | — | — | PR1 is purely additive. PR2 changes only authorization checks inside existing transactions and adds audit writes — reverting restores exact pre-sprint gating. PR3 adds new UI/actions — reverting removes them, the underlying data model is untouched. PR4 is operator-tooling-only. No revert at any point changes matching, cached display names, or existing privacy behavior |

## Security (privacy / authz)

- **Invariant 1 (unchanged, verified):** every SPRINT-004/005/006 privacy
  invariant — `canSeeSite`, `canSeeZone`, `siteVisibleWhere`,
  `zoneVisibleWhere`, `resolveLocationFields`, `resolveEndpoint`,
  `locationCachePatch`, the eight `Flight` cache columns — is byte-for-byte
  unmodified. All existing privacy-matrix tests pass unmodified.
- **Invariant 2 (new):** community info (contributors, audit, endorsement
  count) is visible only where the underlying row is visible under the
  existing `canSeeSite`/`canSeeZone` rules — the same gate, not a parallel
  one. A private row's community info is visible only to its owner.
- **Invariant 3 (new, the sprint's central authz change):** rename and
  boundary set/clear on a PUBLIC row are now authorized for any signed-in,
  onboarded pilot — not just the owner. This is a deliberate, interviewed
  decision (anchoring decision 1), not an accidental broadening. Private-row
  authorization for the same actions is completely unchanged. Every
  mutation re-reads the target server-side and re-checks the community-edit
  predicate; a client-side "can I edit this" check is UX convenience only.
- **Invariant 4 (new):** audit entries are written only for public-row
  mutations (decision 7) — a private row's edit history never exists to
  leak, at any point in its lifecycle, including after a later publish.
- **Invariant 5 (new):** endorsement toggles require a signed-in,
  onboarded pilot and a currently-visible public (or effectively-public,
  for zones) target; hidden and nonexistent targets are indistinguishable
  in the response.
- **No new `Flight` column, no new cache, no new matching-relevant state.**
  Endorsed/edited ≠ visible, and neither affects `findLocation`'s ranking.
- **Untrusted input:** the audit writer only ever accepts a structured
  `AuditAction` enum value and a server-computed `detail` object — never a
  client-supplied action string or arbitrary JSON blob. Community edit
  actions re-validate name/boundary input through the exact same validators
  the owner-only path used before this sprint (no new validation surface).
- **Abuse surface added by this sprint:** the ability for any pilot to
  mutate a row they don't own is new and is the sprint's core risk.
  Mitigated by: full attribution (nothing anonymous), the generalized daily
  cap, the inability to delete/demote through this path at all (only
  rename/boundary), and operator remedy for anything the automated
  mitigations don't catch.

## Dependencies

- **Internal:** PR2 ⟵ PR1; PR3 ⟵ PR2; PR4 ⟵ PR1–PR3; PR5 ⟵ PR1–PR4. Strictly
  sequential — nothing can display or edit community data before the schema
  and authorization layer exist.
- **External/stack:** none new. Prisma v6 (pinned), NextAuth v5, Next 16,
  Postgres on Railway, existing `components/ui/*`. CI's Postgres service
  already exists.
- **Precedent reused directly:** `lib/social/kudos.ts` (endorsement toggle/
  count shape), SPRINT-005's `findZoneEditableBy` and visibility
  conjunction, SPRINT-006's boundary validation, `boundaryUpdatedById`
  attribution, and daily-edit-cap pattern (generalized, not replaced).
- **Data:** production has a low-double-digit number of public sites/zones,
  all with a single `ownerId` (the curated site seed was already removed —
  `feat(sites): remove the curated site seed` — so there is no null-owner
  case to handle in the backfill). The backfill is purely additive; no
  existing `Site`/`Zone` column changes.
- **Test data:** new integration tests need a lat/lon fixture band disjoint
  from every existing integration test file (the recurring SPRINT-005/006
  lesson — tests run concurrently against one shared local Postgres).

## Open Questions

Answered here as committed decisions from the interview; revisit only if
the product changes.

1. **Does community ownership change edit-control?** — **Yes.** Any
   signed-in, onboarded pilot can rename or redraw the boundary of a public
   site/zone. Destructive actions stay creator-gated, now with the
   `hasCommunityFootprint` guard.
2. **Self-endorsement?** — **Allowed**, with the one-vote-per-pilot-per-row
   cap doing all the work (no special-case restriction, no vote removal on
   later edit).
3. **Do endorsements block deletion?** — **No.** Only real contributions
   (edits) do, alongside the existing flight/zone-dependency guard.
4. **Minimum bar to edit?** — **Signed in and onboarded**, no flight-count
   gate.
5. **Contributor storage — derived or materialized?** — **Derived** from
   the audit log. No separate contributor table.
6. **Audit table — FK or polymorphic?** — **Nullable FK + CHECK.** Operator
   merge is required to re-point rows rather than losing them, which gets
   the no-FK design's merge-survivability without giving up referential
   integrity.
7. **Private-row audit disclosure?** — **Audit is a no-op for private-row
   mutations.** Nothing is recorded until (and unless) a row is public.

**Genuinely still open** (not blocking, deliberately unanswered):

- Should edit-conflict handling (locking, "someone else is editing" UI) get
  built once real usage shows how often it actually happens, or is
  Postgres's ordinary last-write-wins sufficient indefinitely at this
  community's scale?
- Should the audit log eventually cover deletes themselves (not just
  merges)? Would need a non-cascading snapshot strategy, deliberately not
  designed here.
- Should there be notifications ("someone edited your site," "your site got
  endorsed")? Useful follow-up once a notification system exists at all.
- Should a future sprint let endorsement counts influence `findLocation`
  ranking? Needs real endorsement-distribution data first.
- Should the contributor roster eventually include a "pilots who have flown
  here" signal, distinct from "pilots who have edited this"? A richer,
  noisier signal with its own privacy design question (does a private
  flight at a public site make its pilot a "flown here" contributor,
  visible to others?) — not designed here.
- Should operator actions beyond `merge`/`boundary-clear` (e.g. `rename`,
  `force-private`) also write to the pilot-facing audit log, or remain
  console-only? Left as a separable follow-up.
