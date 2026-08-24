# SPRINT-007 — Community signals for public sites and zones

> Independent draft by Claude. See
> [`SPRINT-007-INTENT.md`](./SPRINT-007-INTENT.md) for the raw seed and
> constraints.

## Overview

Every public `Site` and `Zone` in Leaf Log has exactly one `ownerId` today, and
edit-control flows through it: the owner renames, demotes, deletes, draws
boundaries. SPRINT-005 decision 4 extended that model one level down — a site's
owner can also rename/delete zones other pilots contributed under their site.
That's the right default for a young gazetteer with a handful of pilots, but it
leaves no visible signal that a public site is a shared, community-used place
rather than one pilot's personal record. When a stranger creates "Mission
Ridge," another pilot has no way to see who named it, what edits it's had, or
whether other pilots agree it's legitimate — short of asking the first pilot
directly.

This sprint adds three community signals to public sites and zones, layered on
top of the existing ownership model without changing who can edit what:

1. **An audit log** — an append-only record of every consequential action
   (create, rename, visibility change, boundary set/clear) attributed to the
   acting pilot, replacing `boundaryUpdatedById`'s "last writer only" as the
   only change-history mechanism.

2. **A contributors roster** — the set of pilots who have made deliberate edits
   to a site or zone, derived from the audit log (not a separate table),
   displayed in the naming dialog so pilots can see who shaped a place.

3. **Endorsements** (the "upvote") — a one-per-user-per-row signal that a pilot
   considers the site legitimate, modelled on the `Kudo` join-table pattern with
   the same toggle mechanic.

Five decisions anchor the sprint:

1. **The existing single-owner edit-control model is unchanged.** `ownerId`
   stays, with its current meaning, on every `Site` and `Zone` row. The site
   owner's power over child zones (SPRINT-005 decision 4) is unchanged. The undo
   guards (`referencedByOthers`, `siteHasOtherOwnedZone`) are unchanged. What
   this sprint adds is *visibility into* how those powers have been used, not a
   change to who holds them. Broadening edit-control to contributors (or to all
   signed-in pilots) is explicitly deferred — this sprint builds the
   infrastructure (audit log, roster) that any sane community-edit model would
   need as a prerequisite.

2. **A "contributor" is a pilot who made a deliberate edit — not one whose
   flight was auto-matched there.** Creating the row, renaming it, changing its
   visibility, or setting/clearing its boundary are contributions. Having a
   flight matched to a site by the ingest pipeline is not — it's automatic, and
   conflating it with deliberate stewardship would flood the roster with every
   pilot who ever launched from Mission Ridge. The contributor roster is
   therefore a query against the audit log (`SELECT DISTINCT actorId FROM
   LocationAuditEntry WHERE siteId = ?`), not a separately maintained table.

3. **The audit log is a single table with a target-type discriminator, not
   per-model tables.** `LocationAuditEntry` carries mutually exclusive `siteId`
   / `zoneId` FKs, enforced by a raw-SQL CHECK (`num_nonnulls(...) = 1`),
   matching the codebase's existing "raw SQL for constraints Prisma v6 can't
   express" precedent. One table, one writer module, one query shape — two
   tables would double the surface for zero expressiveness gain.

4. **Endorsements are modelled identically to `Kudo`** — separate
   `SiteEndorsement` / `ZoneEndorsement` join tables with a composite PK that
   enforces one-per-user-per-row, a toggle mechanic, and no denormalized count
   (queried on demand, same as `kudoCountsFor`). Endorsements are a pure
   display signal in v1 — no ranking effect, no matching effect. Adding
   functional weight before there's real data about endorsement distribution
   would be premature optimization of a social signal.

5. **`boundaryUpdatedById` stays.** The audit log runs alongside it, not in
   place of it. The single-column attribution is a fast, indexed lookup for the
   most common question ("who last drew this boundary?"); the audit log answers
   the harder question ("what happened, in order, and by whom?"). Retiring the
   column is a future cleanup, not this sprint's concern.

**Committed v1 scope**

1. `LocationAuditEntry` table — append-only, one row per consequential mutation,
   with `siteId`/`zoneId` (exactly one non-null), `actorId`, `action`, `detail`
   (JSON, action-specific before/after context), `createdAt`, CHECKs on the
   target discriminator and action enum.
2. `SiteEndorsement` / `ZoneEndorsement` tables — composite-PK join tables, one
   per user per row, `onDelete: Cascade` on both FKs, with a toggle action and
   a batch-count query.
3. Audit entries written inside every existing site/zone mutation transaction in
   `lib/sites/associate.ts` and `lib/sites/repo.ts` — create, rename, visibility
   change, boundary set/clear — with no change to the mutation's own behavior.
4. A backfill migration that seeds a `create` audit entry for every existing
   public `Site`/`Zone` with a non-null `ownerId`, dated at the row's own
   `createdAt`.
5. Contributor roster derived from the audit log, displayed in the naming dialog
   for public sites/zones.
6. Endorsement toggle + count displayed in the naming dialog, restricted to
   public rows and signed-in pilots.
7. A compact audit history ("History") section in the naming dialog, most recent
   first.

**Explicitly out of scope** (with reasons)

- **Changing who can edit a public site/zone.** The "any contributor can edit"
  or "any signed-in pilot can edit" models are genuine product decisions, not
  engineering problems. They need the roster and audit infrastructure this sprint
  builds, so they're deferred *after* this ships — not alongside it, where a
  half-baked permission model risks shipping on top of three new tables. This is
  the intent document's own observation (open question 8): the additive,
  lower-risk parts should ship first.
- **Removing or reinterpreting `ownerId`.** The column drives edit-control
  gates, zone undo guards, cascade semantics, and `admin-sites.ts`'s merge
  logic. Repurposing it without changing all of those is a silent regression.
- **A denormalized `endorsementCount` on `Site`/`Zone`.** The Kudo pattern
  queries on demand and handles batch counts via `groupBy`. Endorsement counts
  are displayed only in the naming dialog (not in list views), so the query is
  per-dialog-open. A denormalized count is revisitable if performance demands it.
- **Endorsements affecting matching or ranking.** No endorsement-weighted
  `compareSiteCandidates` tier, no "endorsed sites match first." Endorsements
  are informational. Adding ranking weight before there's real data would couple
  a social signal to a correctness-critical path.
- **Audit logging of operator actions** (`scripts/admin-sites.ts`). Operators
  act outside the ownership model entirely and have their own console logs.
  Extending the audit log to operator actions is useful but separable and not
  load-bearing for the community-signals feature.
- **A flight-matched-there signal.** "Pilots who have flown here" is a
  different, noisier signal than "pilots who contributed to this site's
  definition." Worth exploring separately, not conflated with the contributor
  roster.
- **Site/zone pages, browse, or search.** No `/sites/<id>` URL — the standing
  policy stays closed. All new display surfaces live inside the existing naming
  dialog.
- **Notifications** ("someone edited your site," "your site got an
  endorsement"). Useful follow-up, separable, no user behind it yet.

## Use Cases

1. **Who named this place?** A pilot opens a flight at "Mission Ridge," taps the
   site name, and the naming dialog shows "Created by @mountainpilot" with a
   list of contributors. They can see the site's provenance without asking
   around.

2. **What happened to my site?** A pilot notices Mission Ridge was renamed to
   "Mission Peak." They open the naming dialog and expand "History" — the audit
   log shows "@otherpilot renamed from 'Mission Ridge' to 'Mission Peak' — 2h
   ago." They know who to talk to, and the operator knows who to investigate if
   it's vandalism.

3. **Is this site legit?** A pilot sees "Sonoma Ridge" with 0 endorsements and
   wonders if it's a real site. They see "Mission Ridge" with 8 endorsements and
   a contributor list of 3 pilots. The endorsement count is a quick social proof
   signal, not a guarantee.

4. **Endorse a site you fly from.** A pilot opens any flight at Mission Ridge,
   taps the site name, and hits "Endorse." The count goes from 7 to 8. They tap
   again — it toggles off, back to 7. Same mechanic as kudos, applied to a
   place instead of a flight.

5. **A private site is unaffected.** A pilot's private site has no endorsement
   button, no contributor list, no audit history visible to anyone but the owner.
   Private remains private — community signals are for community-visible rows
   only.

6. **Existing production sites transition cleanly.** After the migration, every
   existing public site and zone has one audit entry ("created by @handle"),
   making the current owner the first contributor. Endorsement count starts at
   zero. No manual fixup, no behavior change.

7. **Accountability for a boundary change.** A pilot drew a boundary on someone
   else's public zone (via the site-owner override from SPRINT-005 decision 4).
   The audit log records who did it and when. Both `boundaryUpdatedById` and the
   audit entry agree — the column provides the fast lookup, the log provides the
   full history.

8. **A pilot who creates AND endorses.** A pilot creates "Eagle Peak," which
   makes them a contributor. They also endorse it — both actions are independent.
   The contributor roster shows them as the creator; the endorsement count
   includes their vote. No restriction on endorsing a site you contributed to.

9. **Endorsement abuse resistance.** A pilot tries to endorse Mission Ridge
   twice. The composite PK (`siteId, profileId`) prevents it — the second
   attempt toggles off the first one. No automation, no spam accounts —
   signed-in, onboarded pilots only.

10. **A zone's contributor list includes the site owner's edits.** The site
    owner renamed a zone under their site (SPRINT-005 decision 4 power). The
    zone's audit log shows their rename, and they appear in the zone's
    contributor list even though they didn't create the zone. Accountability
    works both ways.

11. **Endorsement on a zone, not just a site.** A pilot endorses "North Launch"
    specifically (a zone under Mission Ridge). Zone endorsements and site
    endorsements are independent — endorsing the zone doesn't endorse the parent,
    and vice versa.

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
  actor     Profile? @relation("AuditEntries", fields: [actorId], references: [id], onDelete: SetNull)
  action    String   // create | rename | visibility_change | boundary_set | boundary_clear
  detail    Json?    // action-specific context: { from, to } for renames/visibility
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
  // ...unchanged... plus:
  auditEntries   LocationAuditEntry[] @relation("SiteAuditEntries")
  endorsements   SiteEndorsement[]    @relation("SiteEndorsements")
}

model Zone {
  // ...unchanged... plus:
  auditEntries   LocationAuditEntry[] @relation("ZoneAuditEntries")
  endorsements   ZoneEndorsement[]    @relation("ZoneEndorsements")
}

model Profile {
  // ...unchanged... plus:
  auditEntries      LocationAuditEntry[] @relation("AuditEntries")
  siteEndorsements  SiteEndorsement[]    @relation("SiteEndorsements")
  zoneEndorsements  ZoneEndorsement[]    @relation("ZoneEndorsements")
}
```

**Raw SQL appended to the migration** (Prisma v6 precedent):

```sql
-- Exactly one of siteId/zoneId must be non-null — the target discriminator.
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "audit_target_check"
  CHECK (num_nonnulls("siteId", "zoneId") = 1);

-- The action enum — cheap to enforce, loud to violate.
ALTER TABLE "LocationAuditEntry" ADD CONSTRAINT "audit_action_check"
  CHECK ("action" IN ('create','rename','visibility_change','boundary_set','boundary_clear'));
```

**Why `onDelete: Cascade` on `LocationAuditEntry.siteId`/`zoneId`.** If a site
is deleted, its audit history goes with it. A site can only be deleted by its
owner when no other pilot depends on it (the existing `referencedByOthers` +
`siteHasOtherOwnedZone` guard), so the audit log at that point records only the
creator's own actions — there's no third-party accountability to preserve. The
operator remedy (`admin-sites.ts` merge) reassigns references first, and
operators have their own structured console logs.

**Why `onDelete: SetNull` on `LocationAuditEntry.actorId`.** A deleted profile
shouldn't erase the audit trail. The entry stays with `actorId = null`,
rendering as "a deleted pilot" — the log entry survives even when the actor
doesn't.

**Why `onDelete: Cascade` on both endorsement FKs.** Deleting the site removes
its endorsements (no orphan cleanup needed); deleting a profile removes that
pilot's endorsements everywhere (they can't endorse if they're gone). Both are
the obvious, safe cascades.

**The `detail` column.** A nullable `Json` carrying action-specific context:

| action | detail |
|---|---|
| `create` | `{ name, visibility }` |
| `rename` | `{ from, to }` |
| `visibility_change` | `{ from, to }` (e.g., `"public"` → `"private"`) |
| `boundary_set` | `{ vertices }` (count only — the full geometry is too large and not useful for display) |
| `boundary_clear` | `null` |

The detail is *display context*, not a restoration mechanism. No undo-from-audit
in v1.

### The audit writer (`lib/sites/audit.ts`)

A new module, pure except for the Prisma write, shaped to be called from inside
an existing transaction:

```ts
export type AuditAction =
  | "create" | "rename" | "visibility_change"
  | "boundary_set" | "boundary_clear";

export interface AuditTarget {
  siteId?: string;
  zoneId?: string;
}

export async function writeAuditEntry(
  tx: AuditWriteDb,
  target: AuditTarget,
  actorId: string,
  action: AuditAction,
  detail?: Record<string, unknown>,
): Promise<void>;
```

**Where it's called.** Inside the `$transaction` of every mutation that changes
a site or zone in a way a pilot would care about:

- `createOrAttachSiteFromFlight` (in `repo.ts`) → `create` on site and/or zone
  creation
- `renameSite` / `renameZone` → `rename`
- `setSiteVisibility` / `setZoneVisibility` / `unpublishOwnSite` /
  `unpublishOwnZone` → `visibility_change`
- `setSiteBoundary` / `clearSiteBoundary` / `setZoneBoundary` /
  `clearZoneBoundary` → `boundary_set` / `boundary_clear`

Not called from `deleteSite` / `deleteZone` — the cascade would immediately
remove the entry, making it pointless. A "this was deleted" record needs a
different shape (e.g., a non-cascading archive table), which is separable and
not required by the success criteria.

### The contributor roster

Derived from the audit log, not separately maintained:

```ts
// lib/sites/contributors.ts

export interface Contributor {
  profileId: string;
  handle: string;
  displayName: string;
  avatarUpdatedAt: Date | null;
  firstContributedAt: Date;
  actionCount: number;
}

export async function contributorsForSite(siteId: string): Promise<Contributor[]>;
export async function contributorsForZone(zoneId: string): Promise<Contributor[]>;
```

The query groups audit entries by `actorId`, joins `Profile` for display fields,
orders by `firstContributedAt` (earliest contributor first — the creator is
always first), and returns the full roster. At the expected scale (a few dozen
audit entries per site, at most), this is a sub-millisecond indexed query.

**Why derived, not materialized.** A separate `SiteContributor` table would need
dual-writes (audit entry + contributor upsert) in every mutation, with a
consistency obligation: if the audit entry is written but the contributor row
isn't (a partial failure, a future refactor that forgets), the roster lies. A
derived roster is always consistent with the log by construction. The cost — a
slightly more complex query vs. a straight `findMany` — is negligible at this
scale and disappears entirely if a materialized view is ever needed.

### Endorsements (`lib/sites/endorsements.ts`)

Mirroring `lib/social/kudos.ts` in structure and mechanic:

```ts
export interface EndorsementSummary {
  count: number;
  hasEndorsed: boolean;
}

export async function toggleSiteEndorsement(
  siteId: string,
  viewerId: string,
): Promise<{ endorsed: boolean }>;

export async function toggleZoneEndorsement(
  zoneId: string,
  viewerId: string,
): Promise<{ endorsed: boolean }>;

export async function siteEndorsementSummary(
  siteId: string,
  viewerId: string | null,
): Promise<EndorsementSummary>;

export async function zoneEndorsementSummary(
  zoneId: string,
  viewerId: string | null,
): Promise<EndorsementSummary>;

export async function siteEndorsementCounts(
  siteIds: string[],
): Promise<Map<string, number>>;

export async function zoneEndorsementCounts(
  zoneIds: string[],
): Promise<Map<string, number>>;
```

**Toggle mechanic.** Identical to `toggleKudo`: attempt a delete; if it deletes
a row, return `{ endorsed: false }`; otherwise create, catching the P2002
conflict (composite PK) and toggling off on race. Signed-in pilots only.

**No self-endorsement restriction.** Unlike kudos ("you cannot kudos your own
flight"), a pilot CAN endorse a site they created or contributed to. An
endorsement is "this place is legitimate," and the creator thinks so by
definition. Restricting it adds UX friction for zero abuse-resistance gain (one
self-vote doesn't change anything).

**Public rows only.** `toggleSiteEndorsement` / `toggleZoneEndorsement` refuse
on private rows — a private site is one person's record, not a community signal
target. The check is against the row's own `visibility`, not effective
visibility — a public zone under a private site is technically endorsable, but
practically invisible; the UI won't show the button for a zone whose parent is
private (the conjunction), so this edge case is unreachable in practice.

**Batch counts** (`siteEndorsementCounts` / `zoneEndorsementCounts`) follow the
`kudoCountsFor` pattern — a `groupBy` over the join table, returning a `Map`.
Used by `suggestNearbyLocations`' display to show endorsement counts on nearby
site suggestions.

### Display surfaces

All new display surfaces live inside the existing naming dialog
(`components/flight/name-site-dialog.tsx`) and on the flight detail page, with
no new routes, no new URLs.

**In the naming dialog** (when viewing a public site/zone's info):

- **Contributors section.** A compact list of contributor avatars + handles,
  ordered by first contribution. The creator is labelled "(creator)." Derived
  from `contributorsForSite`/`contributorsForZone`.
- **Endorsement count + toggle button.** Shows the current count and whether the
  signed-in viewer has endorsed. Anonymous viewers see the count but no button.
- **"History" expandable.** The most recent N (capped at 20) audit entries, each
  showing: actor handle, action description ("renamed from X to Y," "set a
  boundary"), relative timestamp. Collapsed by default.

**In site suggestions** (the naming dialog's reuse-first list):

- Each suggested site/zone shows its endorsement count as a small badge, giving
  a quick legitimacy signal when choosing between nearby sites.

**On the flight detail page** (`app/flights/[id]/page.tsx`):

- The endorsement count is shown next to the site/zone name in the flight header
  as a compact badge (e.g., "↑8"). The count is informational; the toggle lives
  in the naming dialog.

**Not in list views.** Logbook rows, feed rows, and profile flight lists do NOT
show endorsement counts. The naming dialog (one dialog per interaction) and the
flight page (one page per flight) are the only surfaces — this keeps list queries
unchanged and avoids cluttering compact views.

### Interaction with existing mechanisms

**`boundaryUpdatedById` (SPRINT-006).** Untouched. The audit log adds a
`boundary_set` / `boundary_clear` entry alongside it. The two agree on "who last
touched the boundary"; the audit log adds "what happened before that." If
`boundaryUpdatedById` is ever retired, the audit log is the replacement.

**SPRINT-005 decision 4 (site owner power over zones).** Unchanged. When a site
owner renames or deletes a zone under their site, the audit log records the
action with the site owner as the actor — providing the accountability the user
asked for. The contributor roster shows the site owner as a zone contributor even
though they didn't create the zone.

**Existing guards (`referencedByOthers`, `siteHasOtherOwnedZone`).** Unchanged.
These prevent a site owner from deleting a site that has community dependencies.
Endorsements do NOT affect these guards — a site with 100 endorsements is still
deletable by its owner if no other pilot's flight or zone depends on it. (The
endorsements cascade-delete with the site.)

**`Flight` model.** Completely unchanged. No new column, no new cache, no new
read-path behavior. The `lib/flights/repo.ts` firewall is not extended — it has
nothing new to guard. This is not an assumption; it's verified by
`write-audit.test.ts` passing unmodified.

**Privacy.** Audit entries, contributor rosters, and endorsement counts are
visible only for public sites/zones, to any viewer (including anonymous). A
private site's audit log is visible only to its owner. No new privacy dimension,
no change to `canSeeSite`/`canSeeZone`, no change to `siteVisibleWhere`/
`zoneVisibleWhere`.

## Implementation

Four ordered PRs. Each passes all five gates. The ordering means nothing can
display audit data before the log exists, and nothing can create endorsements
before the schema supports them.

### PR1 — Schema, audit writer, backfill (no user-visible change)

- Migration `20260823xxxxxx_community_signals`: `LocationAuditEntry`,
  `SiteEndorsement`, `ZoneEndorsement` tables with their indexes, the
  `num_nonnulls` CHECK on the audit target discriminator, the action-enum CHECK.
  Purely additive — existing rows are untouched, new tables start empty.
- Backfill step in the migration: for every `Site` and `Zone` with
  `ownerId IS NOT NULL AND visibility = 'public'`, insert a
  `LocationAuditEntry` with `action = 'create'`, `actorId = ownerId`,
  `detail = { name, visibility }`, `createdAt` matching the row's own
  `createdAt`. This makes the current owner the first contributor in the
  derived roster.
- `lib/sites/audit.ts`: `writeAuditEntry`, the `AuditAction` type, the
  `AuditTarget` type. Pure except for the Prisma insert, called with a
  transaction client so it participates in the caller's transaction.
- `lib/sites/audit.test.ts`: unit tests for audit entry creation, the CHECK
  constraint (a hand-written row with both `siteId` and `zoneId` non-null is
  refused, a row with both null is refused), and the action enum CHECK.
- **Depends on:** nothing.

### PR2 — Audit logging wired into mutations + contributor roster

- Every mutation in `lib/sites/associate.ts` (`renameSite`, `setSiteVisibility`,
  `unpublishOwnSite`, `renameZone`, `setZoneVisibility`, `unpublishOwnZone`,
  `setSiteBoundary`, `clearSiteBoundary`, `setZoneBoundary`,
  `clearZoneBoundary`) gains a `writeAuditEntry` call inside its existing
  `$transaction`, with the appropriate action and detail. The mutation's own
  behavior is byte-for-byte unchanged — the audit write is a pure addition.
- `lib/sites/repo.ts`: `createOrAttachSiteFromFlight` gains an audit entry
  (`action: 'create'`) when it creates a new site or zone, inside the existing
  create transaction.
- `lib/sites/contributors.ts`: `contributorsForSite`, `contributorsForZone` —
  the derived roster queries.
- Integration tests (`test/sites.integration.test.ts`, extended or new file
  `test/audit.integration.test.ts` using a fresh lat/lon fixture band):
  - Renaming a site produces a `rename` audit entry with `{ from, to }`.
  - Changing visibility produces a `visibility_change` entry.
  - Setting a boundary produces a `boundary_set` entry with `{ vertices }`.
  - Clearing a boundary produces a `boundary_clear` entry.
  - Creating a site produces a `create` entry.
  - The contributor roster for a site with two editors lists both, ordered by
    first contribution.
  - A pilot who only had a flight matched (not an edit) does NOT appear in the
    contributor roster.
  - The actor of an audit entry matches the caller of the mutation, including
    when a site owner renames a zone they don't own (SPRINT-005 decision 4).
  - The backfilled `create` entries from PR1 appear in the roster.
- **Depends on:** PR1.

### PR3 — Endorsements + display

- `lib/sites/endorsements.ts`: `toggleSiteEndorsement`,
  `toggleZoneEndorsement`, `siteEndorsementSummary`, `zoneEndorsementSummary`,
  `siteEndorsementCounts`, `zoneEndorsementCounts`.
- Server actions in `app/flights/[id]/endorsement-action.ts`:
  `toggleSiteEndorsementAction`, `toggleZoneEndorsementAction` — gated on
  `requireViewer`, public-row check, toggle call, revalidation.
- `components/flight/name-site-dialog.tsx`: contributors section, endorsement
  count + toggle button, "History" expandable with capped audit entries. The
  naming dialog gains a `SiteCommunityInfo` sub-component that fetches
  contributors, endorsement summary, and recent audit entries for the currently
  selected public site/zone.
- `components/flight/flight-header.tsx`: compact endorsement-count badge next to
  the site/zone name label, for public sites only.
- Site suggestion display (`suggestNearbyLocations` callers): endorsement count
  badge on each suggested site/zone.
- Integration tests:
  - Toggle endorsement on, verify count = 1 and `hasEndorsed = true`.
  - Toggle off, verify count = 0 and `hasEndorsed = false`.
  - Two pilots endorse the same site, count = 2.
  - Attempting to endorse a private site is refused.
  - Endorsing twice (P2002 race) toggles off, same as kudos.
  - `siteEndorsementCounts` batch query returns correct counts for multiple
    sites.
  - Deleting a site cascades endorsements.
  - Deleting a profile cascades that pilot's endorsements.
- **Depends on:** PR2.

### PR4 — Operator tools, E2E, release pass

- `scripts/admin-sites.ts`: `audit <siteId>` / `zone-audit <zoneId>` commands
  that print the audit log for a row, most recent first.
- `test/e2e/community.spec.ts`: (a) upload a flight → name the site public →
  see yourself as the sole contributor → another pilot endorses →
  endorsement count shows 1 on both pilots' views; (b) rename the site → the
  "History" section shows the rename entry with the old and new names.
- `lib/whats-new.ts` entry (top, newest first): "See who shaped a site — every
  public site and zone now shows its contributors, edit history, and how many
  pilots have endorsed it."
- `FEATURES.md`: "Community-Owned Public Sites & Zones" entry moved/updated to
  note v1 shipped (roster, audit, endorsements) and edit-control broadening
  deferred.
- `docs/architecture.md`: short paragraph on the audit log and endorsement
  pattern.
- **Depends on:** PR3.

## Files Summary

**New:** `lib/sites/audit.ts` (+`audit.test.ts`), `lib/sites/contributors.ts`,
`lib/sites/endorsements.ts` (+`endorsements.test.ts`),
`app/flights/[id]/endorsement-action.ts`,
`prisma/migrations/20260823xxxxxx_community_signals/`,
`test/audit.integration.test.ts` (or extension of
`test/sites.integration.test.ts`), `test/e2e/community.spec.ts`.

**Modified:** `prisma/schema.prisma` (`LocationAuditEntry`, `SiteEndorsement`,
`ZoneEndorsement` models; relation fields on `Site`, `Zone`, `Profile`),
`lib/sites/associate.ts` (audit-entry writes inside existing transactions),
`lib/sites/repo.ts` (audit entry on site/zone create),
`components/flight/name-site-dialog.tsx` (contributors, endorsements, history
display), `components/flight/flight-header.tsx` (endorsement count badge),
`scripts/admin-sites.ts` (audit query commands), `lib/whats-new.ts`,
`FEATURES.md`, `docs/architecture.md`.

**Unchanged on purpose:** `lib/flights/repo.ts` (the read-path firewall has
nothing new to guard — no new `Flight` column, no new cache, no new visibility
dimension), `lib/sites/visibility.ts` (endorsements and audit entries are not
privacy dimensions), `lib/sites/lookup.ts` (matching is unchanged),
`lib/sites/boundary.ts` (boundary validation is unchanged),
`lib/sites/display.ts` (`formatLocationLabel` is unchanged), `lib/sites/geo.ts`,
`lib/ingest/ingest-flight.ts` (the ingest seam is unaffected),
`app/api/upload/route.ts`, `app/api/ingest/route.ts`,
`lib/sites/write-audit.test.ts` (no new `Flight` cache writer — the audit
writes target `LocationAuditEntry`, not `Flight` columns),
`scripts/backfill-sites.ts`, `prisma/seed.ts`.

## Definition of Done

- [ ] `LocationAuditEntry` exists with `siteId`/`zoneId` (exactly one non-null,
      enforced by a `num_nonnulls` CHECK), `actorId` (`SetNull` on profile
      delete), `action` (CHECK-constrained enum), `detail` (`Json?`),
      `createdAt`; indexed on `(siteId, createdAt)`, `(zoneId, createdAt)`,
      `actorId`; Prisma-v6 drift documented.
- [ ] `SiteEndorsement` and `ZoneEndorsement` exist with composite PKs
      (`[siteId, profileId]`, `[zoneId, profileId]`), `onDelete: Cascade` on
      both FKs, indexed on `(siteId/zoneId, createdAt)`.
- [ ] Every existing public `Site`/`Zone` with a non-null `ownerId` has a
      backfilled `create` audit entry dated at the row's own `createdAt`.
- [ ] Every consequential mutation — create, rename, visibility change, boundary
      set, boundary clear — writes a `LocationAuditEntry` inside its existing
      transaction, with the acting pilot as `actorId` and action-specific
      `detail`.
- [ ] The mutation's own behavior is unchanged — audit writes are a pure
      addition; every pre-existing test in `test/sites.integration.test.ts`
      passes unmodified.
- [ ] The contributor roster for a site/zone is derived from the audit log
      (`DISTINCT actorId`) and includes every pilot who has created, renamed,
      changed visibility on, or set/cleared a boundary for that row.
- [ ] A pilot whose flight was auto-matched to a site (but who never made a
      deliberate edit) does NOT appear in the contributor roster.
- [ ] When a site owner renames a zone under their site (SPRINT-005 decision 4),
      the audit entry's `actorId` is the site owner, and the site owner appears
      in the zone's contributor roster.
- [ ] `toggleSiteEndorsement` / `toggleZoneEndorsement` toggle exactly like
      `toggleKudo`: create on first call, delete on second, with P2002 race
      handling.
- [ ] Endorsements are restricted to public sites/zones; attempting to endorse a
      private row is refused.
- [ ] One endorsement per user per row is enforced by the composite PK — no
      double-voting.
- [ ] Contributors CAN endorse sites/zones they contributed to (no
      self-restriction).
- [ ] `siteEndorsementCounts` / `zoneEndorsementCounts` batch queries return
      correct counts, following the `kudoCountsFor` `groupBy` pattern.
- [ ] Deleting a site cascades its audit entries and endorsements; deleting a
      zone cascades its audit entries and endorsements; deleting a profile
      `SetNull`s `actorId` on audit entries and cascades endorsements.
- [ ] The naming dialog shows, for public sites/zones: contributors (ordered by
      first contribution, creator labelled), endorsement count + toggle button
      (signed-in only), and a "History" section with recent audit entries.
- [ ] The flight header shows a compact endorsement count badge for public
      sites/zones; list views do NOT show endorsement counts.
- [ ] Anonymous viewers see endorsement counts and contributor lists for public
      rows; they see no toggle button.
- [ ] Private sites/zones show no community signals (no contributors, no
      endorsements, no history) to anyone but the owner.
- [ ] `Flight` has **no** new column, and `lib/sites/write-audit.test.ts` passes
      unmodified.
- [ ] `scripts/admin-sites.ts` gains `audit <siteId>` / `zone-audit <zoneId>`
      commands.
- [ ] E2E covers: name a site → see yourself as contributor → another pilot
      endorses → endorsement count visible; rename → history shows the change.
- [ ] All five gates green; `/whats-new` entry added; `FEATURES.md` updated;
      `docs/architecture.md` documents the audit log and endorsement pattern.
- [ ] Deferred items **not** shipped: edit-control broadening to contributors,
      `ownerId` removal/reinterpretation, denormalized endorsement count,
      endorsement-weighted ranking, operator-action audit logging, flight-matched
      signal, notifications.

## Risks

- **Scope creep from "community owned" into edit-control changes (highest
  scope risk).** The user's seed says "NOT owned by one user," which could be
  read as requiring an edit-control change. *Mitigation and explicit decision:*
  this sprint adds visibility (roster, audit, endorsements) without changing
  edit-control. The intent document's own uncertainty assessment calls scope
  uncertainty "High" and suggests the additive parts ship first. A follow-up
  sprint for edit-control broadening is the explicit plan, not a deferral of
  the whole feature.

- **The audit log grows without bound.** Every mutation appends a row; at scale,
  a frequently-edited site could accumulate thousands of entries. *Mitigation:*
  at the expected scale (a few dozen edits per site, ever), this is negligible.
  The display caps at 20 entries (most recent). If real usage shows growth,
  `PARTITION BY RANGE (createdAt)` or a retention policy is straightforward —
  and the schema supports it because `createdAt` is indexed.

- **The contributor roster query is slower than a materialized table.** Deriving
  from the audit log requires a `GROUP BY actorId` with a `JOIN` to `Profile`.
  *Mitigation:* the audit log for a single site is expected to have O(10)
  entries, making this query trivially fast. If performance degrades at scale,
  a materialized `SiteContributor` table is an additive migration — the derived
  approach is the simpler starting point, not a permanent commitment.

- **Endorsement spam from many accounts.** A motivated actor could create
  multiple pilot accounts to inflate endorsement counts. *Mitigation:*
  onboarded pilots only (creating an account requires a magic-link email),
  one-per-user-per-row (composite PK), and endorsement counts are display-only
  (no ranking effect), so the incentive is low. If this becomes a real problem,
  a minimum-flight-count prerequisite for endorsing is an additive guard.

- **Audit entries for boundary changes duplicate `boundaryUpdatedById`.**
  *Accepted and documented:* the two run in parallel, answering different
  questions at different speeds. The audit log supplements but does not replace
  the column. Retiring `boundaryUpdatedById` is a future cleanup.

- **The naming dialog gets too complex.** SPRINT-005 added the two-step flow,
  SPRINT-006 added boundary editing, and this sprint adds contributors +
  endorsements + history. *Mitigation:* the community signals are display-only
  additions (not new input flows), collapsed by default ("History" is
  expandable), and appear only for public rows. The dialog's interaction model
  (name → zone → boundary) is unchanged.

- **The backfill creates misleading audit entries.** A `create` entry dated at
  the site's `createdAt` implies the current `ownerId` was the creator, which
  is true — but it implies nothing else happened before, which might not be
  true (pre-audit renames are invisible). *Accepted:* the backfill is honest
  about what it knows (the creator, the creation date) and honest about what it
  doesn't (pre-migration edits). The alternative — no backfill — leaves every
  existing site with zero contributors, which is strictly worse.

- **Rollback.** PR1 is purely additive (new tables, no code change). PR2 adds
  audit calls inside existing transactions — reverting removes the calls and
  restores the exact pre-sprint behavior. PR3 adds new UI and a new toggle
  action — reverting removes them. PR4 is polish. At no point does a revert
  change matching, display names, or privacy behavior. The new tables can be
  dropped cleanly if the feature is abandoned.

## Security (privacy / authz)

- **Invariant 1 (unchanged, and verified):** every SPRINT-004/005/006 privacy
  invariant is untouched. `canSeeSite`, `canSeeZone`, `siteVisibleWhere`,
  `zoneVisibleWhere`, `resolveLocationFields`, `resolveEndpoint`,
  `locationCachePatch`, and the eight `Flight` cache columns are all
  byte-for-byte unmodified. The existing privacy matrix tests pass unmodified.

- **Invariant 2 (new):** audit entries, contributor rosters, and endorsement
  counts are visible only where the underlying site/zone is visible. A private
  site's audit log is visible only to its owner. The check is against
  `canSeeSite`/`canSeeZone` before returning any community signal — the same
  gate, not a parallel one.

- **Invariant 3 (new):** endorsement toggle is gated on: signed-in pilot,
  public row (own `visibility`, not effective visibility), and the composite PK
  prevents double-voting. No endorsement action ever writes to a `Flight`
  column.

- **Mutations gated by reads, as always:** `toggleSiteEndorsement` verifies the
  site exists and is public before toggling. `toggleZoneEndorsement` does the
  same for a zone. Hidden and nonexistent rows are indistinguishable in the
  error. Audit writes happen inside existing owner-gated transactions — no new
  authorization path.

- **No new `Flight` column, no new cache, no new visibility dimension.**
  Endorsed ≠ visible. A site with zero endorsements is just as visible as one
  with 100. The endorsement count is informational metadata, not a privacy
  gate.

- **Untrusted input.** The endorsement toggle has no user-supplied payload
  beyond the row id (re-verified). The audit writer only accepts structured
  `AuditAction` values, never a client-supplied action string.

- **Abuse:** signed-in, onboarded pilots only for endorsements. Audit log is
  append-only — no pilot can edit or delete an entry. No new row-creation
  vector, so `DAILY_CREATE_CAP` is not extended.

## Dependencies

- **Internal:** PR2 ⟵ PR1; PR3 ⟵ PR2; PR4 ⟵ PR3. Strictly sequential — nothing
  can display audit data before the log exists, and nothing can create
  endorsements before the schema supports them.
- **External/stack: none new.** No npm packages, no services. Prisma v6
  (pinned), NextAuth v5, Next 16, Postgres on Railway, existing
  `components/ui/*`. CI's Postgres service already exists.
- **Data:** production has a low-double-digit number of public sites and zones,
  all with a single `ownerId`. The backfill seeds one `create` audit entry per
  public row. No schema change to existing tables — only new tables and new
  relation fields on `Site`, `Zone`, `Profile`.
- **Test data:** the existing ≥3-pilot fixtures suffice. New tests need
  disjoint lat/lon fixture bands (the existing SPRINT-005/006 lesson) if adding
  a new integration test file.

## Open Questions

Answered here as committed decisions; revisit only if the product changes.

1. **Does "community owned" change edit-control in v1?** — **No.** `ownerId`
   stays, with its current meaning. The site owner's power over child zones
   (SPRINT-005 decision 4) is unchanged. This sprint adds *visibility into* how
   those powers have been used (roster, audit, endorsements), building the
   infrastructure a future edit-control broadening sprint would need. The intent
   document's own open question 8 asks whether this should be one sprint or two
   — this draft answers: two, with the additive signals first.

2. **What makes someone a "contributor"?** — **A deliberate edit: create,
   rename, visibility change, or boundary set/clear.** Not having a flight
   matched there (that's automatic and would flood the roster). The roster is
   derived from the audit log, not separately maintained, so the definition is
   exactly "appears in the audit log for this row."

3. **What does the audit log cover in v1?** — **Create, rename,
   visibility_change, boundary_set, boundary_clear.** These are the five
   consequential site/zone mutations. Delete is not logged (the cascade would
   immediately remove the entry). Operator actions are not logged (operators
   have their own structured console output). Both are addressable follow-ups.

4. **Upvote mechanics — one per user, toggle, self-endorsement?** — **One per
   user per row (composite PK), toggled on/off (like kudos), and contributors
   CAN endorse their own row.** The endorsement is "this place is legit," not
   "nice work" — the creator thinks their own creation is legit by definition.
   The count is a pure display signal with no ranking effect in v1.

5. **How do existing public sites/zones transition?** — **The current `ownerId`
   becomes the first contributor via a backfill that creates a `create` audit
   entry dated at the row's own `createdAt`.** Endorsement count starts at zero.
   No data loss, no behavior change, no manual fixup.

6. **Does `ownerId` stay on the row?** — **Yes, unchanged.** It drives
   edit-control gates, zone undo guards, cascade semantics, and
   `admin-sites.ts`'s merge logic. Reinterpreting it as "original creator" or
   removing it belongs in the follow-up edit-control sprint, not this one.

7. **How does this interact with SPRINT-005 decision 4 and
   `admin-sites.ts`?** — **Transparently.** The site owner's moderation power
   over child zones is unchanged; the audit log now records when they use it.
   `admin-sites.ts` gains audit-query commands but its merge/force-merge logic
   is unaffected.

8. **One sprint or two?** — **Two. This sprint ships the additive signals
   (roster, audit, endorsements). The edit-control broadening ("any contributor
   can edit a public site") is a follow-up sprint** that can build on the
   infrastructure this one establishes. Shipping them together risks a
   half-baked permission model alongside three new tables.

**Genuinely still open** (not blocking, deliberately unanswered):

- Should a future edit-control sprint allow **any contributor** or **any
  signed-in pilot** to edit a public site/zone? The roster makes "any
  contributor" possible; the question is product policy, not engineering.
- Should endorsements ever affect **ranking or matching** (e.g., an endorsed
  site wins a tie with an unendorsed one at the same distance)? Needs real
  endorsement data first — premature coupling of a social signal to a
  correctness-critical path.
- Should the audit log eventually cover **deletes**? It requires a
  non-cascading archive strategy (a separate `DeletedLocationAuditEntry` table,
  or `onDelete: SetNull` instead of `Cascade`, or logging the delete in a
  separate table before the cascade fires). Worth designing, not worth blocking
  this sprint on.
- Should there be **notifications** for audit events ("someone edited your
  site") or endorsements ("your site got endorsed")? A useful follow-up once
  a notification system exists.
- Should the contributor roster eventually include a **"has flown here"** signal
  (distinct from "has edited this")? It's a richer, noisier signal that needs
  its own privacy design (does a private flight at a public site make you a
  "has flown here" contributor?).
