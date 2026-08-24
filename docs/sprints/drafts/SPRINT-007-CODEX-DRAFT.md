# SPRINT-007 Codex draft — Community-owned public sites and zones

## Overview

SPRINT-004 made locations user-generated. SPRINT-005 split them into `Site` and `Zone`.
SPRINT-006 let owners draw the shape that drives matching. All three shipped with one
load-bearing simplification: every mutable row has one `ownerId`, and nearly every write
is gated through that one pilot.

That is now too small for public locations. A public flying site is a shared fact the
community converges on, not a private note that happens to be visible. This sprint turns
public `Site` and `Zone` rows into accountable community records: a roster of pilots who
have materially contributed, an append-only audit trail for consequential changes, and a
one-vote-per-pilot endorsement signal that gives other pilots a cheap way to say "this
looks right."

Five decisions anchor the sprint:

1. **`ownerId` stays, but stops being the whole authorization model for public rows.**
   The column is retained as creator/provenance and for existing private-row behavior.
   For public rows, non-destructive edits become community-editable by signed-in,
   onboarded pilots, with attribution and rate limits. Private rows are unchanged:
   private sites are still editable only by their owner; private zones by their owner or
   the parent-site owner where SPRINT-005 already allows that.

2. **Community editing is v1-scoped to reversible metadata edits.** Public-row rename and
   boundary set/clear are in scope. Publishing a private row remains owner-only.
   Destructive actions are not community actions: public delete and public-to-private
   demotion stay guarded creator undo while the row has no community footprint, and move
   to operator remedy once another pilot has contributed, endorsed, or depended on it.
   This gives the seed's "not owned by one user" real effect without handing every
   signed-in pilot a delete button.

3. **Contributors are derived from writes, not from proximity.** Creating, publishing,
   renaming, setting/clearing a boundary, or operator-preserved merge attribution counts.
   Merely flying through, matching, viewing, or upvoting a location does not. The roster
   is a materialized summary for display; the audit log is the source of truth.

4. **Votes are endorsements from non-contributors.** A pilot can upvote a visible public
   site or zone once. Contributors cannot upvote their own target, and if a voter later
   contributes to that same target, their vote is removed in the contribution
   transaction. This keeps the count closer to "outside legitimacy" than "editors
   praising their own edits." Counts are computed from the vote tables, matching the
   shipped `Kudo` implementation; no denormalized count column is introduced in v1.

5. **Audit is public-row accountability, not a private-history leak.** Public audit
   entries can store public old/new names, action types, actor, timestamps, and compact
   boundary summaries. They never store private names, private boundary geometry, raw IGC
   facts, or full polygon JSON. Private rows do not gain a public audit surface.

**Committed v1 scope**

1. Add contributor, vote, and audit storage for both `Site` and `Zone`, plus a migration
   backfill for existing public rows.
2. Add a central community write policy in `lib/sites/associate.ts`: public rename and
   boundary edit by any signed-in pilot; private behavior unchanged; destructive public
   undo blocked once a row has a community footprint.
3. Append audit entries and update contributor rosters transactionally from all existing
   consequential site/zone write paths.
4. Add upvote toggles and summaries for visible public sites/zones, with one vote per
   pilot per row and contributor/self-vote exclusion.
5. Surface contributors, recent audit, and endorsement counts in the existing flight
   location dialog and compactly near public location labels. No site or zone URLs.
6. Extend operator tooling so admins can list community state, inspect audit, clear bad
   boundaries, and merge without silently losing contributors/votes/audit.

**Explicitly out of scope**

- Approval queues, moderation voting, rollback-to-previous-version, and edit proposals.
  The sprint chooses accountable direct edits, not a governance system.
- Comments, reports, reputation scoring, trust levels, badges, notifications, and user
  blocking. These are moderation products, not prerequisites for v1 accountability.
- Upvote-weighted matching or ranking. Votes are display legitimacy only; changing
  `findLocation` ranking would couple social data to ingest correctness and deserves
  usage data first.
- New metadata fields for wind, hazards, directions, parking, local rules, or site
  descriptions. The schema leaves room, but this sprint ships the accountability layer
  those later fields need.
- Dedicated `/sites/<id>` or `/zones/<id>` pages. The existing policy that site/zone ids
  do not appear in URLs stays closed.
- Public audit for private edits before publication. Publishing records "published";
  it does not reveal what the private row used to be called.

## Use Cases

1. **A public site has visible provenance.** A pilot sees "Mission Ridge" on a public
   flight, opens the location dialog, and sees the creator/backfilled contributor, recent
   contributors, endorsement count, and recent audit events.
2. **Fix a typo on a shared public site.** A signed-in pilot notices "Mission Rdigde,"
   renames it to "Mission Ridge," and saves. The flight caches are recomputed exactly as
   today, the pilot is added to the contributors roster, and an audit event records the
   old and new public names.
3. **Correct a public boundary.** A pilot edits a public zone boundary they did not
   create. The existing SPRINT-006 geometry validation and daily edit cap still apply;
   the edit is attributed in both `boundaryUpdatedById` and the audit log.
4. **Private stays private.** A stranger cannot rename, boundary-edit, vote on, or view
   contributors/audit for another pilot's private site or private zone. Existing owner
   flows keep working.
5. **Endorse without editing.** A pilot who recognizes a public site upvotes it. The
   count increments, `hasUpvoted` becomes true for that pilot, and another click removes
   it. A hidden or private target behaves like "not found."
6. **Contributor cannot also endorse.** A pilot who created or edited a site cannot
   upvote that same site. If they had upvoted before making their first edit, the edit
   transaction removes the vote and the count drops by one.
7. **Creator cannot reclaim a community row.** The original owner can still undo a brand
   new public row before anyone else depends on it. Once a second contributor, an
   endorsement, another pilot's flight reference, or another-owned zone exists, demotion
   or delete is refused with the existing "community property" style error and routed to
   operator remedy.
8. **Zone accountability respects the parent.** A public zone under a public site has its
   own contributor roster, audit, and votes. Editing the parent site does not make the
   actor a contributor to every child zone; editing a zone does not make them a site
   contributor unless the site itself is also changed.
9. **Existing public rows transition cleanly.** Public sites/zones already in production
   show their current owner as the initial contributor where one exists. Rows with
   `boundaryUpdatedById` also show the boundary updater as a contributor, with a
   backfilled audit note.
10. **Operator investigates a bad edit.** An admin runs `scripts/admin-sites.ts list` or
    `audit` for a site and sees the actor, action, timestamp, and compact summary needed
    to repair or merge the row.

## Architecture

### Data model

Use explicit site and zone tables for contributors and votes, because those need real
foreign keys and cascades. Use one append-only audit table with `(targetType, targetId)`
and no target FK, because audit should survive merges/deletes and because a polymorphic
FK is not enforceable in Prisma/Postgres without awkward triggers.

```prisma
model Profile {
  // ...existing...
  siteContributions SiteContributor[]
  zoneContributions ZoneContributor[]
  siteVotes         SiteVote[]
  zoneVotes         ZoneVote[]
  locationAuditEvents LocationAuditEvent[] @relation("LocationAuditActor")
}

model Site {
  // ...existing...
  contributors SiteContributor[]
  votes        SiteVote[]
}

model Zone {
  // ...existing...
  contributors ZoneContributor[]
  votes        ZoneVote[]
}

model SiteContributor {
  siteId             String
  profileId          String
  site               Site    @relation(fields: [siteId], references: [id], onDelete: Cascade)
  profile            Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  firstContributedAt DateTime @default(now())
  lastContributedAt  DateTime @default(now())
  contributionCount  Int      @default(1)

  @@id([siteId, profileId])
  @@index([siteId, lastContributedAt])
  @@index([profileId])
}

model ZoneContributor {
  zoneId             String
  profileId          String
  zone               Zone    @relation(fields: [zoneId], references: [id], onDelete: Cascade)
  profile            Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  firstContributedAt DateTime @default(now())
  lastContributedAt  DateTime @default(now())
  contributionCount  Int      @default(1)

  @@id([zoneId, profileId])
  @@index([zoneId, lastContributedAt])
  @@index([profileId])
}

model SiteVote {
  siteId    String
  profileId String
  site      Site    @relation(fields: [siteId], references: [id], onDelete: Cascade)
  profile   Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([siteId, profileId])
  @@index([siteId, createdAt])
}

model ZoneVote {
  zoneId    String
  profileId String
  zone      Zone    @relation(fields: [zoneId], references: [id], onDelete: Cascade)
  profile   Profile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([zoneId, profileId])
  @@index([zoneId, createdAt])
}

model LocationAuditEvent {
  id         String   @id @default(cuid())
  targetType String   // site | zone
  targetId   String
  actorId    String?
  actor      Profile? @relation("LocationAuditActor", fields: [actorId], references: [id], onDelete: SetNull)
  action     String   // created | published | renamed | boundary_set | boundary_cleared | merge | backfill
  summary    Json     @default("{}")
  createdAt  DateTime @default(now())

  @@index([targetType, targetId, createdAt])
  @@index([actorId, createdAt])
}
```

Raw SQL in the migration:

```sql
ALTER TABLE "LocationAuditEvent" ADD CONSTRAINT "location_audit_target_type_check"
  CHECK ("targetType" IN ('site', 'zone'));

ALTER TABLE "LocationAuditEvent" ADD CONSTRAINT "location_audit_action_check"
  CHECK ("action" IN (
    'created', 'published', 'renamed', 'boundary_set', 'boundary_cleared',
    'merge', 'backfill'
  ));
```

No `Site.voteCount` or `Zone.voteCount` column in v1. SPRINT-003's actual `Kudo`
implementation computes counts with `groupBy`/`count`, avoiding drift and account-delete
reconciliation. Site/zone endorsement counts should follow that shipped pattern unless
real list-scale data proves otherwise.

### Backfill

The migration is additive, then a backfill script runs once:

- For every public `Site.ownerId`, insert `SiteContributor(siteId, ownerId)`.
- For every public `Zone.ownerId`, insert `ZoneContributor(zoneId, ownerId)`.
- For every public boundary-bearing row with `boundaryUpdatedById`, insert/update that
  profile as a contributor and append a `boundary_set` backfill audit summary.
- Append one actor-null `backfill` audit event per existing public row so the audit UI
  can distinguish "history starts here" from "no one has touched this."
- Curated/null-owner rows get an actor-null audit entry but no contributor row.

Backfill must be idempotent (`ON CONFLICT DO NOTHING` / upsert) and safe to re-run in
local dev. It must not create contributors or audit entries for private rows.

### Community policy

Centralize the new decision in `lib/sites/associate.ts`, not in UI components:

```ts
type LocationLevel = "site" | "zone";

function canCommunityEditSite(site, callerId): boolean {
  return site.visibility === "public" || site.ownerId === callerId;
}

function canCommunityEditZone(zone, site, callerId): boolean {
  if (zone.visibility === "public" && site.visibility === "public") return true;
  return zone.ownerId === callerId || site.ownerId === callerId;
}
```

The real implementation should be stricter than the sketch:

- Public edit requires an authenticated `Profile` row, not just a session id.
- A public zone is community-editable only when its parent site is effectively public.
  A public zone under a private site remains neutralized by SPRINT-005's conjunction and
  is not editable by strangers.
- `setSiteVisibility(site, caller, "public")` remains owner-only, because publishing a
  private coordinate is still the owner's privacy decision.
- `unpublishOwnSite`, `deleteSite`, `unpublishOwnZone`, and `deleteZone` keep the
  existing referenced-by-others guards and add `hasCommunityFootprint(...)`: any
  non-owner contributor, vote, public audit event by another actor, or other-owned child
  zone blocks destructive creator undo.

Every successful public contribution runs one transaction:

1. Re-read the target and enforce the community policy.
2. Validate the proposed change using existing name/boundary validators.
3. Apply the row mutation and cache recomputation exactly as today.
4. Upsert the contributor row and increment `contributionCount`.
5. Delete any vote by that actor for the same target.
6. Append `LocationAuditEvent`.

If any step fails, none of it lands. Audit without mutation is not acceptable; mutation
without audit is worse and should be covered by tests.

### Audit summaries

Audit summaries are compact public facts:

- `renamed`: `{ "from": "Mission Rdigde", "to": "Mission Ridge" }`
- `published`: `{ "visibility": "public" }` with no private old name
- `boundary_set`: `{ "vertices": 18, "areaM2": 420000, "bbox": { ... } }`
- `boundary_cleared`: `{ "hadBoundary": true }`
- `merge`: `{ "fromTargetId": "...", "intoTargetId": "...", "carriedVotes": 4 }`
- `backfill`: `{ "reason": "existing_public_row" }`

Do not store raw boundary geometry in audit. The authoritative geometry remains the
current row; audit records accountability, not versioned rollback.

### Read APIs

Add `lib/sites/community.ts`:

```ts
export interface LocationCommunitySummary {
  voteCount: number;
  hasUpvoted: boolean;
  contributors: Array<{ id; handle; displayName; avatarUpdatedAt; contributionCount; lastContributedAt }>;
  recentAudit: Array<{ id; action; actor; summary; createdAt }>;
}

export async function siteCommunitySummaryForViewer(siteId: string, viewerId: string | null): Promise<LocationCommunitySummary | null>;
export async function zoneCommunitySummaryForViewer(zoneId: string, viewerId: string | null): Promise<LocationCommunitySummary | null>;
export async function toggleSiteVote(siteId: string, viewerId: string): Promise<{ upvoted: boolean }>;
export async function toggleZoneVote(zoneId: string, viewerId: string): Promise<{ upvoted: boolean }>;
```

Read gating:

- Site summaries return only for public sites, or for the owner viewing their private
  row. Private owner summaries can show only owner-local contributor state; no public
  audit surface is required.
- Zone summaries call `canSeeZone(zone, site, viewerId)` and require effective public
  for votes.
- Vote toggles require signed-in viewer, visible public target, and no contributor row
  for that viewer/target. They use the same delete-then-create toggle shape as
  `lib/social/kudos.ts`, with the composite PK handling concurrent double-clicks.
- Batch count helpers (`siteVoteCountsFor`, `zoneVoteCountsFor`) accept only ids the
  caller already authorized, exactly like `kudoCountsFor`.

### UI

Keep the surface inside existing flight/location flows:

- `components/flight/name-site-dialog.tsx` gains a compact **Community** tab/section for
  the currently bound or selected public site/zone: endorsement button, count,
  contributors roster, and recent audit.
- The flight header/logbook row can show a small endorsement count next to a public
  location label when the row already has authorized public site/zone ids. It should not
  trigger per-row N+1 queries; list surfaces use batch counts or omit the count.
- Community edit affordances for public rows reuse the existing rename/boundary editor
  patterns, but labels/copy must make the shared effect explicit before save.
- No IDs in URLs and no public directory. A pilot reaches the row through a flight or
  the existing owner-scoped picker.

## Implementation

Four ordered PRs. Each passes `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
and `pnpm e2e` before merge.

### PR1 — Storage, backfill, and read-only summaries

- Migration `20260823xxxxxx_location_community`: contributor tables, vote tables,
  `LocationAuditEvent`, relations on `Profile`/`Site`/`Zone`, indexes, and raw-SQL
  CHECK constraints.
- Backfill script or migration SQL for existing public sites/zones, including
  `boundaryUpdatedById` contributor seeding where present.
- `lib/sites/community.ts`: viewer-scoped summary reads, contributor roster queries,
  audit reads, and batch vote count helpers. No mutation yet.
- Tests: migration applies to current schema; backfill is idempotent; private rows get
  no public audit/contributor entries; public owner and boundary updater are seeded;
  summary reads fail closed for private/missing/mismatched zone parents.

### PR2 — Transactional audit and contributors on writes

- `lib/sites/associate.ts`: helper functions `recordLocationContribution`,
  `recordLocationAudit`, `hasCommunityFootprint`, and community edit guards.
- Update existing create/publish/rename/boundary set/clear paths to record audit and
  contributors in the same transaction. Keep `boundaryUpdatedById` as last-writer
  convenience; audit becomes the durable history.
- Change public rename and public boundary set/clear authorization to signed-in
  community edit. Keep private authorization unchanged.
- Extend destructive guards so public rows with community footprint cannot be demoted or
  deleted through ordinary pilot actions.
- Tests: owner-private behavior unchanged; stranger cannot edit private rows; signed-in
  pilot can rename/boundary-edit effective-public rows; each mutation creates exactly
  one audit event and contributor update; failed validation creates neither; destructive
  undo is blocked after a non-owner contribution or vote.

### PR3 — Votes and community UI

- `toggleSiteVote` / `toggleZoneVote` server functions plus actions reachable from the
  flight page.
- Composite-PK toggle behavior matching `toggleKudo`: delete existing vote first,
  create if absent, handle concurrent unique conflict by converging to a stable state.
- Contributor vote exclusion: reject if the viewer is already a contributor; delete the
  viewer's vote when they later contribute.
- `name-site-dialog.tsx` community section with endorsement button, contributor roster,
  recent audit, loading/empty states, and clear public/shared consequences before edit.
- Optional compact counts on flight/logbook surfaces via batch helpers only.
- Tests: cannot vote on private or invisible target; cannot vote on own contributor
  target; toggles are idempotent under concurrency; counts/recent state correct; UI
  renders contributors/audit for public rows and not for private rows.

### PR4 — Operator remedy, release pass, and end-to-end coverage

- `scripts/admin-sites.ts`: `audit site|zone <id>`, enhanced `list`, and merge behavior
  that carries contributors/votes/audit forward or records exactly what was dropped.
- Operator commands for force-private/delete/merge append actor-null or operator-labelled
  audit events where a target survives.
- E2E: one pilot creates a public site, another edits its name or boundary, a third
  upvotes it, the original creator cannot delete/demote it, and the community roster,
  audit, and endorsement count are visible from the flight page.
- Documentation/release: `lib/whats-new.ts`, `FEATURES.md`, `docs/architecture.md`, and
  `docs/sprints/ledger.tsv`.

## Files Summary

**New:** `lib/sites/community.ts` (+ tests),
`prisma/migrations/20260823xxxxxx_location_community/`,
possibly `scripts/backfill-location-community.ts`,
`test/location-community.integration.test.ts`.

**Modified:** `prisma/schema.prisma`, `lib/sites/associate.ts`,
`app/flights/[id]/site-action.ts`, `app/flights/[id]/boundary-action.ts`,
`components/flight/name-site-dialog.tsx`, `components/flight/flight-header.tsx`,
`components/logbook/flight-row.tsx`, `scripts/admin-sites.ts`
(+ `scripts/admin-sites.test.ts`), `test/sites.integration.test.ts`,
`test/e2e/*.spec.ts`, `lib/whats-new.ts`, `FEATURES.md`, `docs/architecture.md`,
`docs/sprints/ledger.tsv`.

**Unchanged on purpose:** `Flight` schema and all eight location cache columns (votes
do not affect matching or display labels), `lib/sites/lookup.ts` ranking, `canSeeSite`
/ `canSeeZone` semantics, `app/api/upload/route.ts`, `app/api/ingest/route.ts`, and the
no-site-or-zone-URL policy.

## Definition of Done

- [ ] Existing public sites/zones are backfilled with initial contributors/audit without
      touching private rows; the backfill can be re-run safely.
- [ ] `ownerId` remains on `Site`/`Zone` as creator/provenance; private-row edit,
      unpublish, delete, and boundary behavior is unchanged and covered by regression
      tests.
- [ ] Public `Site` rename and boundary set/clear can be performed by any signed-in,
      onboarded pilot; public `Zone` edit requires the zone and parent site to be
      effectively public.
- [ ] Destructive public demote/delete is blocked once another pilot has contributed,
      voted, referenced the row, or owns a child zone; operator remedy remains available.
- [ ] Every successful public create/publish/rename/boundary set/clear records an audit
      event and updates the contributor roster in the same transaction as the mutation.
- [ ] Failed validation or authorization writes no audit and no contributor row.
- [ ] Audit summaries never include private old names or raw boundary geometry.
- [ ] Contributors are added only for material writes, not for matching, viewing,
      flying through, or voting.
- [ ] Site and zone votes use composite primary keys and are toggleable, one per pilot
      per visible public target.
- [ ] Contributors cannot vote for the same target; a later contribution removes the
      actor's prior vote transactionally.
- [ ] Vote counts are computed from vote tables, not denormalized onto `Site`/`Zone`.
- [ ] Community summary reads are viewer-scoped, fail closed for private targets, and
      apply the existing site/zone visibility conjunction.
- [ ] No list/feed/profile path introduces an N+1 community query; batch helpers are
      used or compact counts are omitted.
- [ ] The existing privacy leak sweep is extended so private site/zone names, contributor
      state, audit state, and vote state never appear to unauthorized viewers.
- [ ] Operator list/audit/merge commands preserve or explicitly account for contributors,
      votes, and audit.
- [ ] E2E covers cross-pilot public edit, endorsement, visible roster/audit, and blocked
      creator reclaim.
- [ ] All five validation gates pass; `/whats-new`, `FEATURES.md`, architecture docs,
      and the sprint ledger are updated.

## Risks

- **Public community edits can degrade shared data.** This is the sprint's central risk:
  any signed-in pilot can make a public name or boundary worse. Mitigation is scoped
  edit types, existing validators, rate limits, contributor/audit attribution, visible
  endorsement counts, and operator repair. Delete/demote is deliberately excluded from
  community editing.
- **Audit becomes a privacy leak.** A naive event log could expose a private old name
  after publication or store raw geometry forever. Mitigation: public-row audit only,
  compact public summaries, no raw boundary JSON, and explicit tests for publish from a
  private row.
- **Contributor/vote logic creates conflicting legitimacy signals.** Letting editors
  upvote their own rows would inflate trust. V1 chooses non-contributor endorsements and
  transactionally removes votes when voters become contributors.
- **A single audit table has no target FK.** This is intentional so history survives
  merges/deletes, but it means application code must gate reads by resolving the target
  first. Mitigation: keep all audit reads in `lib/sites/community.ts` and add direct
  tests for hidden/missing targets.
- **More writes in already-complex transactions.** Rename and boundary functions already
  update caches and sometimes re-associate flights. Adding contributor/audit/vote cleanup
  increases transaction surface. Mitigation: small helper functions, no network calls in
  transactions, and tests asserting mutation/audit atomicity.
- **Backfill may misrepresent history.** Existing rows only have current owner and
  `boundaryUpdatedById`; older edits are unknowable. Mitigation: label migrated entries
  as `backfill`, not as precise historical events.
- **No approval workflow.** Accountability may be insufficient if abuse appears. The
  sprint leaves a clean path to proposals/moderation later by centralizing audit and
  contribution facts now.

## Security

- Privacy remains app-layer, no RLS. Community summary and vote APIs must first prove the
  target row is visible through the same `canSeeSite`/`canSeeZone` rules used elsewhere.
- Public community editing never grants access to private rows. Effective-public zone
  editing requires both the zone and parent site to be public.
- Mutations authenticate, load the target server-side, authorize against the current row,
  validate input, then write. Client-supplied ids are treated as untrusted and hidden
  targets return not-found-equivalent errors.
- Audit actor is `SetNull` on profile deletion; contributor/vote rows cascade with the
  profile. Deleting an account removes active social signals but preserves historical
  audit attribution as "deleted user."
- Audit summaries are bounded JSON generated server-side from known fields, not arbitrary
  client payload.
- Upvote toggles are engagement signals, not authorization signals. They must not affect
  matching, visibility, or edit permissions in v1.

## Dependencies

- **Internal:** PR2 depends on PR1; PR3 depends on PR2 for contributor exclusion and
  summary reads; PR4 depends on PR1-PR3.
- **Stack:** no new npm package, no Postgres extension, no change to Prisma v6, Next 16,
  NextAuth v5, Railway, or the local docker-compose Postgres flow.
- **Precedent:** SPRINT-003 `Kudo` for composite-PK toggles and computed counts;
  SPRINT-005 `findZoneEditableBy` and community-property delete guards; SPRINT-006
  boundary attribution/rate-limit write path.
- **Data:** existing public `Site`/`Zone` rows, optional `boundaryUpdatedById`, and public
  profile fields (`handle`, `displayName`, `avatarUpdatedAt`) for contributor display.

## Open Questions

1. Should public community editing require only "signed in and onboarded," or should it
   require a stronger signal such as at least one ready flight in the account?
2. Are contributors permanently barred from upvoting a target, or should their votes be
   allowed but displayed separately from non-contributor endorsements?
3. Should public `kind` changes (`takeoff` / `landing` / `both`) be community-editable in
   this sprint, or deferred with richer metadata?
4. Should audit retain old public names forever, or should there be an operator redaction
   command for abusive/PII names?
5. Should operator identity be modeled as a real `Profile` actor, or are actor-null
   admin audit events sufficient for now?
6. Does a public row with zero non-owner contributors but one upvote already block
   creator demotion/delete? This draft says yes; confirm the product expectation.
