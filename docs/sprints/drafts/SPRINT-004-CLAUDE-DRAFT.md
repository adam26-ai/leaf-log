# SPRINT-004 (draft) — User-generated site locations

> Independent draft written against
> [`SPRINT-004-INTENT.md`](./SPRINT-004-INTENT.md). Planning document only — no
> application code, migrations, or tests were written. All ten of the intent's
> Open Questions are answered as decisions (see [Open Questions](#open-questions-answered)).

## Overview

Today a flight whose takeoff or landing doesn't fall near one of the 12 curated
sites renders the honest string **"Unknown site"**, forever. This sprint lets the
pilot fix that: name the place, keep it **private** (yours alone) or publish it
**public** (into the shared gazetteer), and every later flight that lands close
enough — yours, anyone's, web-uploaded or device-pushed — picks the name up
automatically.

Three decisions anchor the sprint:

1. **The denormalized name on `Flight` is narrowed to a public-safe cache.**
   `Flight.takeoffSiteName` / `landingSiteName` are only ever populated when the
   referenced site is **public**. A private site sets `takeoffSiteId` and leaves
   the name `NULL`; the owner's name is re-hydrated at read time by the
   viewer-scoped repo. This makes the leak **impossible by construction** rather
   than prevented by discipline — every page, route, export, and not-yet-written
   consumer that touches the raw column can only ever read a public name. See
   [The denormalization firewall](#the-denormalization-firewall-oq1).
2. **Site reads are scoped in exactly one new place — `lib/sites/repo.ts`** —
   mirroring `lib/flights/repo.ts` and the SPRINT-003 discipline. Pages, routes,
   and actions pass a `viewerId` and trust the repo. `findSite` gains a **required**
   scope parameter with no default, so every existing call site is a compile error
   until it is made explicit.
3. **Write-time scoping and read-time scoping are different questions.** Ingest
   binds a flight to `public ∪ the owner's private` sites — that is a fact about
   the *owner's* world. Whether a *viewer* may know that site's name is decided
   separately, at read time. Conflating the two is what creates the leak.

**Committed v1 scope:**
1. `Site` gains `ownerId` + `visibility` (`public` | `private`); curated seeds stay
   `ownerId = null`, public. Viewer-scoped matcher and site repo.
2. The public-safe name cache + a viewer-scoped resolver in `lib/flights/repo.ts`,
   with an integration matrix and a **leak sweep** CI runs against Postgres.
3. **Name this site** in place on the flight page — takeoff **and** landing —
   with private/public choice, name validation, and snap-to-existing dedup.
4. Automatic re-association: new flights match; the creator's own unmatched
   flights are re-matched synchronously on create.
5. **Your sites** management at `/settings/sites` (rename / delete / publish under
   a dependency rule) plus an operator script for the cases users can't fix.

**Explicitly out of scope (with reasons, not just names):**
- **Moderation / report UI, trust levels, user-facing merge.** No reviewer role
  exists in the product; building a queue costs more than it protects at this
  scale. Mitigated instead by attribution, a per-pilot creation cap, name
  validation, and an **operator remedy script** — a bad public name must always be
  fixable by someone.
- **Site pages / URLs / browse / search.** No success criterion needs them, and
  a site page is a whole new public surface with its own visibility matrix.
  `lib/prisma.ts`'s "only `Flight` is URL-visible" therefore **stands unchanged**.
- **`Profile.homeSiteId`.** Stays dormant — see [OQ9](#oq9--profilehomesiteid).
- **A `friends` tier for sites.** Two tiers (mine / everyone's) is the smallest
  complete model; a third multiplies the matrix by the friend graph for little gain.
- **Re-associating *other* pilots' existing flights on create.** Relabelling 400
  strangers' logbook headlines from one pilot's action is both surprising and the
  sharpest abuse vector. Operator sweep only (`scripts/backfill-sites.ts`).
- **Pilot-adjustable coordinate, centroid refinement, automatic `kind`
  promotion, re-assigning an already-matched flight from the UI, gazetteer
  import** (still blocked on ParaglidingEarth terms), **shared-store rate limits.**

**Why this order:** the read path that hides a private site ships and is proven
*before* the UI that can create one. PR1 makes sites ownable and scoped with no
user-visible change; PR2 closes the denormalization leak and proves it; only then
does PR3 let a pilot create a private site at all. PR4 adds management and the
release pass.

## Use Cases

1. **Name an unknown takeoff.** A pilot opens their own flight, sees **Unknown
   site** as the headline, taps it, types "Sonoma Ridge", chooses **Private** or
   **Public**, saves. The headline becomes "Sonoma Ridge" without leaving the page.
2. **Name an unknown landing.** The same flight now shows a **Landing** line
   (new — see [Surface area](#oq8--surface-area)); the pilot names the LZ from
   there. Kind-appropriate radius applies (900 m, not 600 m).
3. **The app offers an existing site first.** Before the name field, the dialog
   lists visible sites within 2 km — "Ed Levin — 740 m NE · takeoff · public" —
   each with **Use this site**. Reuse binds the flight and creates nothing.
4. **A later flight names itself.** The pilot uploads (or their Leaf pushes) a
   second flight from the same launch. Ingest matches the new site and the flight
   reads "Sonoma Ridge" on arrival — no interaction, identical on both paths.
5. **A public site helps everyone.** Another pilot flies that launch for the first
   time; their flight matches the public site and is named on ingest.
6. **A private site helps nobody else — including through a flight.** The private
   site never appears in another pilot's match, suggestions, or search, **and a
   public flight bound to it renders "Unknown site" to every viewer but its
   owner.** The owner still sees the name in their logbook, feed rows, and page.
7. **Retroactive fix.** Creating the site also re-matches the creator's *own*
   older unmatched flights within the radius; their logbook fills in at once.
8. **Publish later.** A pilot promotes a private site to public from
   `/settings/sites`; the name appears on their flights for everyone, and the
   site joins the gazetteer for future matches.
9. **Fix a typo.** The creator renames or deletes their site while only their own
   flights reference it. Once someone else's flight depends on it, it is community
   property and the affordance is gone (operator script only).

## Architecture

### Data model

```prisma
model Site {
  id          String    @id @default(cuid())
  name        String
  kind        String    @default("unknown") // takeoff | landing | both | unknown
  lat         Float
  lon         Float
  countryCode String?
  region      String?
  // NEW — ownership + visibility. Curated seeds keep ownerId = null, visibility "public".
  // For a private site ownerId is the ONLY reader; for a public site it is attribution
  // and holds the edit window (see the dependency rule).
  ownerId     String?
  owner       Profile?  @relation("OwnedSites", fields: [ownerId], references: [id], onDelete: SetNull)
  visibility  String    @default("private") // private | public — column default fails closed
  source      String    @default("manual")  // "user" for pilot-created
  sourceId    String?
  sourceUrl   String?
  license     String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt          // NEW
  takeoffFlights Flight[]  @relation("TakeoffSite")
  landingFlights Flight[]  @relation("LandingSite")
  homeProfiles   Profile[] @relation("HomeSite")   // still dormant, see OQ9

  @@index([lat, lon])
  @@index([ownerId])                        // NEW — "your sites", cap counting
}

model Flight {
  // ...unchanged... columns keep their names; only their MEANING narrows:
  // takeoffSiteName / landingSiteName are a PUBLIC-SAFE cache — non-null only
  // when the referenced site is public. Private sites: id set, name NULL.
  @@index([takeoffSiteId])  // NEW — rename/promote/demote/delete updateMany
  @@index([landingSiteId])  // NEW
}
```

`onDelete: SetNull` on `Site.ownerId` (not `Cascade`): a pilot deleting their
account must not delete community sites other pilots' flights reference. The
consequence — an orphaned *private* site with `ownerId = null` — is handled by
making the read predicate fail closed (`ownerId IS NOT NULL AND ownerId = viewerId`),
so an orphan private site is readable by **nobody**. A CHECK asserting
"private ⇒ owned" would instead be *violated* by the cascade; a fail-closed
predicate is the correct backstop. (Orphan cleanup: a later chore; there is no
account-deletion feature yet.)

**Raw-SQL appended to the migration** (Prisma v6 cannot express CHECK — this
shows as `migrate diff` drift; **that is expected, do not delete it to "fix" the
drift**, per the SPRINT-003 precedent):

```sql
-- Existing rows are the curated gazetteer: public and unowned.
UPDATE "Site" SET "visibility" = 'public' WHERE "ownerId" IS NULL;
ALTER TABLE "Site" ADD CONSTRAINT "site_visibility_check"
  CHECK ("visibility" IN ('private','public'));
ALTER TABLE "Site" ADD CONSTRAINT "site_kind_check"
  CHECK ("kind" IN ('takeoff','landing','both','unknown'));
-- One pilot cannot double-submit the same site (spatial dedup is app-layer).
CREATE UNIQUE INDEX "site_user_name_unique"
  ON "Site" ("ownerId", lower("name"), "kind") WHERE "source" = 'user';
-- The cache invariant's DB-expressible half: never a name without a site.
ALTER TABLE "Flight" ADD CONSTRAINT "flight_takeoff_site_name_check"
  CHECK ("takeoffSiteName" IS NULL OR "takeoffSiteId" IS NOT NULL);
ALTER TABLE "Flight" ADD CONSTRAINT "flight_landing_site_name_check"
  CHECK ("landingSiteName" IS NULL OR "landingSiteId" IS NOT NULL);
```

The other half — *"a cached name implies the site is **public**"* — needs a join
and so cannot be a CHECK. It is enforced by one write helper
(`resolveSitesForFlight`) and proven by a **leak sweep** in the integration suite
(below). Rejected as too clever: a composite FK `(siteId, siteVisibility) →
Site(id, visibility) ON UPDATE CASCADE`, which would propagate visibility but
still not null the name.

**No data fix-up is needed on `Flight`.** Every site that exists today is curated
and becomes public, so every cached name already satisfies the new invariant.

### The denormalization firewall (OQ1)

This is the headline hazard and the sprint's centre of gravity.

**Rule (write side).** One function computes the four denormalized fields, and it
is the only thing in the app allowed to write them:

```ts
// lib/sites/associate.ts
/** The ONLY writer of Flight.{takeoff,landing}Site{Id,Name}. Name is cached only
 *  for public sites — the cache is safe for anyone who can see the flight. */
export function denormalizeSite(match: SiteMatch | null) {
  return {
    siteId: match?.id ?? null,
    siteName: match && match.visibility === "public" ? match.name : null,
  };
}
```

**Rule (read side).** `lib/flights/repo.ts` — which every display read already
goes through — re-hydrates the owner's private names and strips site identity the
viewer may not have:

```ts
/** Rewrites site fields to what THIS viewer may know. Rows with a null siteId are
 *  untouched. Runs one small indexed query, and only when a row has an id but no
 *  cached name (i.e. a private site is in the page) — anonymous list reads of
 *  all-public data cost nothing. */
async function resolveSiteFieldsForViewer<T extends SiteFields>(
  rows: T[], viewerId: string | null,
): Promise<T[]> {
  const unresolved = rows.flatMap(r => [
    r.takeoffSiteId && !r.takeoffSiteName ? r.takeoffSiteId : [],
    r.landingSiteId && !r.landingSiteName ? r.landingSiteId : [],
  ].flat());
  if (unresolved.length === 0) return rows;

  // siteVisibleWhere(viewerId) = { OR: [ {visibility:'public'},
  //   ...(viewerId ? [{ visibility:'private', ownerId: viewerId }] : []) ] }
  const readable = new Map((await prisma.site.findMany({
    where: { id: { in: [...new Set(unresolved)] }, ...siteVisibleWhere(viewerId) },
    select: { id: true, name: true },
  })).map(s => [s.id, s.name]));

  // Unreadable → name stays null AND the id is dropped, so nothing about a site
  // you may not read leaves this module (closes the id-correlation channel too).
  return rows.map(r => ({ ...r, ...patchSite(r, readable) }));
}
```

Applied in `getFlightForViewer` (returns `Flight` — same type, **zero call-site
churn**, so `FlightHeader` and friends need no change), `listOwnFlights`,
`listProfileFlightsForViewer`, `listPublicFlights`, and `listFeedForViewer`.

**Why this shape beats the alternatives:**

| Option | Verdict |
|---|---|
| **Public-safe cache + viewer resolver** (chosen) | Fails safe for code that doesn't exist yet; owner keeps the name everywhere; flight-visibility transitions need **no writes at all**; anonymous/all-public reads stay zero-extra-query. |
| Drop the cache, always resolve | Reinstates a join on every list read — the exact cost the denormalization exists to avoid — and leaves two live landmine columns during the transition. |
| Null the cache for private sites *including* for the owner | Breaks the core promise: "name it and it shows in your logbook." |
| Forbid private sites on non-private flights | Couples two unrelated visibility systems, breaks the moment either changes, and a pilot legitimately wants a private *name* on a public flight. |

**Transitions.** Flight visibility changes require **nothing** — the cache is
viewer-independent by construction. Only *site* visibility changes write, and each
is one bounded `updateMany` over the (now indexed) `takeoffSiteId`/`landingSiteId`,
inside the same transaction as the site update:

| Event | Effect on referencing flights |
|---|---|
| private → public | set cached name = site name |
| public → private | set cached name = `NULL` (owner still sees it via the resolver) |
| public rename | set cached name = new name |
| site deleted | `SetNull` on the id **and** null the cached name — so a cached name always implies a live, public site |

`statsFrom` keeps counting distinct `takeoffSiteId` over the already-viewer-filtered
list. Because unreadable ids are nulled, a stranger's "distinct sites" count
under-reports rather than over-reports. That is the correct direction.

### Viewer-scoped matching (OQ2)

`lib/sites/lookup.ts` splits in two so the geo is genuinely pure, as the intent's
verification strategy assumes:

- **`lib/sites/match.ts` (pure, no DB/Next imports, unit-tested):**
  `bboxFor(lat, lon, radiusM)` and `rankCandidates(lat, lon, radiusM, candidates)`.
  This is also where a **real bug in today's bbox gets fixed**: `lon ± dLon` does
  not wrap, so a site at 179.99° E cannot match a flight at 179.995° E. `bboxFor`
  returns one or two longitude ranges and the query OR's them.
- **`lib/sites/lookup.ts` (thin DB wrapper):**

```ts
export interface SiteMatch {
  id: string; name: string;
  visibility: SiteVisibility;   // NEW — lets denormalizeSite decide in one shot
  ownerId: string | null;       // NEW — attribution
  kind: string; distanceM: number; // NEW — powers the dedup list
}

/** `scope` is REQUIRED and has no default: every existing call site is a compile
 *  error until it says whose sites it may see. */
export async function findSite(
  db: Pick<Db, "site">, lat: number, lon: number,
  kind: "takeoff" | "landing",
  scope: { viewerId: string | null },
): Promise<SiteMatch | null>
```

Callers:
- **`ingestFlight`** passes `{ viewerId: ownerId }` — derived *inside* the seam
  from the owner it already has. **Neither route changes**, so the device-push
  path (which has no interactive UI) inherits correct behaviour for free.
- **`scripts/backfill-sites.ts`** selects `ownerId` and scopes per flight. It
  becomes a thin caller of `resolveSitesForFlight` and is documented as **the
  global re-association sweep** (see [OQ4](#oq4--retroactive-re-association)).

Owner-scoping at write time is right *because* reads are re-scoped: binding
answers "which site is this flight at", the resolver answers "may you know its
name". Two questions, two mechanisms.

**Known, accepted consequence:** a pilot's private site 100 m from a public one
"shadows" it for their own flights, so their viewers see "Unknown site" where a
public name existed. Honest (we never publish a name the pilot didn't publish),
and the 2 km dedup probe makes it rare by steering the pilot to reuse.

### `lib/sites/repo.ts` — the viewer-scoped site seam

Mirrors `lib/flights/repo.ts`. Nothing outside it queries `prisma.site` for
display.

```ts
siteVisibleWhere(viewerId)                     // the ONE predicate, fail-closed
getSiteForViewer(id, viewerId)
listOwnSites(ownerId)                          // /settings/sites
readableSiteNames(ids, viewerId)               // used by the flights repo
suggestNearbySites(lat, lon, kind, viewerId)   // dedup probe, ≤5, ≤2 km, by distance
createSite({ ownerId, name, kind, lat, lon, visibility })
setFlightSite({ flightId, ownerId, which, siteId })   // manual bind / reuse
setSiteVisibility(siteId, ownerId, visibility)        // + re-denormalize
renameSite(siteId, ownerId, name)                     // + re-denormalize
deleteSite(siteId, ownerId)                           // + null cached names
```

Supporting pure modules:

- **`lib/sites/visibility.ts`** — `SITE_VISIBILITIES`, `normalizeSiteVisibility`
  (fail-closed to `"private"`), `canSeeSite(visibility, ownerId, viewerId)`, with
  a unit-tested truth table. Deliberately mirrors `lib/flights/visibility.ts`.
- **`lib/sites/name.ts`** — `normalizeSiteName` / `validateSiteName`
  (see [OQ10](#oq10--naming-rules)).
- **`lib/geo/bearing.ts`** — 8-point compass for "740 m NE".

Constants, in one place: `TAKEOFF_RADIUS_M = 600`, `LANDING_RADIUS_M = 900`
(unchanged), `SUGGEST_RADIUS_M = 2000`, `MAX_SUGGESTIONS = 5`,
`COORD_DECIMALS = 4`, `MAX_SITES_PER_DAY = 25`, `MAX_PUBLIC_SITES_PER_DAY = 10`,
`REASSOCIATE_LIMIT = 500`.

### Server actions & UI

- **`app/flights/[id]/site-action.ts`** (`"use server"`) —
  `suggestSitesAction(flightId, which)`, `createSiteAction(...)`,
  `useExistingSiteAction(flightId, which, siteId)`. Every one asserts
  `getFlightForViewer(flightId, viewerId)` first **and** `ownerId === viewerId`;
  coordinates come from the flight row, never the request body.
- **`components/flight/name-site-dialog.tsx`** (client) — suggestions first, then
  name + Private/Public radio + "Pilots also land/launch here", inline validation
  errors, and explicit consequence copy on the Public option.
- **`components/flight/flight-header.tsx`** — the "Unknown site" headline becomes
  the owner-only entry point (unchanged for non-owners).
- **A landing line on the flight page.** `landingSiteName` is currently rendered
  **nowhere** in the app, so success criterion 1 ("takeoff **or** landing")
  requires a new surface: a small `Landing · <name or Unknown>` line under the
  header, with the same owner-only affordance.
- **`app/settings/sites/page.tsx`** — "Your sites": name, kind, public/private,
  flight count, rename/publish/delete under the dependency rule. Auth-gated; no
  site ids in URLs.

## Implementation

Four ordered, non-overlapping PRs. Each ships its own migration where needed and
passes all five gates (`build`, `test`, `typecheck`, `lint`, `e2e`).

### PR1 — Ownable, scoped sites (no user-visible change)
- Migration `user_sites`: `Site.ownerId` + `visibility` + `updatedAt` +
  `@@index([ownerId])`; `Flight` site-id indexes; the raw-SQL backfill, CHECKs,
  and partial unique index above.
- `lib/sites/match.ts` (pure) + unit tests — radius boundaries at and just outside
  600 m / 900 m, `kind` filtering, bbox-vs-haversine agreement, **antimeridian
  wrap**, high-latitude `cosLat` clamp.
- `lib/sites/visibility.ts` + truth-table unit tests.
- `findSite` gains the required `scope`; `SiteMatch` gains
  `visibility`/`ownerId`/`kind`/`distanceM`.
- `lib/sites/repo.ts` with `siteVisibleWhere`, `getSiteForViewer`, `listOwnSites`.
- Update both `ingestFlight` call sites and `scripts/backfill-sites.ts`;
  `prisma/seed.ts` sets `visibility: "public"`, `ownerId: null` explicitly.
- Integration tests: a private site never matches a stranger's ingest; it does
  match its owner's; public matches everyone; curated behaviour unchanged
  (existing `lookup.test.ts` still green).
- **Depends on:** nothing.

### PR2 — The denormalization firewall (the security PR)
- `lib/sites/associate.ts`: `denormalizeSite` + `resolveSitesForFlight` — the
  single writer of the four cached fields. Ingest and the backfill script both
  route through it.
- `lib/flights/repo.ts`: `resolveSiteFieldsForViewer` wired into
  `getFlightForViewer`, `listOwnFlights`, `listProfileFlightsForViewer`,
  `listPublicFlights`, `listFeedForViewer`.
- `setSiteVisibility` / `renameSite` / `deleteSite` re-denormalization writers
  (transactional `updateMany` over the new indexes).
- Fix `test/feed.integration.test.ts:52`, which fabricates a `takeoffSiteName`
  with no `takeoffSiteId` — now a CHECK violation and a hole in the invariant.
- **Tests — the heart of the sprint** (`test/sites.integration.test.ts`):
  - **Matrix:** owner / friend / stranger / anonymous × private site / public site
    × flight `private` / `friends` / `public` × takeoff + landing, asserted on
    the flight gate, logbook, profile list, and feed.
  - **Leak sweep:** over the suite's fixtures, assert no flight row carries a
    cached name whose site is not public — the invariant the DB cannot express.
  - **Transitions:** promote → name appears for everyone; demote → name vanishes
    for everyone *but* the owner; rename → propagates; delete → id and name both
    clear; flight visibility flipped in both directions changes **nothing** about
    site names.
  - **Fail-closed discipline:** every "denied" assertion is paired with a positive
    control in the same test, so an empty result cannot pass vacuously.
- **Depends on:** PR1. **Still no way to create a site** — by design: the read
  path that hides a private site is proven before anything can make one.

### PR3 — Name this site (create, dedup, re-associate)
- `lib/sites/name.ts` + unit tests (normalization, length, charset, reserved
  words, folding).
- `lib/sites/repo.ts`: `suggestNearbySites`, `createSite` (validation → same-name-
  within-2 km conflict → per-pilot daily cap → insert → re-associate, one
  transaction), `setFlightSite`, `reassociateOwnFlights` (capped at 500, the cap
  **logged, never silent**).
- `app/flights/[id]/site-action.ts`; `components/flight/name-site-dialog.tsx`;
  owner-only affordances on the takeoff headline **and the new landing line**;
  `lib/geo/bearing.ts`.
- Structured log line on every create / bind (owner, site id, visibility, coords).
- Tests: create private and public; each validation rejection; dedup surfaces a
  candidate and reuse binds without inserting; reuse across a kind mismatch is
  allowed (manual bind ignores `kind`); own older flights re-associate and others'
  do not; a non-owner cannot name a site on someone else's flight; the daily cap
  refuses; a flight with no takeoff fix offers no affordance.
- **Depends on:** PR2.

### PR4 — Your sites + release pass
- `app/settings/sites/page.tsx` + actions: rename / publish / delete, each guarded
  by the **dependency rule** (allowed only while no other pilot's flight
  references the site) and each re-denormalizing.
- `scripts/admin-sites.ts` — operator remedy: rename, force-private, merge two
  sites (re-point flights, re-denormalize, delete the loser).
- `scripts/backfill-sites.ts` documented as the global re-association sweep.
- **E2E** `test/e2e/sites.spec.ts`: upload a flight far from every curated site →
  "Unknown site" → name it public → headline updates → upload a second nearby
  flight → auto-associates with no interaction.
- `lib/whats-new.ts` entry (newest first), `FEATURES.md` moved to completed,
  `docs/architecture.md` gains the site privacy seam, `/qa-prompt` handoff.
- **Depends on:** PR3.

## Files Summary

**New:** `lib/sites/match.ts` (+ test), `lib/sites/visibility.ts` (+ test),
`lib/sites/name.ts` (+ test), `lib/sites/repo.ts`, `lib/sites/associate.ts`,
`lib/geo/bearing.ts` (+ test), `components/flight/name-site-dialog.tsx`,
`app/flights/[id]/site-action.ts`, `app/settings/sites/page.tsx` + `actions.ts`,
`scripts/admin-sites.ts`, `test/sites.integration.test.ts`,
`test/e2e/sites.spec.ts`, `prisma/migrations/*_user_sites/`,
`prisma/migrations/*_site_name_cache_checks/`.

**Modified:** `prisma/schema.prisma` (`Site.ownerId`/`visibility`/`updatedAt`,
`Profile.ownedSites`, Flight site-id indexes), `lib/sites/lookup.ts` (required
scope, richer `SiteMatch`, pure geo extracted), `lib/flights/repo.ts` (site-field
resolver on all five reads), `lib/ingest/ingest-flight.ts` (scoped lookup via
`resolveSitesForFlight`), `scripts/backfill-sites.ts` (owner-scoped, shared
writer), `prisma/seed.ts` (explicit visibility), `components/flight/flight-header.tsx`
(owner affordance), `app/flights/[id]/page.tsx` (landing line),
`test/feed.integration.test.ts` (real site id), `lib/whats-new.ts`, `FEATURES.md`,
`docs/architecture.md`.

**Unchanged on purpose:** `app/api/upload/route.ts`, `app/api/ingest/route.ts`
(the seam absorbs scoping), `lib/prisma.ts` (no site URLs → the short-id decision
is not reopened), `lib/flights/visibility.ts`.

## Definition of Done

- [ ] `Site` has `ownerId` + `visibility`; curated seeds are `ownerId = null`,
      `visibility = "public"`; CHECKs, the partial unique index, and the
      name-implies-id CHECKs are present and the Prisma-v6 drift is documented.
- [ ] `findSite` requires an explicit scope; **no call site compiles without one**;
      `ingestFlight` scopes to the flight owner and **both routes are unchanged**,
      so device-push behaves identically to web upload.
- [ ] Pure geo lives in `lib/sites/match.ts` with **no DB/Next imports** and unit
      tests covering radius boundaries, `kind` filtering, bbox-vs-haversine
      agreement, **antimeridian wrap**, and high-latitude `cosLat`.
- [ ] `Flight.{takeoff,landing}SiteName` is written **only** by
      `lib/sites/associate.ts` and **only** for public sites; the leak sweep in
      the integration suite proves no row violates it.
- [ ] A private site is invisible to everyone but its owner — in matching, in
      suggestions, and **through a public or friends-visible flight's site name** —
      proven by the owner/friend/stranger/anonymous × private/public matrix, with
      a positive control paired to every denial.
- [ ] Site identity (id **and** name) never leaves `lib/flights/repo.ts` for a
      viewer who may not read the site.
- [ ] Site visibility transitions (promote / demote / rename / delete) update every
      referencing flight transactionally; changing a **flight's** visibility
      requires no site write and changes no site name.
- [ ] An owner can name an unknown **takeoff** and an unknown **landing** in place
      on the flight page; the flight page (incl. the new landing line), logbook,
      profile, and feed all show the new name immediately.
- [ ] Creating near an existing visible site **offers reuse first** (≤5 candidates,
      ≤2 km, with distance and bearing); reuse binds without inserting; a
      same-name-within-2 km conflict is refused with a steer to reuse.
- [ ] A later flight — web or device — auto-associates with the site and shows the
      name with no interaction; the creator's own older unmatched flights are
      re-associated on create (capped and logged); **other pilots' existing
      flights are not** touched.
- [ ] Name validation: normalization, 2–60 chars, script-agnostic charset, no
      control/bidi characters, reserved words (incl. "Unknown site") refused; no
      global name uniqueness.
- [ ] Per-pilot daily creation caps enforced; every create/bind emits a structured
      log line.
- [ ] `/settings/sites` lists your sites with rename / publish / delete under the
      dependency rule; `scripts/admin-sites.ts` gives the operator rename / merge /
      force-private.
- [ ] No site read for display outside `lib/sites/repo.ts` — audited allowlist
      (owner-scoped writes permitted), same discipline as the flight audit.
- [ ] **CI provisions Postgres and the sites matrix actually runs** (does not skip).
- [ ] All five gates green; `/whats-new` entry added; `FEATURES.md` updated;
      `docs/architecture.md` documents the site privacy seam; `/qa-prompt` handed
      to the validator partner.
- [ ] Deferred items *not* shipped: moderation UI, site pages/URLs, browse/search,
      `Profile.homeSiteId`, friends-tier sites, cross-pilot retroactive
      re-association, adjustable coordinates.

## Risks

- **A private site name leaking through a cached column (highest).** A read path
  ships `takeoffSiteName` to the wrong viewer. *Mitigation:* the cache is
  public-safe by construction, so the failure mode is "owner sees Unknown" (benign)
  rather than "stranger sees a private name" (the breach); one writer; one
  resolver; the matrix plus the leak sweep; CI runs both.
- **A new surface reads `prisma.site` or the raw column directly.** *Mitigation:*
  repo-only invariant extended to sites, audited allowlist, and the fact that the
  raw column is safe even when misused.
- **Community vandalism / bad public names.** One pilot's joke becomes everyone's
  logbook headline, and there is no moderation surface. *Mitigation, and an
  accepted residual risk:* attribution, per-pilot daily cap, name validation, the
  dependency rule (you cannot rename a site others depend on), and an operator
  remedy script. Logged as accepted; a report affordance is the first follow-up if
  it bites.
- **Near-duplicate proliferation.** Every pilot names "the ridge" slightly
  differently. *Mitigation:* a 2 km suggest radius (deliberately wider than the
  match radius), same-name-nearby rejection, and an operator merge; residual
  duplicates are a data-quality issue, not a correctness one.
- **Private-site shadowing.** A private site hides a nearby public name from a
  flight's viewers. *Mitigation:* the dedup probe steers reuse; documented, accepted.
- **Publishing a coordinate from a private flight.** Creating a public site from a
  private flight publishes a location. *Mitigation:* explicit consequence copy, and
  coordinates rounded to 4 dp so the site row is not a byte-exact fingerprint of
  one pilot's launch fix.
- **Re-association cost.** A create triggers an unbounded scan. *Mitigation:*
  owner-scoped, bbox-prefiltered, capped at 500 with the cap logged.
- **Transition drift.** A promote/rename half-updates the cache. *Mitigation:*
  site update + `updateMany` in one transaction; the leak sweep catches drift.

## Security (privacy / authz)

- **Invariant 1:** site read scoping lives **exclusively** in `lib/sites/repo.ts`
  (`siteVisibleWhere`), fail-closed — unknown visibility → private; no viewer →
  public only; a private site with a null owner is readable by nobody.
- **Invariant 2:** `Flight.{takeoff,landing}SiteName` is a **public-safe cache**,
  written only by `lib/sites/associate.ts`, and site identity is re-scoped for the
  viewer in `lib/flights/repo.ts` before leaving it.
- **Write-time vs read-time scoping are separate and both explicit.** Ingest binds
  within `public ∪ owner's private`; display re-scopes to the viewer.
- **Mutations gated by reads:** every site action asserts
  `getFlightForViewer(...) !== null` *and* owner identity first; coordinates are
  read from the flight row, never accepted from the client; site ids from the
  client are re-checked against `siteVisibleWhere` before binding.
- **Honest scope of the guarantee:** a private site protects the **name and the
  site row** — not the flight's coordinates, which continue to follow *flight*
  visibility exactly as today. Launch-coordinate obfuscation remains the deferred
  item it has been since SPRINT-001; this sprint neither adds nor removes it.
- **Untrusted text:** site names are user content rendered as a page headline —
  normalized, validated, length-capped, and stripped of control/bidi characters
  (the homograph vector for a shared gazetteer); React escaping does the rest.
- **Abuse:** signed-in + onboarded pilots only; per-pilot daily caps; attribution
  on every user site; structured logging. Shared-store rate limiting stays the
  existing tracked backlog item.
- **Tests are the contract, and CI must run them** — a skipped sites matrix means
  the privacy work is unverified.

## Dependencies

- **Internal:** PR2 ⟵ PR1; PR3 ⟵ PR2; PR4 ⟵ PR3. Strictly sequential — the
  ordering is itself a safety property (nothing can create a private site before
  the read path that hides one is proven).
- **External/stack:** **none new.** No packages, no services. Prisma v6 (pinned),
  NextAuth v5, Postgres on Railway, existing `components/ui/*`. CI's Postgres
  service and `pnpm db:seed` step already exist.
- **Test data:** the existing ≥3-pilot fixture set, plus an IGC fixture launching
  well away from all 12 curated sites (so "Unknown site" is reachable) and a second
  fixture within 600 m of it (so auto-association is observable).

## Open Questions (answered)

Numbering matches `SPRINT-004-INTENT.md`.

### OQ1 — The denormalization leak
**Narrow the cached column to public sites only, and re-hydrate the owner's names
in the viewer-scoped repo.** Private site → id set, name `NULL`. Rejected:
resolve-always (reinstates the join the cache exists to avoid), null-for-everyone
(breaks the owner's own logbook), forbid-private-on-non-private-flights (couples
two unrelated visibility systems and breaks on any transition). **Transitions:**
changing a *flight's* visibility requires no write at all — that is the property
that makes this design safe. Changing a *site's* visibility (or name, or deleting
it) is one transactional `updateMany` over the newly indexed site-id columns. Full
argument and comparison table in
[The denormalization firewall](#the-denormalization-firewall-oq1).

### OQ2 — Viewer-scoping `findSite`
`findSite(db, lat, lon, kind, scope)` with `scope` **required and defaultless**, so
every call site is a compile error until made explicit. `ingestFlight` derives
`{ viewerId: ownerId }` from the owner it already holds — **both routes are
untouched**, which is what keeps the device path (no UI to fall back on) correct.
`scripts/backfill-sites.ts` selects `ownerId` and scopes per flight. Owner-scoping
at write time **is** the right notion, precisely because the reader question is
answered separately by the read-time resolver. `SiteMatch` also returns
`visibility`, `ownerId`, `kind`, and `distanceM` so the caller can denormalize
safely and the dedup UI has what it needs.

### OQ3 — Public site creation: open or gated?
**Immediate publication; no moderation queue in v1** — the product has no reviewer
role and building one costs more than it protects at this scale. Bounded instead
by: signed-in-and-onboarded only, attribution (`ownerId`, shown as "added by
@handle"), name validation, and a per-pilot cap (25 sites/day, 10 public/day).
**Edit rights follow a dependency rule:** *you may rename, unpublish, or delete a
site until another pilot's flight depends on it.* After that it is community
property — because a rename silently rewrites the headline of someone else's
logbook entry, which is not a right one pilot should hold over another's records.
**A moderation surface is an explicit non-goal, but "no remedy" is not
acceptable:** `scripts/admin-sites.ts` gives the operator rename / merge /
force-private. Risk accepted and logged; a report affordance is the first
follow-up.

### OQ4 — Retroactive re-association
**On create: the creating flight plus the creator's own unmatched flights within
the radius, synchronously, in the same transaction, capped at 500 and logged.**
Bounded by `ownerId` + bbox, so it is a small indexed query at pilot scale.
**Not other pilots' flights, even for a public site** — relabelling hundreds of
strangers' logbook headlines from one person's action is surprising, needs a
background worker the app doesn't have, and is the sharpest abuse amplifier. Going
forward, new flights match on ingest, which is what the success criterion asks
for. **`scripts/backfill-sites.ts` becomes the global sweep:** now owner-scoped
per flight, sharing `resolveSitesForFlight`, still idempotent (only touches
flights with no site), run by the operator when a batch of good public sites
appears.

### OQ5 — Dedup / snap-to-existing UX
**The reuse radius must be wider than the match radius, or the feature is a
no-op** — the dialog only opens because `findSite` already returned null, so by
construction nothing sits within 600 m / 900 m. Use `SUGGEST_RADIUS_M = 2000`,
≤5 candidates, sorted by distance, each shown as "Ed Levin — 740 m NE · takeoff ·
public" with a **Use this site** button. The naming form sits below, always
available — never block, never silently reuse. Reuse performs a **manual bind**,
which deliberately ignores `kind` (the pilot knows better than the radius; `kind`
governs *automatic* matching only). On submit, a normalized name matching a
visible site within 2 km is refused with a steer to reuse.

### OQ6 — Which coordinate is the site's?
**The flight's exact takeoff/landing fix, rounded to 4 decimals (~11 m). No map
picker in v1.** 11 m is far below anything a 600 m matcher can use, so the
rounding costs nothing — and it buys something real: creating a **public** site
from a **private** flight would otherwise publish a coordinate that byte-matches
that private flight's takeoff fix, a gratuitous correlation handle. A drag-to-
adjust marker is a whole interaction for accuracy the matcher cannot exploit;
deferred, along with the better long-term answer (refine a site's coordinate to
the centroid of the flights bound to it).

### OQ7 — Site `kind`
**Create with the kind you named it from — `takeoff` or `landing`, never `both` by
default.** The seed's heavy use of `"both"` is a curated judgment; a pilot naming
their launch has asserted nothing about landing there, and defaulting to `both`
widens matching to the 900 m landing radius and manufactures false landings.
The creator may opt in at creation ("Pilots also land here" → `both`) and may
change it later under the dependency rule. **No automatic promotion** — letting
any pilot mutate a public site's semantics by landing near it is a write to shared
state without consent. A pilot who lands near a takeoff-only site can either
manually bind to it (allowed, `kind` is ignored for manual binds) or name their own
LZ; residual duplicates are an operator merge, not a correctness bug.

### OQ8 — Surface area
**No `/sites/<id>` pages, no browse, no search in v1.** Sites stay plumbing that
surfaces as a name on a flight, the create dialog, and the suggestion list. A site
page is a new public surface with its own visibility matrix (whose flights does it
list?) that no success criterion requires. Consequently **`lib/prisma.ts`'s "only
`Flight` is URL-visible" is not reopened** — no site id ever appears in a URL
(management actions take it in the body). The one management need — a pilot must
be able to fix a typo in their own site — is met by an auth-gated
`/settings/sites`. Note that this sprint *does* add one new render surface: the
flight page's **landing site line**, which does not exist today.

### OQ9 — `Profile.homeSiteId`
**Explicitly out of scope; leave the column dormant** (with a schema comment
saying so). A home site is the most sensitive location fact the app could hold —
persistent, self-asserted, and attached to a public handle — so it deserves its own
privacy design rather than a free ride on this sprint. Wiring it now would add a
second name-leak path (a private site as home site rendering on `/@handle`) to the
review surface of the very PR that is closing the first one. Do not drop the
column (a migration with no benefit); when it ships, it must go through
`readableSiteNames` like everything else. Logged in `FEATURES.md`.

### OQ10 — Naming rules
All in `lib/sites/name.ts` (pure, unit-tested):
- **Normalize:** Unicode NFC → trim → collapse internal whitespace → strip control
  characters and zero-width/bidi controls (U+200B–U+200F, U+202A–U+202E,
  U+2066–U+2069). Bidi/zero-width stripping is not pedantry — it is the homograph
  and spoofing vector for a name every pilot will read.
- **Length:** 2–60 characters after normalization (the longest curated name is 23).
- **Charset:** letters of **any script**, digits, spaces, and `' - – ( ) . , / &`.
  This is an international sport; ASCII-only would be wrong. Reject names with no
  letter or digit at all (kills "———" and emoji-only) and leading/trailing
  punctuation.
- **Reserved:** case-insensitively reject `unknown site`, `unknown`, `unnamed`,
  `none`, `null`, `n/a`, and anything normalizing to empty.
- **Uniqueness: none globally.** Real gazetteers have many "Le Col", and a global
  unique name would let the first creator squat a common one. Uniqueness is
  **proximity-scoped**: reject a case- and diacritic-folded name match against a
  *visible* site within 2 km — same name plus same place means it is the same
  site, so reuse it. A partial unique index on `(ownerId, lower(name), kind) WHERE
  source = 'user'` is the DB backstop against one pilot double-submitting.
