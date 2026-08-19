# SPRINT-004 — User-generated site locations

> Produced by the multi-agent sprint-planning workflow
> (`consensus(opus-4.8, gpt-5.5)` + cross-critique + interview). Drafts, critiques,
> and merge notes are in [`drafts/`](./drafts/). Intent:
> [`drafts/SPRINT-004-INTENT.md`](./drafts/SPRINT-004-INTENT.md).

## Overview

Today a flight whose takeoff or landing doesn't fall near one of the 12 curated sites
renders **"Unknown site"** — forever. This sprint lets the pilot fix that: name the
place, publish it **public** into the shared gazetteer or keep it **private**, and every
later flight that lands close enough — theirs, anyone's, web-uploaded or device-pushed —
picks the name up automatically.

Three decisions anchor the sprint:

1. **Flight visibility and site visibility are independent.** A pilot may make a flight
   public while keeping their launch's *name* private; viewers see the flight and
   "Unknown site". The property that falls out of this framing — *changing a flight's
   visibility requires no site writes at all* — is what makes the whole design safe, and
   it is why we rejected the tempting alternative of forbidding private sites on
   non-private flights.

2. **`Flight.{takeoff,landing}SiteName` becomes a public-name cache, and the `Site` row
   is authoritative.** A private site sets the id and leaves the cached name `NULL`.
   On every display read, `lib/flights/repo.ts` verifies **every** non-null site id
   against `Site` and returns viewer-safe display fields; when the viewer may not read
   the site, **both** the id and the name are stripped. The cached column survives for
   exactly one purpose: the historical fallback when `siteId IS NULL` (a deleted site,
   whose name today still reads correctly in the logbook — see `schema.prisma:186`,
   "denormalized name kept for history").

3. **This is the app's first shared user-generated content.** Flights, photos, and kudos
   each belong to one pilot. A public site is authored by one pilot and lands in
   everyone's logbook. That drags naming quality, duplicates, and abuse into scope for
   the first time — handled here with validation, attribution, a create cap, reuse-first
   UX, and a creator undo, but explicitly **without** a moderation model.

**Committed v1 scope**

1. `Site` gains `ownerId` + `visibility` (`public` | `private`) + `normalizedName`;
   curated seeds stay `ownerId = null`, public. Viewer-scoped lookup and a site repo.
2. The public-name cache + strict viewer-scoped resolution in `lib/flights/repo.ts`,
   with a privacy matrix and a leak sweep that CI runs against Postgres.
3. **Name this site** in place on the flight page — takeoff **and** landing — with a
   public/private choice, consequence copy, name validation, and reuse-first dedup.
4. Automatic association on ingest (web **and** device push), plus bounded
   re-association of the creator's own unmatched flights.
5. **Creator undo:** unpublish or delete your own site while no other pilot's flight
   references it.

**Explicitly out of scope** (with reasons, not just names)

- **Moderation / report queues, trust levels, community editing, user-facing merge.**
  No reviewer role exists in the product; a queue costs more than it protects at this
  scale. Mitigated instead by attribution, validation, a create cap, the creator undo,
  and an operator remedy script — *a bad public name must always be fixable by someone.*
- **`/sites/<id>` pages, browse, search.** No success criterion needs them, and a site
  page is a new public surface with its own visibility matrix. Consequently
  `lib/prisma.ts`'s "only `Flight` is URL-visible" is **not reopened** — no site id ever
  appears in a URL.
- **`Profile.homeSiteId`.** Stays dormant. A home site is persistent, self-asserted
  location data attached to a public handle; it deserves its own privacy design, not a
  free ride on the sprint that is closing the first name-leak path.
- **A `friends` tier for sites.** Two tiers is the smallest complete model; a third
  multiplies the matrix by the friend graph for little gain.
- **Cross-pilot retroactive re-association at request time.** Relabelling hundreds of
  strangers' logbook headlines from one pilot's action is surprising and the sharpest
  abuse amplifier. Operator sweep only.
- **Pilot-adjustable map markers, centroid refinement, gazetteer import** (still blocked
  on ParaglidingEarth redistribution terms), **launch-coordinate obfuscation**
  (unchanged by this sprint, neither added nor removed).

## Use Cases

1. **Name an unknown takeoff.** A pilot opens their own flight, sees **Unknown site** as
   the headline, taps it, types "Sonoma Ridge", confirms **Public** or switches to
   **Private**, saves. The headline updates without leaving the page.
2. **Name an unknown landing.** The flight page gains a **landing** line; the same flow
   applies with the 900 m radius.
3. **The app offers an existing site first.** Before the name field, visible sites within
   the advisory radius are listed — "Ed Levin — 740 m NE · takeoff · public" — each with
   **Use this site**. Reuse binds the flight and creates nothing.
4. **A later flight names itself.** The pilot uploads, or their Leaf pushes, a second
   flight from the same launch. Ingest matches and the flight reads "Sonoma Ridge" on
   arrival — no interaction, identical on both paths.
5. **A public site helps everyone.** Another pilot flies that launch for the first time;
   their flight matches on ingest.
6. **A private site helps nobody else — including through a flight.** It never appears in
   another pilot's match, suggestions, or reads, **and a public flight bound to it renders
   "Unknown site" to every viewer but its owner**, who still sees the name everywhere.
7. **Retroactive fix.** Creating the site re-matches the creator's own older unmatched
   flights within the radius; their logbook fills in at once.
8. **Undo a mistake.** A pilot who published their home launch by accident unpublishes or
   deletes it while no other pilot's flight references it.

## Architecture

### Data model

```prisma
model Site {
  id             String   @id @default(cuid())
  name           String
  normalizedName String                        // NEW — NFKC + folded, for dup checks
  kind           String   @default("unknown")  // takeoff | landing | both | unknown
  lat            Float
  lon            Float
  countryCode    String?
  region         String?
  source         String   @default("manual")   // manual | user
  sourceId       String?
  sourceUrl      String?
  license        String?
  ownerId        String?                       // NEW — null for curated seeds
  owner          Profile? @relation("OwnedSites", fields: [ownerId], references: [id], onDelete: SetNull)
  visibility     String                        // NEW — private | public, NO column default
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt           // NEW
  // existing flight/home relations unchanged
  @@index([lat, lon])
  @@index([ownerId])
  @@index([ownerId, normalizedName])
}

model Flight {
  // Columns unchanged; only their MEANING narrows. takeoffSiteName / landingSiteName
  // are a PUBLIC-NAME CACHE plus the historical fallback for a deleted site.
  @@index([takeoffSiteId])   // NEW — promote / rename / delete updateMany
  @@index([landingSiteId])   // NEW
}
```

**`visibility` has no column default.** Prisma then requires it on every `site.create`,
so `prisma/seed.ts` and every fixture must state intent — forgetfulness becomes a loud
failure instead of a silent publish. (A `@default("public")` would fail *open*, against
the `Flight.visibility @default("private")` precedent.)

**`onDelete: SetNull` on `Site.ownerId`, and deliberately no "private ⇒ owned" CHECK.**
The two are mutually contradictory: deleting a `User` cascades to `Profile`, fires
`SET NULL`, and would violate such a CHECK — breaking teardown in every integration
suite (`test/privacy.integration.test.ts:217`, `feed:76`, `social:88`) on day one.
Instead the **read predicate fails closed** (`ownerId IS NOT NULL AND ownerId = viewerId`),
so an orphaned private site is readable by **nobody**.

**Raw SQL appended to the hand-written migration** (Prisma v6 cannot express CHECK; the
resulting `migrate diff` drift is expected — *do not delete it to "fix" the drift*, per
the SPRINT-003 precedent):

```sql
UPDATE "Site" SET "visibility" = 'public' WHERE "ownerId" IS NULL;  -- curated rows
ALTER TABLE "Site" ADD CONSTRAINT "site_visibility_check"
  CHECK ("visibility" IN ('private','public'));
ALTER TABLE "Site" ADD CONSTRAINT "site_kind_check"
  CHECK ("kind" IN ('takeoff','landing','both','unknown'));
ALTER TABLE "Site" ADD CONSTRAINT "site_source_check"
  CHECK ("source" IN ('manual','user'));
```

**No `Flight`-side CHECK is added for the cached-name columns**, on either endpoint. All
four `(siteId, name)` combinations are legitimately reachable — no site yet (`NULL, NULL`),
a deleted site's historical fallback (`NULL, name`), a linked private site (`id, NULL`,
since only public sites get a cached name), and a linked public site (`id, name`) — so no
single-row CHECK can distinguish a valid from an invalid state without an extra flag the
schema doesn't have. (An earlier draft of this plan carried a `flight_takeoff_site_name_check`
that read as if it enforced this; it was a tautology — `X IS NULL OR X IS NOT NULL` is
always true — and has been dropped rather than fixed, since there's nothing correct to
enforce here at the DB layer.) The real invariant — *the cached name is written only by
`lib/sites/associate.ts`* — is enforced at the application layer by the audited allowlist
test in PR2, not by a database CHECK.

### Site visibility and scoped lookup

`lib/sites/visibility.ts` — the fail-closed normalizer, mirroring
`lib/flights/visibility.ts`:

```ts
export const SITE_VISIBILITIES = ["private", "public"] as const;
export function normalizeSiteVisibility(v: unknown): SiteVisibility;  // → "private" on anything unknown
export function canSeeSite(visibility, ownerId, viewerId): boolean;   // private ⇒ owned AND viewer === owner
```

Pure geo (bbox prefilter, haversine rank) moves to `lib/sites/geo.ts`, free of DB and
Next imports. **Radii are unchanged**: 600 m takeoff, 900 m landing.

`findSite` takes an options object with a **required** `viewerId`, so every existing call
site is a compile error until made explicit:

```ts
findSite(db, { lat, lon, kind, viewerId })
```

Its candidate predicate — note the null branch, because Prisma compiles
`{ ownerId: null }` to `IS NULL`, which would otherwise match **every orphaned private
site** for an anonymous caller:

```ts
kind IN (requested, "both")
AND ( visibility = "public"
      OR (viewerId !== null && visibility = "private" && ownerId = viewerId) )
//       ^ the private branch is OMITTED ENTIRELY when viewerId is null
```

**Deterministic ordering** (matters most for device push, which has no UI to ask):
distance ascending → `license = 'curated'` first → `id`. A public site and the owner's
own private site can both sit in radius; the winner must not depend on database return
order, as it does today (`lib/sites/lookup.ts:30-45` updates only on strictly smaller
distance, with no ordering in SQL).

`ingestFlight` passes `viewerId: ownerId`. That is the correct **write-time** scope — it
records what the flight's owner can name for their own flight — and it leaves
`app/api/upload/route.ts` and `app/api/ingest/route.ts` **untouched**, which is what keeps
the device path correct.

### The read path (strict)

`lib/flights/repo.ts` stays the only display-read gate and becomes the only place that
turns linked sites into viewer-safe display fields. Reads return **viewer-safe DTOs**,
not raw `Flight` rows — after site scoping the object is no longer a database row
(`takeoffSiteId` may be nulled for the viewer), and typing it as `Flight` invites a future
mutation to treat it as the persisted record.

```
resolveSiteFields(rows, viewerId):
  ids ← every non-null takeoffSiteId / landingSiteId in the page   # ALWAYS, not just null names
  sites ← SELECT id, name, visibility, ownerId FROM Site WHERE id IN (ids)
  per row, per endpoint:
    siteId non-null and canSeeSite(...)  → name = site.name          # the Site row WINS
    siteId non-null and not visible      → id = null, name = null    # nothing leaves
    siteId null                          → keep the cached name      # historical fallback
```

**Why every id, not just the ones with null names.** The cheaper variant — resolve only
when a row has an id and no cached name — never inspects a row whose cached name is
already non-null, so a stale or hand-written row like
`{ takeoffSiteId: <private>, takeoffSiteName: "Private Launch" }` would sail straight
through. That makes the guarantee a *write-side invariant verified by tests*, not a
read-side authorization check. We chose the firewall.

**Cost, stated honestly.** One extra `Site.id IN (...)` query — by primary key, after the
page slice — on every page that has any site ids, the friends feed included. The feed's
limit is capped at 50 (`lib/flights/repo.ts:206`), and the query runs alongside the
existing friendship, flight-page, and kudo-count queries. Nulling site ids must not
perturb `encodeFeedCursor`, which uses only dates and flight id
(`lib/flights/repo.ts:57-64`) — asserted by test.

Applied in `getFlightForViewer`, `listOwnFlights`, `listProfileFlightsForViewer`,
`listPublicFlights`, and `listFeedForViewer`. `LIST_SELECT` gains the landing fields it
currently lacks. `statsFrom` counts distinct visible takeoff site ids — because
unreadable ids are nulled, a stranger's "distinct sites" count under-reports rather than
over-reports, which is the correct direction.

**Per-viewer caching.** Site names now differ by viewer, so profile/feed/logbook reads
stay dynamic / `no-store` per the SPRINT-003 precedent. None of these may become publicly
cacheable.

### Writing the cache

One helper is the only thing in the app allowed to write the four denormalized fields:

```ts
// lib/sites/associate.ts — cache the name ONLY for public sites.
siteCachePatch(site, endpoint) → { siteId, siteName: site.visibility === "public" ? site.name : null }
```

**Ingest must re-read the matched site inside the create transaction.** Today `findSite`
runs *before* `prisma.flight.create` and outside any transaction
(`lib/ingest/ingest-flight.ts:66-80`), so a site demoted between match and create would
write a stale public name onto the new flight. The fix: re-read the matched site id inside
the transaction and compute the cache from that read.

**Site transitions** are one transactional `updateMany` each over the new site-id indexes:

| Event | Effect on referencing flights |
|---|---|
| private → public | cached name ← site name |
| public → private | cached name ← `NULL` (owner still sees it via the resolver) |
| public rename | cached name ← new name |
| site deleted | `SetNull` on the id; the cached name is **kept** as the historical record |

Changing a **flight's** visibility writes nothing.

### Creating and reusing a site

A server-only core, called by an owner-guarded server action:

```ts
createOrAttachSiteFromFlight({ flightId, ownerId, endpoint, mode: "reuse" | "create",
                               existingSiteId?, name?, visibility? })
```

1. Load the flight owner-scoped; confirm the endpoint has a coordinate.
2. **Re-run the visible-candidate probe inside the transaction** (guards two pilots
   creating the same site concurrently).
3. Reuse: verify the chosen site is visible to the owner. **Widen `kind` to `both`** when
   reused from the opposite endpoint; never narrow.
4. Create: validate + normalize the name, round the coordinate, insert, link.
5. Write cached fields only through `siteCachePatch`.
6. Re-associate the creator's own unmatched flights (below), then revalidate the flight
   page, logbook, profile, and feed.

**The candidate query for the dialog ignores `kind`** — only the *automatic* matcher
filters by it. Otherwise a pilot who named their LZ `kind:'landing'` and later names the
launch at the same spot is shown nothing and creates the duplicate that success criterion 4
exists to prevent.

**The advisory radius is the primary path, and it must be wider than the match radius.**
The dialog only opens *because* `findSite` already returned null there, so by construction
nothing visible sits inside 600 m / 900 m. `SUGGEST_RADIUS_M = 2000` (a single fixed
radius, not an endpoint-dependent multiplier), ≤5 candidates by distance, each with
distance, bearing, kind, and visibility. The naming form sits below and is always
available — never block, never silently reuse.

**Visibility choice: Public is preselected** — a deliberate product decision (a site only
helps other pilots if it is public), overriding the private-first default. Because it
overrides that default, three things are load-bearing rather than optional: the dialog
shows **consequence copy before the save** ("Public shares this name and location with
every pilot"), the creator undo is in committed scope, and a daily create cap stays.

**Undo.** The creator may unpublish or delete their own site while
`count(flights WHERE (takeoffSiteId = s.id OR landingSiteId = s.id) AND ownerId <> creator)
=== 0` — one guard, no new authorization concept. **Both columns, not just
`takeoffSiteId`:** `Flight` has no unified `siteId` field, and a site can be referenced
through either endpoint (a landing-only reference is exactly as real as a takeoff one, per
the "opposite-endpoint reuse widens `kind` to `both`" rule above) — checking only one column
would let a site still referenced through the other be unpublished or deleted undetected.
Once another pilot's flight depends on it via either endpoint, the site is community
property and the affordance disappears; `scripts/admin-sites.ts` is the operator remedy
(rename / force-private / merge). **Raw `prisma.site.delete` is forbidden** — it would
leave orphan cached names; deletion must go through the helper.

### Retroactive association

- Always link the current flight synchronously.
- Also scan the creator's **own** ready flights missing that endpoint, bbox-prefiltered and
  owner-scoped, capped at 200 — **and log when the cap truncates**, never silently.
- **Never** scan other pilots' history at request time, even for a public site.

`scripts/backfill-sites.ts` becomes the operator sweep: it must select each flight's
`ownerId`, call scoped lookup with `viewerId: ownerId`, write only through
`siteCachePatch`, and gains `--site-id <id>` and `--public-only` flags. It is currently a
bulk writer of the cached columns and unscoped — fixing it is in the DoD.

### Naming rules

`lib/sites/name.ts`, pure and unit-tested. NFKC → trim → collapse whitespace → strip
control, zero-width, and bidi characters (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069) —
the homograph vector for a name every pilot reads. Length 2–60 after normalization.
Letters of **any script**, digits, spaces, and `' - – ( ) . , / &`; reject names with no
letter or digit at all. Reserved (case-insensitive): `unknown site`, `unknown`, `unnamed`,
`none`, `null`, `n/a`. **No global uniqueness** — real gazetteers have many "Le Col", and a
global unique name lets the first creator squat a common one. Uniqueness is
**proximity-scoped**: reject a `normalizedName` match against a *visible* site within the
advisory radius, with a steer to reuse.

Coordinates come from the flight endpoint **rounded to 4 dp** (~11 m). This is *not*
launch-location obfuscation — `Flight.takeoffLat/Lon` are stored at full precision and the
track is served to anyone who can see the flight. What it buys is narrower and real:
the public site row is not a byte-exact fingerprint of one private flight's takeoff fix.

## Implementation

Four ordered PRs. Each ships its own migration where needed and passes all five gates.

### PR1 — Ownable, scoped sites (no user-visible change)
- Migration `user_sites`: `Site.ownerId` / `visibility` (no default) / `normalizedName` /
  `updatedAt` / indexes; `Flight` site-id indexes; the raw-SQL backfill and CHECKs.
- `lib/sites/geo.ts` (pure) + unit tests: radius boundaries at and just outside
  600 m / 900 m, `kind` filtering, bbox-vs-haversine agreement, antimeridian wrap,
  high-latitude `cosLat` clamp, deterministic tie-break ordering.
- `lib/sites/visibility.ts` + truth-table tests (including `viewerId: null`).
- `findSite` options object with required `viewerId`; richer `SiteMatch`
  (`visibility`, `ownerId`, `kind`, `distanceM`).
- `lib/sites/repo.ts`: `siteVisibleWhere`, `getSiteForViewer`, `listOwnSites`.
- Update both `ingestFlight` call sites, `scripts/backfill-sites.ts`, `prisma/seed.ts`
  (explicit `visibility`, `ownerId: null`, `normalizedName`).
- Integration: a private site never matches a stranger's ingest, does match its owner's;
  public matches everyone; **anonymous viewer does not match orphaned private sites**;
  curated behaviour unchanged; every `source='manual'` row is public, unowned, normalized.
- **Depends on:** nothing.

### PR2 — The read-path firewall (the security PR)
- `lib/sites/associate.ts` (`siteCachePatch`) as the single cache writer; ingest and the
  backfill script route through it; ingest re-reads the matched site **inside** the
  create transaction.
- Viewer-safe DTOs + `resolveSiteFields` wired into all five repo reads; `LIST_SELECT`
  gains landing fields.
- Transition writers (`setSiteVisibility`, `renameSite`, `deleteSite`) — transactional
  `updateMany` over the new indexes.
- **Fix `test/feed.integration.test.ts:52`**, which fabricates a `takeoffSiteName` with no
  `takeoffSiteId` — a hole in the invariant this sprint establishes.
- **Tests — the heart of the sprint** (`test/sites.integration.test.ts`):
  - **Matrix:** owner / friend / stranger / anonymous × private / public site × flight
    `private` / `friends` / `public` × takeoff + landing, asserted on the flight gate,
    logbook, profile list, and feed.
  - **Leak sweep:** no flight row carries a cached name whose site is not public.
  - **Stale-row defence:** hand-write a row with a non-null cached name pointing at a
    private site; assert the read path still strips it. *(This is the test that proves
    strict beats fast.)*
  - **Transitions:** promote / demote / rename / delete; flipping a **flight's**
    visibility changes no site name and writes nothing.
  - **Ingest race:** a demotion concurrent with ingest never caches a private name.
  - **Feed:** keyset cursor stability unchanged after site resolution.
  - **Fail-closed discipline:** every denial paired with a positive control, so an empty
    result cannot pass vacuously.
- **Depends on:** PR1. **Still no way to create a site** — by design.

### PR3 — Name this site (create, dedup, re-associate)
- `lib/sites/name.ts` + unit tests.
- `lib/sites/repo.ts`: `suggestNearbySites` (kind-agnostic, 2 km),
  `createOrAttachSiteFromFlight` (in-transaction re-probe, daily cap),
  `reassociateOwnFlights` (capped at 200, cap logged).
- Server action + `components/flight/name-site-dialog.tsx`; owner-only affordances on the
  takeoff headline **and the new landing line**; consequence copy with Public preselected;
  candidate bearings computed with the existing, already-unit-tested `bearingDeg` from
  `lib/igc/interpolate.ts` — **no new bearing implementation.** (A prior draft of this plan
  proposed a separate `lib/geo/bearing.ts`; that would have given the app two independent
  great-circle bearing calculations with a real risk of divergence — rounding, 0°/360°
  wrap-around — between the replay heading math and the site-suggestion UI.)
- Structured log line on every create / bind.
- Tests: create public and private; every validation rejection; dedup surfaces candidates
  and reuse binds without inserting; **opposite-endpoint reuse widens `kind` to `both`**;
  concurrent creation resolves to one site; own older flights re-associate and others' do
  not; a non-owner cannot name a site on someone else's flight; the cap refuses; a flight
  with no fix for that endpoint offers no affordance.
- **Depends on:** PR2.

### PR4 — Undo, operator remedy, release pass
- Creator unpublish / delete under the unreferenced guard, with re-denormalization.
- `scripts/admin-sites.ts` (rename / force-private / merge); backfill flags;
  operator docs forbidding raw site deletes.
- **E2E** `test/e2e/sites.spec.ts`: upload a flight far from every curated site →
  "Unknown site" → name it public → headline updates → upload a **distinct** second IGC
  nearby → auto-associates with no interaction.
- `lib/whats-new.ts` entry, `FEATURES.md` updated, `docs/architecture.md` gains the site
  privacy seam, `/qa-prompt` handed to the validator partner.
- **Depends on:** PR3.

## Files Summary

**New:** `lib/sites/geo.ts` (+test), `lib/sites/visibility.ts` (+test),
`lib/sites/name.ts` (+test), `lib/sites/repo.ts`, `lib/sites/associate.ts`,
`components/flight/name-site-dialog.tsx`,
`app/flights/[id]/site-action.ts`, `scripts/admin-sites.ts`,
`test/sites.integration.test.ts`, `test/e2e/sites.spec.ts`,
`prisma/migrations/*_user_sites/`.

**Modified:** `prisma/schema.prisma`, `lib/sites/lookup.ts` (scoped signature, ordering,
pure geo extracted), `lib/flights/repo.ts` (DTOs + resolver on all five reads, landing
fields in `LIST_SELECT`), `lib/ingest/ingest-flight.ts` (scoped lookup, in-transaction
re-read), `scripts/backfill-sites.ts`, `prisma/seed.ts`,
`components/flight/flight-header.tsx`, `components/logbook/flight-row.tsx`,
`app/flights/[id]/page.tsx` (landing line), `test/feed.integration.test.ts`,
`lib/whats-new.ts`, `FEATURES.md`, `docs/architecture.md`.

**Unchanged on purpose:** `app/api/upload/route.ts`, `app/api/ingest/route.ts` (the seam
absorbs scoping), `lib/prisma.ts` (no site URLs), `lib/flights/visibility.ts`.

## Definition of Done

- [ ] `Site` has `ownerId`, `visibility` (**no column default**), `normalizedName`,
      `updatedAt`; curated rows are public + unowned; CHECKs present and the Prisma-v6
      drift documented; **no "private ⇒ owned" CHECK** (it would break test teardown).
- [ ] `findSite` requires `viewerId`; no call site compiles without one; the private
      branch is omitted entirely when `viewerId` is null; ingest scopes to the owner and
      **both routes are unchanged**, so device push behaves identically to web upload.
- [ ] Automatic matching is deterministically ordered (distance → curated → id) and tested
      with a public site and the owner's private site both in radius.
- [ ] Pure geo lives in `lib/sites/geo.ts` with **no DB/Next imports**, unit-tested for
      radius boundaries, `kind`, bbox-vs-haversine, antimeridian, high-latitude `cosLat`.
- [ ] Every display read verifies **every** non-null site id; the `Site` row wins when the
      id is non-null; the cached name is used **only** when `siteId IS NULL`.
- [ ] A hand-written row with a non-null cached name pointing at a private site is **still
      stripped by the read path** (the stale-row test).
- [ ] A private site is invisible to everyone but its owner — in matching, in suggestions,
      and **through a public or friends-visible flight's site name** — proven by the
      owner / friend / stranger / anonymous matrix with a positive control paired to every
      denial.
- [ ] Site identity (**id and name**) never leaves `lib/flights/repo.ts` for a viewer who
      may not read the site; reads return viewer-safe DTOs, not raw `Flight` rows.
- [ ] `Flight.{takeoff,landing}SiteName` is written **only** by `lib/sites/associate.ts`,
      enforced by an **audited allowlist test** that fails on writes outside the helper.
- [ ] Ingest re-reads the matched site inside the create transaction; a concurrent
      demotion never caches a private name.
- [ ] Site transitions (promote / demote / rename / delete) update referencing flights
      transactionally; changing a **flight's** visibility writes nothing.
- [ ] Feed keyset cursor stability is unchanged after site resolution; profile / feed /
      logbook remain dynamic / `no-store`.
- [ ] An owner can name an unknown **takeoff** and an unknown **landing** in place; flight
      page, logbook, profile, and feed all show the new name immediately.
- [ ] The create dialog **preselects Public** and shows consequence copy (name **and**
      location shared with every pilot) **before** the save.
- [ ] Creating near an existing visible site **offers reuse first** (kind-agnostic, ≤5,
      ≤2 km, with distance and bearing); reuse binds without inserting; opposite-endpoint
      reuse **widens `kind` to `both`** and never narrows; a proximity-scoped
      `normalizedName` conflict is refused with a steer to reuse.
- [ ] Concurrent creation of the same site by two pilots resolves to one site.
- [ ] A later flight — web or device — auto-associates with no interaction; the creator's
      own older unmatched flights re-associate on create (capped at 200, **cap logged**);
      other pilots' existing flights are untouched.
- [ ] Name validation: NFKC, 2–60 chars, any script, control/zero-width/bidi stripped,
      reserved words refused, no global uniqueness.
- [ ] A daily create cap is enforced; every create / bind emits a structured log line.
- [ ] The creator can unpublish or delete their own site while no other pilot's flight
      references it; the affordance disappears once one does; `scripts/admin-sites.ts`
      gives the operator rename / force-private / merge, and raw site deletes are
      documented as forbidden.
- [ ] `scripts/backfill-sites.ts` is owner-scoped, writes only through the helper, has
      `--site-id` / `--public-only`, and is covered by a test.
- [ ] No site read for display outside `lib/sites/repo.ts` — audited allowlist, same
      discipline as the flight audit.
- [ ] **CI provisions Postgres and the sites matrix actually runs** (throws, does not skip).
- [ ] E2E covers unknown → name → render → distinct second IGC auto-associates.
- [ ] All five gates green; `/whats-new` entry added; `FEATURES.md` updated;
      `docs/architecture.md` documents the site privacy seam; `/qa-prompt` handed off.
- [ ] Deferred items **not** shipped: moderation UI, site pages / URLs / browse / search,
      `Profile.homeSiteId`, friends-tier sites, cross-pilot request-time re-association,
      adjustable coordinates.

## Risks

- **A private site name leaking through a cached column (highest).** *Mitigation:* the
  read path verifies every site id, so the failure mode is "owner sees Unknown" (benign)
  rather than "stranger sees a private name" (the breach); one cache writer; the matrix,
  the leak sweep, and the stale-row test; CI runs all three.
- **A new surface reads `prisma.site` or the raw column directly.** *Mitigation:*
  repo-only invariant extended to sites, audited allowlist test, and a read path that is
  safe even when the column is wrong.
- **Public-by-default increases accidental publication.** A preselected Public makes the
  gazetteer grow — and makes mis-clicks more likely. *Mitigation, and an accepted
  residual risk:* consequence copy before the save, the creator undo, the daily cap, and
  attribution. Revisit if real usage shows regret.
- **Community vandalism / bad public names.** One pilot's joke becomes everyone's logbook
  headline, with no moderation surface. *Accepted residual risk:* attribution, validation,
  cap, undo, operator remedy. A report affordance is the first follow-up if it bites.
- **Near-duplicate proliferation.** *Mitigation:* the 2 km kind-agnostic suggestion radius,
  proximity-scoped name rejection, in-transaction re-probe, operator merge. Residual
  duplicates are a data-quality issue, not a correctness one.
- **Private-site shadowing.** A pilot's private site hides a nearby public name from their
  own flights. *Mitigation:* deterministic ordering, the dedup probe steers reuse;
  documented and accepted.
- **Read-path cost.** One extra indexed query per page with site ids, feed included.
  *Mitigation:* primary-key lookup after the page slice; feed limit ≤50; cursor stability
  asserted. Accepted deliberately in exchange for the firewall.
- **Re-association cost.** *Mitigation:* owner-scoped, bbox-prefiltered, capped, logged.
- **Rollback.** PR2 changes read semantics for every flight list. *Mitigation:* the PR
  order means a revert of PR3/PR4 leaves a coherent system (no user sites exist yet), and
  PR2 is additive at the DB level.

## Security (privacy / authz)

- **Invariant 1:** site read scoping lives **exclusively** in `lib/sites/repo.ts`
  (`siteVisibleWhere` / `canSeeSite`), fail-closed — unknown visibility → private; no
  viewer → public only; a private site with a null owner is readable by nobody.
- **Invariant 2:** `Flight.{takeoff,landing}SiteName` is a public-name cache written only
  by `lib/sites/associate.ts`; the **`Site` row is authoritative** whenever the id is
  non-null, and site identity is re-scoped for the viewer before leaving
  `lib/flights/repo.ts`.
- **Write-time and read-time scoping are separate and both explicit.** Ingest binds within
  `public ∪ owner's private`; display re-scopes to the viewer.
- **Mutations gated by reads:** every site action asserts `getFlightForViewer(...) !== null`
  *and* owner identity first; coordinates come from the flight row, never the client; site
  ids from the client are re-checked against `siteVisibleWhere` before binding; hidden and
  nonexistent sites are indistinguishable in responses.
- **Honest scope of the guarantee:** a private site protects the **name and the site row** —
  not the flight's coordinates, which continue to follow *flight* visibility exactly as
  today. Launch-coordinate obfuscation remains the deferred item it has been since
  SPRINT-001.
- **Untrusted text:** site names are user content rendered as a page headline — normalized,
  validated, length-capped, stripped of control/zero-width/bidi characters; React escaping
  does the rest.
- **Abuse:** signed-in and onboarded pilots only; daily create cap; attribution on every
  user site; structured logging. Shared-store rate limiting stays the existing tracked
  backlog item.
- **Tests are the contract, and CI must run them** — a skipped sites matrix means the
  privacy work is unverified.

## Dependencies

- **Internal:** PR2 ⟵ PR1; PR3 ⟵ PR2; PR4 ⟵ PR3. Strictly sequential — the ordering is
  itself a safety property: nothing can create a private site before the read path that
  hides one is proven.
- **External/stack:** **none new.** No packages, no services. Prisma v6 (pinned),
  NextAuth v5, Postgres on Railway, existing `components/ui/*`. CI's Postgres service and
  `pnpm db:seed` already exist.
- **Test data:** the existing ≥3-pilot fixtures, plus an IGC fixture launching well away
  from all 12 curated sites (so "Unknown site" is reachable) and a **distinct** second
  fixture within 600 m of it (dedupe is by exact bytes, so the E2E cannot reuse the file).

## Open Questions (resolved here; revisit only if product changes)

1. **Denormalization leak** — public-name cache + **strict** viewer-scoped resolution;
   `Site` row authoritative when the id is non-null; cache is the historical fallback when
   it is null. Flight-visibility changes write nothing.
2. **Viewer-scoping `findSite`** — options object, `viewerId` required and defaultless;
   ingest passes the owner; both routes unchanged.
3. **Public creation** — immediate, no moderation queue. Bounded by validation,
   attribution, a daily cap, the creator undo, and an operator remedy script.
4. **Retroactive re-association** — current flight + the creator's own unmatched flights
   (capped, logged); never other pilots' at request time; `backfill-sites.ts` is the sweep.
5. **Dedup UX** — reuse-first, kind-agnostic, 2 km advisory radius (wider than the match
   radius, which would be a no-op); never block, never silently reuse.
6. **Site coordinate** — the flight endpoint rounded to 4 dp; no map picker in v1. The
   rounding de-correlates the public row from one private flight's fix; it is *not*
   launch obfuscation.
7. **Site `kind`** — created endpoint-specific; **widened to `both` on explicit
   opposite-endpoint reuse**; never narrowed; no automatic background promotion.
8. **Surface area** — no site pages, browse, or search; `lib/prisma.ts`'s short-id policy
   is not reopened. One new render surface: the flight page's landing line.
9. **`Profile.homeSiteId`** — explicitly out of scope, column left dormant with a schema
   comment; it needs its own privacy design.
10. **Naming rules** — NFKC + folded `normalizedName`, 2–60 chars, any script, no global
    uniqueness, proximity-scoped conflict rejection.

## Future design sketch — site quality (NOT built)

Two follow-ups this sprint deliberately leaves on the table. **Coordinate refinement:** a
site's position could migrate toward the centroid of the flights bound to it, making
popular launches self-correcting — a background pass, never user-asserted, and careful not
to drift a site across the 600 m boundary of its own members. **A report affordance:** one
button on a public site's name, writing a row an operator reviews with
`scripts/admin-sites.ts` — the smallest possible moderation surface, and the first thing to
build if bad public names materialize. Both are their own (small) sprints; neither should
be smuggled into this one.
