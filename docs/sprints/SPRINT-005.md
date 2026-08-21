# SPRINT-005 — Two-level site hierarchy: Site + Zone

> Produced by the multi-agent sprint-planning workflow
> (`consensus(opus, gpt-5.5)` + cross-critique + interview). Drafts, critiques,
> and merge notes are in [`drafts/`](./drafts/). Intent:
> [`drafts/SPRINT-005-INTENT.md`](./drafts/SPRINT-005-INTENT.md).

## Overview

SPRINT-004 gave pilots a flat gazetteer: one `Site` row per named place, matched by
proximity. Real flying sites don't work that way. "Mission Ridge" is one place a pilot
names and talks about, but it has a North Launch, a South Bowl, and a Lower LZ — three
distinct spots, sometimes hundreds of meters apart, that a flat model either collapses
into one imprecise name or shatters into three unrelated sites that never appear as
siblings.

This sprint adds the second level: a `Zone` — a specific launch or landing spot — that
belongs to exactly one `Site`. A flight matches the nearest zone first and displays the
roll-up, **"Mission Ridge — North Launch."** When no zone is close enough — or the site
has none at all — it matches the site and displays **"Mission Ridge,"** exactly as
today.

Four decisions anchor the sprint:

1. **A bare site is a first-class, permanent state — not a migration artifact.** Every
   site SPRINT-004 can create today is zoneless, and every one of them keeps matching,
   displaying, and re-associating with **zero** behavioural change. Zones are an
   *optional refinement a pilot opts into*, never a required second step. This is why
   the flight FK keeps pointing at `Site` and gains an **optional** parallel `Zone` FK
   (decision 2) rather than being repointed at `Zone`: repointing would make "no zone"
   unrepresentable and turn today's entire dataset into a special case.

2. **`Flight` gains a second, subordinate cache pair per endpoint; the site pair keeps
   its exact SPRINT-004 meaning.** `takeoffSiteId`/`takeoffSiteName` are untouched.
   `takeoffZoneId`/`takeoffZoneName` are added alongside, under a hard invariant:
   **`zoneId non-null ⇒ siteId non-null AND zone.siteId = flight.siteId`** — the parent
   is denormalized onto the flight row. That single invariant is what lets the whole
   SPRINT-004 apparatus survive intact: `statsFrom`'s distinct-site count is unchanged,
   the undo guard still only has to look at two site columns for flight references, the
   privacy matrix is *extended* rather than rewritten, and deleting a zone never orphans
   a flight's site binding.

3. **Zone visibility is its own column, and effective visibility is the conjunction
   with its parent's.** A zone is readable iff `canSeeSite(site, viewer) AND
   canSeeZone(zone, viewer)`. A private zone under a public site is a real, useful
   thing — it's the case that motivated this sprint: *"everyone knows Mission Ridge; my
   launch spot is mine."* A *public zone under a private site* is incoherent — the
   roll-up display requires the parent's name, so publishing the child would leak the
   parent. **This combination is refused at the point a pilot tries to create it** (a
   validation rule, never a database constraint — see
   [Architecture § Effective visibility](#effective-visibility--the-conjunction-rule)
   for why a cross-table constraint here would fight a legitimate lifecycle), and it is
   independently neutralized by the read-path conjunction if it's ever reached anyway
   (a hand-written row, a future bug). Two independent layers, on purpose — the
   SPRINT-004 lesson was that the read path must be safe even when the row is wrong.

4. **Site ownership grants moderation power over the site's own zones.** A pilot may
   add a zone to *another* pilot's public site — that's how one shared site's map of
   spots grows past its original namer. But once a stranger's zone sits under your
   site, only you (as the zone's own creator) or an operator could previously fix it.
   This sprint extends the site owner's existing override — they can already demote or
   delete the *whole* site — one level down: **the site's owner may rename or delete
   any zone under their own site**, in addition to the zone's own creator's undo. This
   is new pilot-over-pilot power beyond SPRINT-004's deliberate no-moderation stance —
   a discussed, scoped exception, not a drift from it: it grants no capability the site
   owner didn't already have in aggregate (wholesale demotion), only finer granularity.

**Committed v1 scope**

1. `Zone` model — required `siteId` (`onDelete: Cascade`), own `ownerId` + `visibility`
   (independent, no column default) + `normalizedName` + `kind` + `lat`/`lon`; a
   **public-only** partial unique index on `(siteId, normalizedName)`. `Flight` gains
   four nullable zone columns and two indexes.
2. **Zone-first matching with site fallback** in one source-agnostic pass
   (`findLocation`), at a tighter zone radius (300 m / 400 m) than the site radius
   (600 m / 900 m, unchanged), with the site pass **always** running as a fallback —
   whether or not the winning site has zones. Web upload and device push inherit it
   through the ingest seam with no route changes.
3. The read-path firewall extended to two levels: `resolveLocationFields` re-verifies
   every non-null site id **and** zone id per viewer, enforces the conjunction, and
   strips the zone whenever the parent isn't readable — plus a pure
   `formatLocationLabel` for the "Site — Zone" roll-up.
4. **"Name this site" becomes progressively two-step**: pick/create a site (unchanged
   first step), then an *optional* "Which spot?" step to pick/create a zone under it.
   Reuse-first dedup at both levels.
5. Creator undo and operator remedy extended to zones, plus the new site-owner override
   (decision 4); deleting the last zone under a site leaves a working bare site;
   deleting a site is refused while it has zones owned by another pilot.

**Explicitly out of scope** (with reasons)

- **Three or more levels, or zones-under-zones.** Two levels covers every site a pilot
  has described. A recursive tree multiplies the visibility conjunction by depth and
  has no success criterion behind it.
- **Per-zone match radius as a column.** Tempting for a site with two launches 250 m
  apart, but it puts pilot-editable data on the matching hot path and invites a zone
  whose radius swallows its sibling. Fixed constants now; revisit with real collision
  data.
- **A denormalized `Site.hasZones` / `zoneCount` flag.** It would save no query — the
  zone pass is an indexed bbox query that returns empty precisely when no zone is near,
  and knowing zones exist somewhere under the site doesn't tell you whether one is *in
  range* — and it adds an invalidation obligation on every zone write. Derived from the
  relation when a count is genuinely needed (the operator `list` command).
- **Moving a zone between sites (reparenting) in the pilot UI.** No moderation model
  exists beyond decision 4's scoped exception. `scripts/admin-sites.ts` gets an
  operator-side `zone-merge`; there is no user-facing reparenting.
- **Zone pages, browse, search, maps, `/sites/<id>` or `/zones/<id>` URLs.** No site or
  zone id ever appears in a URL — the existing "only `Flight` is URL-visible" policy
  stays closed.
- **`Profile.homeSiteId` / a `homeZoneId`.** Still dormant, still needs its own privacy
  design (unchanged since SPRINT-004).
- **Coordinate refinement (zone centroid from bound flights), wind-direction/aspect
  metadata on zones, gazetteer import, launch-coordinate obfuscation.** Each is its own
  small sprint; none is load-bearing here.

## Use Cases

1. **Add a spot to a site you already named.** A pilot opens a flight reading "Mission
   Ridge," taps it, and the dialog now offers a second step: *Which spot?* — with **Add
   a spot** and a name field. They type "North Launch." The headline becomes
   **"Mission Ridge — North Launch"** without leaving the page.
2. **Name a brand-new place, no zone.** Unchanged from SPRINT-004 in every visible way:
   a pilot names "Sonoma Ridge," saves, and is done. The zone step is present, optional,
   and skippable in one click. A bare site is the default outcome of the create path.
3. **Reuse a sibling zone.** A second pilot lands near the same launch. The dialog shows
   "Mission Ridge" with its visible zones nested under it — "North Launch — 180 m NE,"
   "South Bowl — 610 m S" — each with **Use this spot**. Reuse binds and creates
   nothing.
4. **A later flight names itself two levels deep.** The pilot uploads (or their Leaf
   pushes) another flight from North Launch; ingest matches the zone and the flight
   reads "Mission Ridge — North Launch" on arrival. Identical on both paths.
5. **Off the known spots, still at the known site.** A pilot launches from an unnamed
   knoll 500 m from North Launch. No zone is within 300 m, but the *site* is within
   600 m: the flight reads "Mission Ridge." No dead end, no "Unknown site" — and this is
   true whether Mission Ridge has zero zones or five; the site pass never excludes
   itself just because zones exist somewhere under it.
6. **A private spot under a public site.** A pilot adds "Back Bowl" as a private zone
   under public Mission Ridge. Every other viewer of that flight — friend, stranger,
   anonymous — sees **"Mission Ridge,"** never the zone name. The owner sees both.
7. **Takeoff and landing disagree.** Launch matches a zone under Mission Ridge; landing
   matches a *different* zone under the same site (renders "Mission Ridge — Lower LZ"),
   or a zone under a different site entirely, or no zone at all. All four combinations
   are independent per endpoint; nothing couples them.
8. **A pilot's own back-catalog catches up.** A pilot has been flying Mission Ridge for
   months; every one of those flights is bound to the bare site (`takeoffSiteId` set,
   `takeoffZoneId` null). They finally name "North Launch." Every one of their own
   *already site-bound* flights that actually launched within the new zone's radius
   upgrades to "Mission Ridge — North Launch" — not only the ones that were previously
   unmatched. This is the split-logbook problem the sprint exists to solve, and it must
   not survive the sprint that solves it.
9. **A zone under someone else's site.** A pilot lands somewhere new at a site another
   pilot already named and public. They add "East Ridge LZ" as a zone under that site.
   The site's owner didn't create it, but it's now visible to everyone the site is
   visible to.
10. **Undo a spot without losing the site.** The creator deletes "North Launch." Their
    flights fall back to "Mission Ridge" — the site binding was never touched. Deleting
    the *last* zone leaves a fully functional bare site.
11. **Undo a spot you no longer own — two remedies now, not one.** Once another pilot's
    flight is bound to a zone, the creator's own delete affordance disappears. But if
    the zone sits under *your* site, you (the site owner) can still rename or remove it
    — you didn't create it, but you own the place it's attached to. If neither applies,
    it's the same operator remedy as SPRINT-004.

## Architecture

### Data model

```prisma
model Zone {
  id             String   @id @default(cuid())
  siteId         String                          // REQUIRED — a zone cannot exist alone
  site           Site     @relation("SiteZones", fields: [siteId], references: [id], onDelete: Cascade)
  name           String
  normalizedName String                          // NFKC + folded
  kind           String   @default("unknown")    // takeoff | landing | both | unknown
  lat            Float
  lon            Float
  ownerId        String?                         // nullable for the same SetNull reason as Site
  owner          Profile? @relation("OwnedZones", fields: [ownerId], references: [id], onDelete: SetNull)
  visibility     String                          // private | public — NO column default
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  takeoffFlights Flight[] @relation("TakeoffZone")
  landingFlights Flight[] @relation("LandingZone")

  @@index([lat, lon])                            // the zone-pass bbox prefilter
  @@index([siteId])
  @@index([ownerId])
  // NOTE: no @@unique here — the real uniqueness is a partial index, below.
}

model Site {
  // ...unchanged... plus:
  zones Zone[] @relation("SiteZones")
}

model Flight {
  // ...unchanged, INCLUDING takeoff/landingSiteId + takeoff/landingSiteName... plus:
  takeoffZoneId   String?
  takeoffZone     Zone?   @relation("TakeoffZone", fields: [takeoffZoneId], references: [id], onDelete: SetNull)
  takeoffZoneName String?                        // public-name cache, same contract as SiteName
  landingZoneId   String?
  landingZone     Zone?   @relation("LandingZone", fields: [landingZoneId], references: [id], onDelete: SetNull)
  landingZoneName String?

  @@index([takeoffZoneId])
  @@index([landingZoneId])
}
```

**Raw SQL appended to the hand-written migration** (Prisma v6 cannot express CHECK or
partial indexes; the resulting `migrate diff` drift is expected and documented, per the
SPRINT-003/004 precedent):

```sql
ALTER TABLE "Zone" ADD CONSTRAINT "zone_visibility_check"
  CHECK ("visibility" IN ('private','public'));
ALTER TABLE "Zone" ADD CONSTRAINT "zone_kind_check"
  CHECK ("kind" IN ('takeoff','landing','both','unknown'));

-- Sibling-name uniqueness applies ONLY to public zones. A private zone must never
-- be able to block — or, via the P2002 conflict, reveal the existence of — a public
-- zone with the same name under the same site. Two private zones (or a private and
-- a not-yet-public zone) with the same sibling name are a data-quality nit, not a
-- correctness issue — the same posture SPRINT-004 took on site-name duplicates.
CREATE UNIQUE INDEX "zone_public_sibling_name_unique"
  ON "Zone" ("siteId", "normalizedName")
  WHERE "visibility" = 'public';
```

**Why a partial index, not `@@unique([siteId, normalizedName])`.** An early version of
this design used a plain unique key. It fails a real case: a pilot creates a private
"North Launch" under public Mission Ridge; a second pilot then tries to create a
*public* "North Launch" and gets an opaque conflict — either it silently reuses a zone
they can't see (a leak: it proves a hidden zone exists) or it refuses with no visible
cause (confusing, and still implicitly reveals something). Scoping the index to
`visibility = 'public'` makes the hard, cheap, `P2002`-based concurrency guarantee
available exactly where it's safe — among rows everyone can already see — and private
zone creation falls back to the same in-transaction re-probe SPRINT-004 already uses
for site names (visible-candidates-only, so it can never leak a private row's
existence either).

**`onDelete: Cascade` on `Zone.siteId`, `SetNull` on the two `Flight` zone FKs.**
Deleting a site removes its zones (satisfying "a zone belongs to exactly one site" as a
DB-level truth), which in turn nulls the zone ids on referencing flights while the
cached zone names survive as history — exactly the site-level semantics, one level
down. (Site deletion is now additionally guarded against zones owned by other pilots —
see [Undo and operator remedy](#undo-and-operator-remedy).)

**`visibility` has no column default on `Zone`,** for the same reason as `Site`: Prisma
then requires it on every `zone.create`, so forgetfulness is a loud failure rather than
a silent publish.

**No `Flight`-side `zoneId ⇒ siteId` CHECK, despite it being a genuine single-row
invariant, and despite a composite-FK alternative existing.** `@@unique([id, siteId])`
on `Zone` plus a composite FK `Flight(takeoffZoneId, takeoffSiteId) → Zone(id, siteId)`
*can* express this in Postgres and Prisma 6 can declare it — but its `onDelete: SetNull`
would null **both** `Flight` columns together, so deleting a zone would also detach the
flight's site binding, contradicting "deleting a zone leaves a working bare site."
Separately, deleting a `Site` fires two referential actions against the same `Flight`
row — `CASCADE` to `Zone` (which then `SET NULL`s the zone id) and `SET NULL` on the
site id — and this isn't just a theoretical ordering risk: letting Postgres run both as
native cascades **empirically raises a `Flight_takeoffZoneId_fkey` violation** on a
flight bound to both levels. A non-deferrable `CHECK` on top of that would only add a
second way for the same delete to fail. This is the same class of reasoning that made
SPRINT-004 reject the "private ⇒ owned" CHECK: *a constraint that fights the schema's
own cascade behaviour costs more than it protects.* The invariant is enforced instead at
the application layer — the single cache writer physically cannot emit a zone id
without its site id (they are produced by one function from one resolved pair) — and
asserted by an integration test that hand-writes the violating row and proves the read
path strips it anyway. `deleteSite` itself works around the cascade-ordering failure by
explicitly nulling every flight's `*ZoneId`/`*ZoneName` for zones under the site
*before* deleting it, so the native zone cascade has nothing left to touch (see
[Undo and operator remedy](#undo-and-operator-remedy) and the matching Risks entry).

**No CHECK on the cached-name columns either,** for the reason SPRINT-004 already
established: all combinations of `(id, name)` are legitimately reachable, so no
single-row CHECK can distinguish valid from invalid.

### Effective visibility — the conjunction rule

`lib/sites/visibility.ts` gains one function; `canSeeSite` is untouched.

```ts
/**
 * A zone is readable only if BOTH it and its parent site are readable by the
 * viewer. The parent gate is not redundant: the roll-up label renders the
 * parent's name, so a readable zone under an unreadable site would leak the
 * site. Fail-closed on a missing/mismatched parent.
 */
export function canSeeZone(
  zone: { visibility: SiteVisibility; ownerId: string | null; siteId: string },
  site: { id: string; visibility: SiteVisibility; ownerId: string | null } | null,
  viewerId: string | null,
): boolean {
  if (!site || site.id !== zone.siteId) return false;               // orphan / mismatch
  if (!canSeeSite(site.visibility, site.ownerId, viewerId)) return false;
  return canSeeSite(zone.visibility, zone.ownerId, viewerId);
}
```

The `site.id !== zone.siteId` branch is not paranoia theatre: it is what makes a stale
or hand-written `Flight` row carrying a zone id from a *different* site fail closed
rather than render a mismatched roll-up.

**"Public zone under private site" — one rule, stated once.** This combination is
refused **only** at the point a pilot tries to *create* it (`create_zone` validation:
`visibility: "public"` is rejected when the parent site is currently private, with
steer copy — "publish Mission Ridge first, or keep this spot private"). It is
deliberately **not** a database constraint, and demoting a site to private **does not**
touch its zones' own `visibility` column — only the flight cache columns are nulled
(below). Two consequences follow, both intentional: a zone that was public before its
parent's temporary demotion silently becomes fully effective-public again the moment
the site is re-promoted, with no separate re-toggle needed; and if such a row is ever
reached anyway (a demote/re-promote race, a hand-written row, a future bug reachable
some other way), `canSeeZone`'s conjunction neutralizes it at read time regardless of
what the zone's own column says. The create-time refusal and the read-time conjunction
are two independent layers on purpose, not two descriptions of one mechanism.

### Matching — zone first, site fallback, one round trip

`lib/sites/geo.ts` gains the zone radii; the site radii are unchanged.

```ts
export const ZONE_TAKEOFF_RADIUS_M = 300;
export const ZONE_LANDING_RADIUS_M = 400;
export function zoneRadiusForKind(kind: MatchKind): number;
```

**Why tighter.** The site radius answers "which named place is this?"; the zone radius
answers "which of these adjacent spots is this?" A 600 m zone radius would let North
Launch claim a fix that plainly belongs to South Bowl 500 m away. 300 m / 400 m is
roughly half the site radius, keeping the same takeoff/landing asymmetry (landings
scatter more than launches). Both are exported constants with boundary tests, not magic
numbers.

`lib/sites/lookup.ts` — `findSite` is **replaced** by `findLocation`, which returns the
resolved pair. The old name goes away so every call site is a compile error, exactly as
SPRINT-004 did with `viewerId`.

```ts
export interface LocationMatch {
  site: SiteMatch;                 // as today: id, name, visibility, ownerId, kind, distanceM
  zone: ZoneMatch | null;          // + siteId
}

export async function findLocation(
  db: Pick<Db, "site" | "zone">,
  options: FindSiteOptions,        // { lat, lon, kind, viewerId } — unchanged shape
): Promise<LocationMatch | null>;
```

Algorithm:

1. Issue **both** bbox prefilters concurrently (`Promise.all`) — zones at the zone
   radius, sites at the site radius. Each carries its own visibility predicate; the
   zone query joins its parent (`site: { select: { id, name, visibility, ownerId,
   kind } }`) so the conjunction is evaluable without a second round trip.
2. Rank zones by exact haversine, filter to `distanceM <= zoneRadius`, drop any failing
   `canSeeZone(zone, zone.site, viewerId)` or `kindMatches`, sort with
   `compareSiteCandidates` (distance → id). **If a zone wins, return it with its parent
   site** — regardless of whether that parent also won the site pass, and regardless of
   the parent's own distance (the zone is the more precise fix by construction).
3. **Otherwise fall back to the existing site pass, unchanged: rank, filter to the site
   radius, sort, take the winner. This fallback runs whether or not the winning site
   has zones** — a site with three zones still matches a flight 500 m from its centre.
   The intent's "site with no zones" case is the degenerate instance of a rule that
   always applies, not a special path a future change could forget to run. (An earlier
   design considered excluding a site from fallback the moment it had *any*
   endpoint-compatible zone; rejected — it regresses "no dead ends" the instant a
   second pilot names one spot at an already-flown site, which is worse than
   SPRINT-004's behavior, not an improvement on it.)
4. Return `null` when both passes are empty — honest "Unknown site," as today.

The zone pass costs one extra indexed bbox query per endpoint on ingest. It runs in
parallel with the site pass, so the added wall-clock is ~0; the added load is two
queries per ingested flight, on a path that already does a parse, a derive, and a
transaction.

`ingestFlight` keeps `viewerId: ownerId` (write-time scope) and both routes
(`app/api/upload/route.ts`, `app/api/ingest/route.ts`) stay **untouched** — the seam
absorbs the change, so device push gets zone matching for free.

### The read path (strict, two levels)

`lib/flights/repo.ts` remains the only display-read gate. `resolveSiteFields` becomes
`resolveLocationFields`, and gains a second id-verification query. **Every list-returning
function routes through it, with no exceptions** — including `listOwnFlightsByIds`
(`lib/flights/repo.ts:287-296`), which SPRINT-004 left calling raw `LIST_SELECT`
directly. It's owner-scoped so today it isn't a leak, but adding zone columns to
`LIST_SELECT` widens an already-unresolved path, and this sprint's DoD claims "every
display read" without carve-outs.

```
resolveLocationFields(rows, viewerId):
  siteIds ← every non-null takeoff/landingSiteId on the page
  zoneIds ← every non-null takeoff/landingZoneId on the page
  sites ← SELECT id,name,visibility,ownerId FROM Site WHERE id IN (siteIds)
  zones ← SELECT id,name,visibility,ownerId,siteId FROM Zone WHERE id IN (zoneIds)
          (union the zones' parent ids into the Site fetch — a zone id can appear
           on a row whose site id was already stripped upstream in a bad row)
  per row, per endpoint:
    site visible?        → siteName = site.name (Site row WINS)
    site NOT visible     → siteId = null, siteName = null,
                           AND zoneId = null, zoneName = null   ← the conjunction
    siteId null          → keep the cached siteName only (historical fallback);
                           zoneName is NEVER read from cache here (see below)
    zone visible AND zone.siteId === resolved siteId
                         → zoneName = zone.name
    zone otherwise       → zoneId = null, zoneName = null
```

Three properties worth naming:

- **Stripping the parent always strips the child.** There is no code path in which a
  zone name survives a hidden site — it is a single early return, not a condition
  repeated at each call site.
- **Every id is verified, never just the ones with null names** — SPRINT-004's central
  choice, now applied to a second column pair. The cheaper "only resolve when the cache
  is empty" variant would let a hand-written `{takeoffZoneId: <private>, takeoffZoneName:
  "Secret Bowl"}` sail through.
- **The cached `*ZoneName` is historical fallback *only* for a deleted site, never for a
  deleted zone.** SPRINT-004's cache exists so an old flight doesn't lose all context
  when a whole *site* is gone. A deleted *zone* under a still-live site is different: the
  spot no longer exists as a named place, so `deleteZone` explicitly nulls the cached
  zone name (not only the id via `SetNull`) — see
  [Writing the cache](#writing-the-cache). This closes the one hybrid state an earlier
  draft left ambiguous: "Mission Ridge — North Launch" for a North Launch that was
  deleted months ago, next to a flight at the identical spot correctly reading "Mission
  Ridge."

**Cost, stated honestly.** One additional `Zone.id IN (...)` primary-key query per page
that has any zone ids — so pages with none (every page today) pay nothing. Feed limit is
still ≤50 and `encodeFeedCursor` still uses only dates and flight id, so cursor stability
is unaffected (asserted by test).

`LIST_SELECT` and `FEED_SELECT` gain the four zone columns. `statsFrom` is **unchanged**
— it counts distinct visible takeoff *site* ids, which is the right unit for "sites
flown" and needs no zone awareness. That it needs no change is a direct payoff of
decision 2.

### Display

`lib/sites/display.ts` — pure, no DB/Next imports, unit-tested:

```ts
/** "Mission Ridge — North Launch" | "Mission Ridge" | null (caller renders "Unknown site"). */
export function formatLocationLabel(
  siteName: string | null,
  zoneName: string | null,
): string | null;
```

An em dash with hair spacing, matching `DESIGN.md`'s typographic register. A zone name
without a site name returns the *site*-shaped result of `null` — never the bare zone —
so a partially-stripped row can never render a dangling child name. The returned DTO
exposes `siteName`/`zoneName` as separate fields, not a pre-joined string — the UI
composes the label; nothing downstream reads raw Prisma flight rows for display.
Consumed by `components/flight/flight-header.tsx`, `components/logbook/flight-row.tsx`,
and the feed row.

### Writing the cache

`lib/sites/associate.ts` remains the sole writer of the now-**eight** denormalized
columns. `siteCachePatch` is replaced (not supplemented) by:

```ts
export interface LocationFieldPatch {
  takeoffSiteId?: string | null;   takeoffSiteName?: string | null;
  takeoffZoneId?: string | null;   takeoffZoneName?: string | null;
  landingSiteId?: string | null;   landingSiteName?: string | null;
  landingZoneId?: string | null;   landingZoneName?: string | null;
}

/**
 * The ONLY thing allowed to write those eight columns. Emits the zone id ONLY
 * alongside its own site id — the zoneId ⇒ siteId invariant is structural here,
 * not checked. Caches a name only for a PUBLIC row; the zone name additionally
 * requires the parent site to be public (the conjunction, applied at write time
 * too, so the cache and the firewall agree).
 */
export function locationCachePatch(
  site: Pick<Site, "id" | "name" | "visibility">,
  zone: Pick<Zone, "id" | "name" | "visibility" | "siteId"> | null,
  endpoint: SiteEndpoint,
): LocationFieldPatch;

/** Re-reads BOTH rows inside the caller's transaction and re-verifies the pair. */
export async function resolveLocationCache(
  db: LocationCacheDb,
  siteId: string | null,
  zoneId: string | null,
  endpoint: SiteEndpoint,
  ownerId: string,
): Promise<LocationFieldPatch>;
```

`resolveLocationCache` degrades gracefully in exactly the way the domain wants: a zone
demoted or deleted between match and write resolves to **site-only**, not to nothing. A
site demoted resolves to nothing, taking the zone with it.

**Transitions.** Zone promote/demote/rename are two `updateMany`s over the new zone-id
indexes, mirroring the site writers. **`deleteZone` explicitly nulls the cached zone
name alongside the `SetNull`'d id** — no historical zone-name fallback, per the read-path
rule above. *Site* transitions are the interesting case, because a site's visibility
gates its children: demoting a site must null the zone name cache on every referencing
flight (**without touching the zone's own `visibility` column** — see
[Effective visibility](#effective-visibility--the-conjunction-rule)), and promoting it
must restore each zone's name **only where that zone is itself public**. A per-zone
`updateMany` loop is O(zones); one correlated statement per endpoint is O(1) and lives
inside the existing transaction:

```sql
UPDATE "Flight" f
   SET "takeoffZoneName" = CASE
         WHEN z."visibility" = 'public' AND s."visibility" = 'public' THEN z."name"
         ELSE NULL END
  FROM "Zone" z JOIN "Site" s ON s."id" = z."siteId"
 WHERE f."takeoffZoneId" = z."id" AND s."id" = $1;
```

Because this is raw SQL, **the write audit must learn to see it.** `write-audit.test.ts`
gains a second pattern: any file outside the allowlist that both mentions
`$executeRaw`/`$queryRaw` and references `"Flight"` together with a `SiteName`/`ZoneName`
column is a violation, proven by a positive control (the pattern matches
`associate.ts`'s own statement) *and* a negative control (an unrelated raw query outside
the allowlist doesn't false-positive). Without the extension, raw SQL would be the one
hole in the invariant this sprint widens from four columns to eight.

| Event | Effect on referencing flights |
|---|---|
| zone private → public (parent public) | zone cache ← zone name |
| zone private → public (parent private) | **refused** (write-time conjunction; see below) |
| zone public → private | zone cache ← `NULL` (owner still sees it via the resolver) |
| zone rename | zone cache ← new name (when effectively public) |
| zone deleted | `SetNull` on the zone id; cached zone name **also nulled** — no history; the flight falls back to site-level display |
| site private → public | site cache ← name; zone caches recomputed per zone (their own `visibility` column, untouched by the demote, decides) |
| site public → private | site cache ← `NULL`; **all** zone caches ← `NULL`; zones' own `visibility` columns untouched |
| site rename | site cache ← new name; zone caches untouched |
| site deleted | zones cascade-deleted (guarded — see [Undo and operator remedy](#undo-and-operator-remedy)); both ids `SetNull`; site name kept as history, zone names nulled |

Changing a **flight's** visibility still writes nothing.

### Creating and reusing — the two-step flow

`lib/sites/repo.ts`'s `createOrAttachSiteFromFlight` becomes:

```ts
export type SiteChoice =
  | { mode: "reuse"; id: string }
  | { mode: "create"; name: string; visibility: SiteVisibility };

export type ZoneChoice =
  | { mode: "reuse"; id: string }
  | { mode: "create"; name: string; visibility: SiteVisibility };

export interface CreateOrAttachInput {
  flightId: string;
  ownerId: string;
  endpoint: SiteEndpoint;
  site: SiteChoice;
  zone?: ZoneChoice;              // OMITTED = bind the bare site (today's behaviour)
}
```

Order of operations inside one transaction:

1. Load the flight owner-scoped; require the endpoint coordinate (server-derived, never
   from the client).
2. Resolve the **site** exactly as SPRINT-004 does — reuse verified against
   `siteVisibleWhere(ownerId)`; create with in-transaction re-probe, proximity-scoped
   `normalizedName` conflict rejection, and coordinate rounded to 4 dp.
3. If `zone` is present, resolve the **zone** against that site:
   - *reuse*: `zone.siteId === site.id` **and** `canSeeZone(...)`, else the same
     indistinguishable `"Zone not found."`. Reuse from the opposite endpoint widens
     `Zone.kind` to `"both"` — never narrows — the identical rule SPRINT-004 already
     applies at the site level;
   - *create*: validate the name with the existing `validateSiteName` (the rules are
     identical — no second validator); **set `Zone.kind` from the endpoint** being named
     (`takeoff` or `landing`, never left at the schema's `"unknown"` default); **refuse
     `visibility: "public"` when the site is private** with a steer ("publish Mission
     Ridge first, or keep this spot private"); insert at the endpoint coordinate rounded
     to 4 dp; on the public-only partial-index conflict, re-read the winner and reuse it
     — for a private create, re-probe visible candidates in-transaction instead (there is
     no unique key to conflict on).
   - Widen `Site.kind` to `"both"` when the new zone's kind differs from the site's —
     never narrow, the same rule as opposite-endpoint reuse.
4. Bind the flight through `locationCachePatch` only.
5. Re-associate the creator's own flights (below), revalidate the four surfaces.

**Suggestions become nested.** `suggestNearbySites` → `suggestNearbyLocations`:

```ts
export interface ZoneSuggestion { id, name, kind, visibility, distanceM, bearingDeg }
export interface SiteSuggestion { id, name, kind, visibility, distanceM, bearingDeg,
                                  zones: ZoneSuggestion[] }
export async function suggestNearbyLocations(
  lat: number, lon: number, viewerId: string | null, limit?: number,
): Promise<SiteSuggestion[]>;
```

Still kind-agnostic and still `SUGGEST_RADIUS_M = 2000` — wider than either match radius
on purpose, because the dialog only opens *because* matching returned null. Two bbox
queries (sites, and zones with their parents) whose parent-site ids are **unioned**: a
visible zone inside the radius surfaces its parent site even when that site's own
coordinate sits outside the box. Zones are nested under their parent, sorted by distance,
and a site's own distance is `min(own distance, nearest visible zone distance)` so a
large site ranks by its closest known spot.

**Retroactive re-association gains an upgrade path.** `reassociateOwnFlights(ownerId,
site, zone, endpoint)`:

- creating a **site**: unchanged — the creator's own ready flights with a null site id
  for that endpoint, within the site radius, capped at 200, cap logged.
- creating (or reusing-into, from another endpoint) a **zone**: the creator's own ready
  flights within the *zone* radius that either have a null site id **or are already
  bound to this site with a null zone id.** That second clause is the load-bearing half
  — it is what makes use case 8 true. Naming "North Launch" retroactively refines every
  one of the creator's own already-site-bound Mission Ridge flights that actually
  launched there, not only the previously-unmatched ones. Same cap, same logging, still
  **never** another pilot's flights at request time.

**The daily create cap is shared.** `DAILY_CREATE_CAP = 10` (`lib/sites/repo.ts:51`)
now counts sites **plus** zones created by that owner today. Two levels shouldn't double
the blast radius of an abuse burst. Public remains preselected for a new public site or
zone, and the SPRINT-004 consequence copy applies at **both** levels — a pilot adding a
spot under someone else's public site is told, before saving, that they're publishing a
name and coordinate to every viewer of that site.

### Undo and operator remedy

Zone undo is the site undo, one level down, with one addition: **either the zone's own
creator or the parent site's owner** may unpublish or delete a zone, while no other
pilot's flight references it. Once one does, it's community property, same as
SPRINT-004. (Decision 4 — see Overview.)

**Site deletion is guarded against another pilot's zones, not only another pilot's
flights.** `referencedByOthers` (`lib/sites/associate.ts:172-186`) today only counts
flights by other owners. A site can now have zones authored by pilots other than the
site's owner (use case 9), and those zones might not yet — or ever — have a flight bound
to them. The guard is extended: `deleteSite` (and `unpublishOwnSite`) refuse while
**either** another pilot's flight references the site **or** another pilot owns a zone
under it, regardless of whether that zone currently has any flight. This closes a real
gap: without it, `onDelete: Cascade` would let a site owner silently destroy another
pilot's contributed zone the instant it existed, guard or no guard.

`scripts/admin-sites.ts` gains `zone-rename`, `zone-force-private`, and `zone-merge`
(reassign every reference, then delete), plus a `list <siteId>` that prints a site with
its zones. Raw `prisma.zone.delete` is forbidden outside the sanctioned helper, same as
sites.

## Implementation

Four ordered PRs. Each ships its migration where needed and passes all five gates.

### PR1 — The `Zone` model and zone-aware matching (no user-visible change)

- Migration `20260821120000_site_zones`: the `Zone` table, its indexes, the public-only
  partial unique index, the four `Flight` zone columns + two indexes, and the raw-SQL
  CHECKs. Purely additive — it applies cleanly to local dev's 11 existing sites, which
  simply become bare sites (see [Q6](#open-questions)).
- `lib/sites/geo.ts`: `ZONE_TAKEOFF_RADIUS_M` / `ZONE_LANDING_RADIUS_M` /
  `zoneRadiusForKind` + boundary unit tests (at, just inside, just outside each radius;
  zone-vs-site radius interaction; existing antimeridian and `cosLat` coverage extended
  to the zone pass).
- `lib/sites/visibility.ts`: `canSeeZone` + a truth-table test covering all
  4 (site vis × zone vis) × 4 (owner / other-owner / no-owner / null-viewer) combinations,
  plus the orphan and parent-mismatch branches.
- `lib/sites/lookup.ts`: `findLocation` replacing `findSite`; parallel bbox passes;
  deterministic ordering within each pass; zone-wins-over-site precedence; **the site
  pass always runs, never excluded by zone existence** (this is the specific behaviour a
  rejected alternative design got wrong — see Architecture § Matching).
- `lib/sites/repo.ts`: `zoneVisibleWhere`, `getZoneForViewer`, `listZonesForSite(siteId,
  viewerId)`.
- `ingestFlight` and `scripts/backfill-sites.ts` updated to the new signature but still
  writing **site-only** patches — the zone columns stay unwritten until PR2's firewall
  exists. The ordering is the safety property, exactly as in SPRINT-004.
- Integration: a private zone never matches a stranger's ingest and does match its owner's;
  a public zone under a private site matches nobody but the site's owner; a zone beats a
  site at the same spot; **a site with a zone still matches a flight outside every zone
  radius but inside the site radius** (the no-dead-ends test); **a zone under a different,
  farther site can beat a nearer bare site** — named, accepted, and tested (see Risks); an
  anonymous caller matches no private zone, orphaned or not.
- **Depends on:** nothing.

### PR2 — The two-level read-path firewall (the security PR)

- `lib/sites/associate.ts`: `locationCachePatch` + `resolveLocationCache` replace their
  site-only predecessors; zone transition writers (rename/promote/demote/**delete, which
  nulls the cached name**); the correlated-SQL site-transition recomputation; `deleteSite`
  / `unpublishOwnSite` gain the other-owned-zone guard.
- `lib/sites/display.ts` + unit tests.
- `lib/flights/repo.ts`: `resolveLocationFields` on **all six** reads — the five from
  SPRINT-004 plus `listOwnFlightsByIds`, now routed through the resolver instead of
  returning raw `LIST_SELECT` rows; `LIST_SELECT` / `FEED_SELECT` gain the four zone
  columns; `statsFrom` verified unchanged.
- `ingestFlight` starts writing zone columns, inside the create transaction, through
  `resolveLocationCache`.
- Render surfaces switch to `formatLocationLabel`.
- `write-audit.test.ts`: the allowlist covers the zone columns; the **raw-SQL pattern**
  is added with both a positive control (matches `associate.ts`) and a negative control
  (an unrelated raw query doesn't false-positive).
- **Tests — the heart of the sprint** (`test/sites.integration.test.ts`, extended):
  - **Matrix, second dimension:** owner / friend / stranger / anonymous ×
    (public site, public zone) / (public site, private zone) / (private site, private
    zone) / (private site, public zone — the incoherent row, asserted neutralized) ×
    flight `private` / `friends` / `public` × takeoff + landing, on the flight gate,
    logbook, profile list, feed, **and `listOwnFlightsByIds`.** Every denial paired with
    a positive control.
  - **Leak sweep, extended.** The existing CI leak sweep (`sites.integration.test.ts`)
    is extended so it also asserts no private *zone* name or id ever appears in a
    response body across the same surfaces.
  - **Conjunction:** a public zone under a demoted site is invisible to everyone but the
    site's owner, in matching *and* display, with no write required to the zone's own
    `visibility` column — and becomes effective-public again automatically on
    re-promotion.
  - **Stale-row defence ×2:** a hand-written cached zone name pointing at a private zone
    is stripped; a hand-written zone id whose `siteId` disagrees with the row's
    `takeoffSiteId` is stripped (proving the mismatch branch is live).
  - **Zone-id-without-site-id:** the hand-written row the absent CHECK would have blocked
    renders as "Unknown site," not as a dangling zone name.
  - **Transitions:** every row of the table above, including that demoting a site nulls
    zone caches without touching zone `visibility`, and re-promoting restores only the
    still-public zones' names.
  - **Ingest race:** a zone demoted between match and create caches site-only, not
    nothing; a site demoted caches neither.
  - **Deletes:** deleting a zone keeps the flight's site binding but drops the zone name
    entirely (no history); deleting a site cascades zones and keeps the site name as
    history while dropping zone names.
  - **Feed:** cursor stability unchanged after two-level resolution.
- **Depends on:** PR1. **Still no way to create a zone** — by design.

### PR3 — "Which spot?" (create, dedup, re-associate)

- `lib/sites/repo.ts`: `suggestNearbyLocations` (nested, parent-union), the reshaped
  `createOrAttachSiteFromFlight`, the partial-index conflict → reuse (public) /
  re-probe (private), the public-zone-under-private-site refusal, `Zone.kind` set from
  endpoint on create and widened to `"both"` on opposite-endpoint reuse, `Site.kind`
  widening (unchanged from SPRINT-004), the shared daily cap, **zone-aware
  `reassociateOwnFlights` that upgrades already-site-bound flights** (use case 8).
- `app/flights/[id]/site-action.ts`: the action takes `{ site, zone? }`; every
  client-influenced field re-validated server-side; hidden and nonexistent zones
  indistinguishable in responses.
- `components/flight/name-site-dialog.tsx`: nested suggestions; a second **optional**
  "Which spot?" step that appears only after a site is chosen or created, with **Skip —
  just the site** as a first-class button; consequence copy for the zone's own
  public/private choice; the zone's Public option disabled with an explanation when the
  parent is private.
- Structured log line on every create/bind, now carrying both ids.
- Tests: create site-only (byte-identical outcome to SPRINT-004); create site + zone;
  add a zone to an existing visible site (including a site owned by someone else); reuse
  a sibling zone; reuse a zone under the *wrong* site is refused; a public zone name
  collides with a *public* sibling → refused with reuse offered; a public zone name
  matches a *private* sibling's name → succeeds, creates a second row, no leak; opposite-
  endpoint zone reuse widens `Zone.kind`; concurrent same-name public zone creation
  resolves to one row via the partial index; a non-owner cannot name another pilot's
  flight; the shared cap refuses across sites and zones combined; an endpoint with no fix
  offers no affordance; **the creator's own already-site-bound Mission Ridge flights
  upgrade to the new zone and another pilot's do not.**
- **Depends on:** PR2.

### PR4 — Undo, operator remedy, release pass

- Zone unpublish/delete under the unreferenced guard, **now checkable by either the
  zone's creator or the parent site's owner**; the last-zone-under-a-site case asserted
  to leave a working bare site; **`deleteSite`/`unpublishOwnSite` refuse while any zone
  under the site is owned by another pilot**, with a dedicated test (a zone with no
  flight bound yet still blocks deletion).
- `scripts/admin-sites.ts`: `zone-rename`, `zone-force-private`, `zone-merge`, `list`;
  operator docs forbidding raw zone deletes.
- **E2E** `test/e2e/zones.spec.ts`: (a) upload a flight far from everything → "Unknown
  site" → name the site public, skip the zone step → headline shows "Mission Ridge" and
  stays that way on a second distinct nearby IGC (the bare-site path, unchanged from
  SPRINT-004); (b) name a site, then add a public zone → headline becomes "Site — Zone"
  → upload a **distinct** second IGC within the zone radius → auto-associates two levels
  deep with no interaction.
- `lib/whats-new.ts` entry ("Launches and LZs, by name"), `FEATURES.md`,
  `docs/architecture.md` gains the two-level privacy seam, `/qa-prompt` handed off.
- **Depends on:** PR3.

## Files Summary

**New:** `lib/sites/display.ts` (+test), `prisma/migrations/20260821120000_site_zones/`,
`test/e2e/zones.spec.ts`.

**Modified:** `prisma/schema.prisma` (`Zone`, `Site.zones`, four `Flight` columns +
indexes, `Profile.ownedZones`), `lib/sites/geo.ts` (+`geo.test.ts`), `lib/sites/visibility.ts`
(+`visibility.test.ts`), `lib/sites/lookup.ts` (+`lookup.test.ts`), `lib/sites/associate.ts`,
`lib/sites/repo.ts`, `lib/sites/write-audit.test.ts`, `lib/flights/repo.ts`,
`lib/ingest/ingest-flight.ts`, `app/flights/[id]/site-action.ts`,
`components/flight/name-site-dialog.tsx`, `components/flight/flight-header.tsx`,
`components/logbook/flight-row.tsx`, the feed row, `scripts/backfill-sites.ts`,
`scripts/admin-sites.ts`, `test/sites.integration.test.ts`,
`test/backfill-sites.integration.test.ts`, `lib/whats-new.ts`, `FEATURES.md`,
`docs/architecture.md`.

**Unchanged on purpose:** `app/api/upload/route.ts`, `app/api/ingest/route.ts` (the
ingest seam absorbs zone matching), `lib/prisma.ts` (no zone URLs), `lib/flights/visibility.ts`,
`lib/sites/name.ts` (zone names reuse the site validator unchanged), `prisma/seed.ts`
(still seeds nothing), `statsFrom`.

## Definition of Done

- [ ] `Zone` exists with a **required** `siteId` (`onDelete: Cascade`), its own `ownerId`
      and `visibility` (**no column default**), `normalizedName`, `kind`, `lat`/`lon`,
      a **public-only** partial unique index on `(siteId, normalizedName)`, and the two
      CHECKs; the Prisma-v6 drift is documented.
- [ ] **No `zoneId ⇒ siteId` CHECK and no composite FK**, with both the cascade-ordering
      reason and the composite-FK rejection reason recorded in the migration; the
      invariant is enforced by the single cache writer and proven by the
      hand-written-violating-row test.
- [ ] `findSite` no longer exists; `findLocation` requires `viewerId`; no call site
      compiles without one; both API routes are unchanged and device push behaves
      identically to web upload.
- [ ] A zone within the zone radius beats a site at the same spot; **a site still matches
      when no zone is in range, whether or not it has zones**; both passes are
      deterministically ordered and tested with a public and an owner-private candidate
      in range simultaneously; a zone under a different site beating a nearer bare site
      is an accepted, tested behaviour, not an unspecified one.
- [ ] Zone radii live in `lib/sites/geo.ts` with no DB/Next imports, unit-tested at and
      just outside each boundary.
- [ ] `canSeeZone` is the conjunction of zone and parent, fail-closed on a missing or
      mismatched parent, with the full truth table tested.
- [ ] Every display read — **including `listOwnFlightsByIds`** — re-verifies **every**
      non-null site id **and** zone id; stripping a site always strips its zone; a zone
      whose `siteId` disagrees with the row's site id is stripped.
- [ ] A hand-written cached **zone** name pointing at a private zone is still stripped by
      the read path.
- [ ] A private zone under a public site renders "Mission Ridge" to every viewer but its
      owner, through a public flight, in the logbook, on the profile, and in the feed.
- [ ] Creating a public zone under a private site is refused at the UI/validation layer;
      no database constraint enforces it; demoting a site never writes to its zones'
      `visibility` column, and a zone's own visibility survives a demote/re-promote cycle
      unchanged.
- [ ] All eight denormalized columns are written **only** by `lib/sites/associate.ts`,
      enforced by the audited allowlist test — **including its new raw-SQL pattern**, with
      both a positive and a negative control.
- [ ] Ingest re-reads both rows inside the create transaction; a concurrent zone demotion
      degrades to site-only; a concurrent site demotion caches neither.
- [ ] Site transitions recompute zone caches per zone (public zones restored on promote,
      all nulled on demote) in one statement per endpoint, inside the transaction.
- [ ] Deleting a zone drops its cached name entirely (no historical zone-name fallback)
      while the flight's site binding and site name survive; deleting the last zone
      leaves a fully functional bare site.
- [ ] Zone creation sets `Zone.kind` from the endpoint being named; opposite-endpoint
      zone reuse widens `Zone.kind` to `"both"` and never narrows, mirroring the existing
      `Site.kind` rule.
- [ ] `formatLocationLabel` renders "Site — Zone," "Site," or nothing; a zone name without
      a site name never renders.
- [ ] The naming dialog's zone step is **optional and skippable in one click**; creating a
      site with no zone is byte-identical in outcome to SPRINT-004.
- [ ] Nested suggestions surface a site via a nearby visible zone even when the site's own
      coordinate is outside the box; private zones never appear to a viewer who can't see
      them.
- [ ] Concurrent creation of the same public sibling zone name resolves to one zone via
      the partial unique index (conflict → reuse); a private zone with the same sibling
      name never blocks or is blocked by a public one, and the conflict path never reveals
      a private zone's existence.
- [ ] Creating (or reuse-binding from the opposite endpoint) a zone re-associates the
      creator's own **already-site-bound** flights within the zone radius, not only
      previously-unmatched ones (capped at 200, **cap logged**); other pilots' flights are
      untouched.
- [ ] The daily create cap counts sites **and** zones together; consequence copy appears
      before saving a public site or a public zone.
- [ ] The zone's own creator, **or the parent site's owner**, can unpublish or delete a
      zone while no other pilot's flight references it; `deleteSite`/`unpublishOwnSite`
      additionally refuse while any zone under the site is owned by another pilot,
      independent of flight references.
- [ ] `scripts/admin-sites.ts` gains zone rename / force-private / merge / list; raw zone
      deletes documented as forbidden; `scripts/backfill-sites.ts` writes zone columns only
      through the helper.
- [ ] `statsFrom` is unchanged and its "sites flown" count is unaffected by zones.
- [ ] Feed keyset cursor stability unchanged; profile / feed / logbook remain dynamic /
      `no-store`.
- [ ] **CI provisions Postgres and the extended matrix, including the extended leak
      sweep, actually runs** (throws, does not skip).
- [ ] E2E covers both the bare-site path (name a site, skip the zone step, a second flight
      still matches it) and the two-level path (unknown → name site → add zone →
      two-level render → distinct second IGC auto-associates two levels deep).
- [ ] All five gates green; `/whats-new` entry added; `FEATURES.md` updated;
      `docs/architecture.md` documents the two-level seam; `/qa-prompt` handed off.
- [ ] Deferred items **not** shipped: three-level hierarchy, per-zone radius column,
      `hasZones` flag, user-facing zone reparenting, zone pages/URLs/browse,
      `homeSiteId`/`homeZoneId`, centroid refinement, wind metadata.

## Risks

- **A private zone name leaking through the new cache columns (highest).** The sprint
  doubles the denormalized surface from four columns to eight. *Mitigation:* the same
  firewall shape, extended — every id verified, the conjunction applied as a single
  early return, one cache writer, the audit extended to raw SQL with both positive and
  negative controls, the matrix extended to the zone dimension, the leak sweep extended,
  and the stale-row defence duplicated for zones. The failure mode stays "the owner sees
  less than they should" (benign), never "a stranger sees a private name."
- **The conjunction is applied in one place but relied on in four.** A future read
  surface that resolves a zone without its parent would leak the parent's existence.
  *Mitigation:* `canSeeZone` takes the parent as a **required argument** — there is no
  way to call it without one — and returns false on a missing parent.
- **Raw SQL in the site-transition writer bypasses the Prisma-shaped audit.**
  *Mitigation:* the audit's second pattern, with positive and negative controls; the
  statement is confined to `associate.ts` and covered by transition tests in both
  directions.
- **Referential-action ordering during a site delete — confirmed, not just theoretical.**
  When a flight is bound to both a site directly (`takeoffSiteId`) and a zone under that
  same site (`takeoffZoneId`), deleting the site fires two FK actions that converge on
  the same `Flight` row: `SetNull` on `takeoffSiteId` directly, and `SetNull` on
  `takeoffZoneId` indirectly (via `Zone.siteId`'s `Cascade`). Empirically, on Postgres
  18, letting both run as native cascades raises `Flight_takeoffZoneId_fkey` violations
  — this is exactly why there's no non-deferrable CHECK depending on their order (the
  reason the composite-FK alternative was rejected too), but the finding is stronger
  than "a CHECK would be risky": the native double-cascade itself isn't reliable here.
  *Mitigation:* `deleteSite` explicitly nulls both `*ZoneId` and `*ZoneName` for every
  flight referencing a zone under the site, in the same transaction, BEFORE the site
  delete — so the zone cascade has nothing left to touch on any `Flight` row by the
  time it fires. The delete path is asserted end-to-end in the integration suite,
  including the specific case (a flight bound to both levels) that surfaces this.
- **Site ownership now grants moderation power over another pilot's zone (decision 4).**
  A site owner could rename or delete a good-faith contribution they simply dislike.
  *Mitigation, and an accepted product bet:* this is strictly narrower than the power a
  site owner already has (they can already demote or delete the whole site, destroying
  every zone under it at once) — this decision only makes an existing power more
  targeted, not new in kind. The zone's own creator retains independent undo rights up
  until another pilot depends on it, same as SPRINT-004.
- **Two-level naming is more UI than pilots want.** The flow could feel like paperwork.
  *Mitigation, and an accepted product bet:* the zone step is optional, appears only
  after the site is settled, and defaults to skipping; the SPRINT-004 one-step path
  survives intact. If usage shows nobody adds zones, nothing is broken — the model just
  stays flat.
- **Zone proliferation under one site.** A pilot could add several near-identical zones.
  *Mitigation:* the public-only partial unique index for exact-name collisions among
  visible zones, the nested suggestions (which show existing zones before the name
  field), the shared daily cap, and operator `zone-merge`. Residual near-duplicates (e.g.
  "N Launch" vs. "North Launch," or same-named private zones) are a data-quality issue,
  not a correctness one — the same posture SPRINT-004 took on site-name duplicates.
- **Radius collisions, both within and across sites.** Two zones under the same site
  250 m apart with 300 m radii overlap; the nearer wins deterministically, but the
  loser's flights can flip if a coordinate is later corrected. Less obviously, a zone
  under a *different* site can beat a nearer bare site's own centre, because zone
  matching has no cross-site distance tie-break against a competing site match — a zone
  290 m away can win over a bare site 50 m away. *Accepted, both cases:* deterministic
  ordering makes each reproducible, operator merge is the remedy for the intra-site case,
  and the cross-site case is rare in practice (it requires two named places within a few
  hundred meters of each other) and is explicitly named and tested rather than silently
  unspecified. Per-zone radii remain the documented follow-up if real collision data
  says otherwise.
- **A newly created zone changes matching for every future flight at that site, for
  every pilot, silently.** The first zone anyone names at a bare site — or the first
  zone that upgrades a pilot's own back-catalog (use case 8) — is a retroactive change
  from every other pilot's perspective, with no notification. *Accepted:* this is the
  sprint's entire value proposition (a flat "Mission Ridge" becoming a precise "Mission
  Ridge — North Launch" is the feature, not a side effect), and it's bounded — it only
  ever adds precision, never removes a match a pilot already had, given the no-dead-ends
  matching rule above.
- **Rollback.** PR2 changes read semantics for every flight list again, and after PR3
  ships, zones can exist in production. *Mitigation:* the ordering means reverting
  PR2/PR3/PR4 before any zone is created leaves a coherent system; reverting **after**
  zones exist leaves the reverted code ignoring `takeoffZoneId`/`landingZoneId` — display
  falls back to the parent site (a graceful degradation, not a crash), but re-forward-
  rolling is the only way to see zone names again. Both PR1 and PR2 are additive at the
  DB level — no column is dropped or repurposed, so a revert never loses a site binding,
  only zone precision.

## Security (privacy / authz)

- **Invariant 1 (extended):** site *and* zone read scoping lives exclusively in
  `lib/sites/repo.ts` + `lib/sites/visibility.ts`, fail-closed — unknown visibility ⇒
  private; no viewer ⇒ public only; an orphaned private row is readable by nobody.
- **Invariant 2 (new):** **zone visibility is the conjunction with its parent's.** No
  readable zone ever has an unreadable parent, at write time or read time. A zone's own
  `visibility` column is never touched by a parent site's transitions — only the
  derived, per-viewer read result and the denormalized cache are.
- **Invariant 3 (extended):** all eight `Flight` cache columns are written only by
  `lib/sites/associate.ts`; the `Site`/`Zone` rows are authoritative whenever the
  corresponding id is non-null; identity (**both id and name, both levels**) is
  re-scoped before leaving `lib/flights/repo.ts`, on **every** list function including
  `listOwnFlightsByIds`.
- **Invariant 4 (new):** `zoneId ⇒ siteId`, with the zone's parent denormalized onto the
  flight. Enforced by the cache writer's shape, verified by the read path's mismatch
  branch, and asserted by a hand-written-row test — deliberately *not* by a DB CHECK or
  composite FK.
- **Write-time and read-time scoping stay separate and both explicit.** Ingest binds
  within `public ∪ owner's private`, at both levels; display re-scopes per viewer, at
  both levels.
- **Mutations gated by reads:** every zone action asserts `getFlightForViewer(...) !==
  null` *and* owner identity first; coordinates come from the flight row, never the
  client; zone ids from the client are re-checked against both `zoneVisibleWhere` **and**
  the chosen parent; hidden, mis-parented, and nonexistent zones are indistinguishable in
  responses.
- **Site-owner zone moderation (decision 4) is scoped, not general.** The site owner may
  rename or delete a zone under *their own* site only — never a zone under a site they
  don't own, and this grants no visibility they didn't already have (they already see
  every zone under their own site by definition of ownership).
- **Honest scope of the guarantee:** a private zone protects its **name and row** — not
  the flight's coordinates, which still follow flight visibility exactly as today. A
  pilot who can see the track can always see where the flight started. Launch-coordinate
  obfuscation remains the deferred item it has been since SPRINT-001.
- **Untrusted text:** zone names go through the same NFKC / length / allowed-script /
  control-zero-width-bidi-stripping validator as site names — no second, weaker path.
- **Abuse:** signed-in, onboarded pilots only; the create cap now spans both levels;
  attribution on every zone; structured logging on every create/bind.
- **Tests are the contract, and CI must run them** — a skipped matrix or a skipped leak
  sweep means the two-level privacy work is unverified.

## Dependencies

- **Internal:** PR2 ⟵ PR1; PR3 ⟵ PR2; PR4 ⟵ PR3. Strictly sequential, and the ordering is
  itself a safety property: nothing can create a private zone before the read path that
  hides one is proven, and nothing writes a zone cache column before the firewall reads
  it.
- **External/stack:** **none new.** No packages, no services. Prisma v6 (pinned),
  NextAuth v5, Postgres on Railway, existing `components/ui/*`. CI's Postgres service
  already exists.
- **Data:** production has zero `Site` rows, so there is no backfill and no compatibility
  shim. Local dev's 11 `source='user'` sites survive the additive migration as bare
  sites.
- **Test data:** the existing ≥3-pilot fixtures, plus IGC fixtures at ~200 m (inside the
  zone radius), ~450 m (outside zone, inside site), and ~1500 m (outside both) from a
  reference point, plus a second, farther reference point for the cross-site collision
  test — the fixtures the matching precedence rules need. Dedupe is by exact bytes, so
  each must be a distinct file.

## Open Questions

Answered here as committed decisions; revisit only if the product changes.

1. **Does `Zone` get its own `ownerId`/`visibility`, or inherit?** — **Its own columns,
   with effective visibility as the conjunction — decided by stakeholder interview,
   over a simpler inherited-visibility alternative.** Inheritance alone can't express
   "public site, private spot," which is the exact case that motivated this sprint.
   Independence alone permits "private site, public zone," which is incoherent because
   the roll-up renders the parent's name — so that combination is refused at create time
   and neutralized at read time regardless. Its own `ownerId` is needed too: a pilot may
   add a zone to another pilot's public site, and the undo guard (extended by decision 4)
   is per-creator with a site-owner override layered on top.
2. **What does the `Flight` FK point at?** — **Both: the existing `Site` FK plus a new
   optional `Zone` FK, and two cache-name columns per endpoint** (eight columns total),
   under the invariant `zoneId ⇒ siteId AND zone.siteId = flight.siteId`. Repointing at
   `Zone` was rejected: it makes "site with no zone" unrepresentable, forces a join on
   every display read, breaks `statsFrom`, and would turn deleting a zone into losing the
   site binding. The denormalized parent is what lets the undo guard, the stats, and most
   of the SPRINT-004 matrix carry over untouched. The cost — four more columns to keep
   honest — is paid by extending the single-writer audit rather than by trusting them.
3. **How does the UX change?** — **Progressive two-step, second step optional.** Step 1 is
   today's dialog with suggestions now nested (sites with their visible zones). Step 2
   ("Which spot?") appears only after a site is settled, offers reuse-or-create, and has
   **Skip — just the site** as a first-class action. Creating a bare site stays a
   one-step flow with an unchanged outcome. Reuse-first dedup applies at both levels:
   proximity-scoped and advisory for sites (unchanged), and a **public-only** partial
   unique index for sibling zones.
4. **Tighter zone radius?** — **Yes: 300 m takeoff / 400 m landing, with the site radii
   unchanged at 600 m / 900 m.** Roughly half, preserving the takeoff/landing asymmetry.
   The site pass is a fallback that runs on *every* zone miss, not only for zoneless
   sites — generalizing the intent's requirement rather than special-casing it, which is
   what makes "no dead ends" a structural property instead of a branch someone could
   forget.
5. **A `Site.hasZones` flag?** — **No.** It would save nothing: the zone pass is an
   indexed bbox query that returns empty precisely when no zone is near, and knowing that
   zones exist somewhere under the site doesn't tell you whether one is *in range* — you'd
   run the query anyway. In exchange it would add an invalidation obligation to every zone
   create, delete, and cascade. Derived from the relation when a count is genuinely needed
   (the operator `list` command).
6. **Local dev's 11 existing sites?** — **No reset needed, by design.** The migration is
   purely additive (one new table, four nullable columns, indexes, CHECKs and the partial
   index on the new table only), and those 11 rows become bare sites — a fully supported,
   first-class state, which is decision 1's whole point. `pnpm db:migrate` is sufficient;
   `pnpm exec prisma migrate reset && pnpm db:seed` remains available and harmless (the
   seed creates no sites; note there is no `pnpm db:reset` script — use the `prisma`
   invocation directly). If the local environment can't survive this migration, the model
   has a bug worth finding before production has data.
7. **Who can fix a zone contributed to someone else's site?** — **The zone's own creator
   (until another pilot's flight references it), or the parent site's owner, in
   addition** — decided by stakeholder interview. This is new pilot-over-pilot power
   beyond SPRINT-004's stance, deliberately scoped: it grants the site owner no
   capability they didn't already have in aggregate (wholesale site demotion), only finer
   granularity, and it applies only to zones under a site that pilot actually owns.

**Genuinely still open** (not blocking, deliberately unanswered):

- Should a zone's coordinate drift toward the centroid of the flights bound to it, and
  should a *site*'s coordinate become the centroid of its zones? Both are the
  "self-correcting gazetteer" follow-up, and both risk drifting a row across its own
  radius boundary. Needs real data first.
- Do zones eventually need aspect/wind-direction metadata ("North Launch: NW–N")? That is
  the first thing a launch list wants and the first thing that makes zones worth
  browsing — but browsing is out of scope here, so the metadata has no consumer yet.
- Should `kind` on `Site` eventually become derived from its zones rather than stored?
  Today it must stay stored, because bare sites match on it.
- Should the cross-site match-shadowing case (Risks, above) eventually get a tie-break
  that prefers the *nearer* named place regardless of zone-vs-site level, once real usage
  shows whether it's a frequent nuisance or a theoretical edge case?
