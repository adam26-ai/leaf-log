# SPRINT-004 — User-generated site locations

> Independent Codex draft from
> [`SPRINT-004-INTENT.md`](./SPRINT-004-INTENT.md). Do not treat this as a merged
> plan until the multi-agent review has reconciled the competing drafts.

## Overview

This sprint lets a pilot turn an "Unknown site" on their own flight into a named
takeoff or landing site. The site can be **public**, shared into the community
gazetteer, or **private**, visible only to that pilot. Future ingestion then
auto-associates nearby flights with visible sites instead of repeatedly showing
"Unknown site", and creation offers to reuse an existing visible site before
creating a near-duplicate.

The sprint's security center is the existing denormalized
`Flight.takeoffSiteName` / `landingSiteName` pair. Those columns were safe when
all sites were curated and public. Once private sites exist, they must become a
**public-name cache only**:

1. Public and curated sites may cache their names on `Flight`.
2. Private sites may be linked by `takeoffSiteId` / `landingSiteId`, but their
   cached name columns are always `null`.
3. Every viewer-facing flight read resolves safe display site names and safe site
   ids in `lib/flights/repo.ts`, using site visibility. If the viewer cannot read
   the site, the repo returns `null` for both id and name, so the UI renders
   "Unknown site".

That keeps flight visibility and site visibility independent. A pilot can make a
flight public while keeping their private launch name private; public viewers see
the flight but not the private site label.

**Committed scope:**
1. Site ownership + `private` / `public` visibility on `Site`, with a central
   fail-closed normalizer and DB CHECK constraints.
2. Viewer-scoped site lookup: public sites plus the viewer's own private sites.
   Ingestion scopes lookup to the flight owner for both web upload and device
   push.
3. Owner-only "name this takeoff / landing" UI on the flight page, including
   public/private choice and reuse suggestion for visible nearby sites.
4. Immediate re-association of the current flight, plus a bounded owner-only
   pass over that pilot's unmatched flights. Global public backfill remains an
   operator script, not request-time work.
5. Privacy, ingest-path, and Playwright tests that CI actually runs against
   Postgres.

**Explicitly out of scope for v1:**
- `/sites/<id>` pages, site browse/search, short ids for sites.
- Public moderation/report queues, admin UI, community editing, merge workflows.
- User-facing rename/delete for public sites after creation.
- Pilot-adjustable map markers.
- Wiring `Profile.homeSiteId`.
- Launch-coordinate obfuscation beyond the already documented future privacy-zone
  work.

## Use Cases

1. **Name an unknown takeoff.** The owner opens a ready flight whose takeoff has no
   visible site, enters a name, chooses Public or Private, and saves without
   leaving the flight page.
2. **Name an unknown landing.** Same flow for landing coordinates. The page gains a
   compact landing-site row if one is not already visible elsewhere.
3. **Reuse a nearby visible site.** If the coordinate is near a public site or the
   pilot's own private site, the UI recommends reusing it. Accepting the reuse
   links the flight to that site instead of creating a duplicate.
4. **Public site helps everyone later.** A later web upload or device-pushed
   flight from any pilot auto-associates with a public site inside the existing
   kind-specific radius.
5. **Private site helps only its owner later.** A later web upload or device-pushed
   flight from the same pilot auto-associates with that pilot's private site. A
   different pilot at the same coordinates sees only public candidates.
6. **Private site stays private on visible flights.** If the owner makes a flight
   public or friends-only, viewers who can see the flight but not the private site
   see "Unknown site" and receive no private site id.
7. **Site publication transition is safe.** If a future site-promotion flow makes
   a private site public, publication happens through one repo function that first
   flips the site to public and then fills the public cache on linked flights in
   the same transaction.

## Architecture

### Data model

Extend `Site` into an owned, visibility-scoped entity while preserving the curated
seed rows:

```prisma
model Site {
  id             String   @id @default(cuid())
  name           String
  normalizedName String
  kind           String   @default("unknown") // takeoff | landing | both | unknown
  lat            Float
  lon            Float
  countryCode    String?
  region         String?
  source         String   @default("manual")  // manual | user
  sourceId       String?
  sourceUrl      String?
  license        String?

  ownerId        String?
  owner          Profile? @relation("OwnedSites", fields: [ownerId], references: [id], onDelete: SetNull)
  visibility     String   @default("public")  // public | private

  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  // existing flight/home relations...

  @@index([lat, lon])
  @@index([visibility, ownerId])
  @@index([ownerId, visibility, normalizedName])
}
```

Curated seed rows become `visibility='public'`, `ownerId=null`, `source='manual'`,
`license='curated'`. User-created rows use `source='user'`; public user rows are
immediately visible to everyone, while private rows require `ownerId`.

Raw-SQL CHECK constraints are appended to the hand-written migration, following
the Sprint 003 pattern:

- `Site.visibility IN ('private','public')`
- `Site.kind IN ('takeoff','landing','both','unknown')`
- `Site.source IN ('manual','user')`
- private sites require an owner: `visibility <> 'private' OR ownerId IS NOT NULL`

Prisma v6 cannot express these CHECKs; migration drift is expected and documented
in the SQL comment.

### Site privacy and lookup

Add `lib/sites/visibility.ts`:

```ts
export const SITE_VISIBILITIES = ["private", "public"] as const;
export type SiteVisibility = (typeof SITE_VISIBILITIES)[number];

export function normalizeSiteVisibility(v: unknown): SiteVisibility {
  return (SITE_VISIBILITIES as readonly unknown[]).includes(v)
    ? (v as SiteVisibility)
    : "private";
}

export function canSeeSite(
  visibility: SiteVisibility,
  ownerId: string | null,
  viewerId: string | null,
): boolean {
  if (visibility === "public") return true;
  return Boolean(viewerId && ownerId && viewerId === ownerId);
}
```

Move pure radius and ranking logic into `lib/sites/geo.ts` so it remains free of
DB and Next imports. Keep the existing radii exactly as the production matcher:
600 m for takeoffs, 900 m for landings.

Change lookup from an unscoped helper:

```ts
findSite(db, lat, lon, kind)
```

to an explicitly scoped helper:

```ts
findSite(db, {
  lat,
  lon,
  kind,
  viewerId,
}: {
  lat: number;
  lon: number;
  kind: "takeoff" | "landing";
  viewerId: string | null;
})
```

Its candidate query is:

```ts
AND kind in (requested kind, "both")
AND (
  visibility = "public"
  OR (visibility = "private" AND ownerId = viewerId)
)
```

`ingestFlight()` passes `viewerId: ownerId`. That is the right write-time scope:
the association records what the flight owner can name for their own flight. Read
time remains separately scoped, so a private association does not imply public
display.

### Viewer-safe flight site fields

`lib/flights/repo.ts` remains the only display-read gate for flights. It must also
become the only place that turns linked sites into viewer-safe display fields.

The repo should stop returning raw `Flight` rows directly to UI components. Use
viewer-safe DTOs for list and detail reads, with these semantics:

- `takeoffSiteId` / `landingSiteId` are `null` unless the viewer may see the
  linked site.
- `takeoffSiteName` / `landingSiteName` are the visible linked site name when the
  viewer may see it.
- If the linked site is public, the cached `Flight.*SiteName` may be used as the
  fast path but must agree with the site row when backfilled.
- If the linked site is private and visible to the owner, the name is resolved
  from the joined `Site` row, not from `Flight.*SiteName`.
- If the linked site is private and not visible to the viewer, both id and name
  are `null`.

The denormalized columns are retained, but redefined as **public cache columns**.
Writes use one helper, for example `siteCachePatch(site, endpoint)`, that sets the
cache to the site name only for public sites and sets it to `null` for private
sites. No route, server action, or script writes those columns directly.

### Creating and attaching sites

Site creation lives in a server-only core, not in route/page code:

```ts
createOrAttachSiteFromFlight({
  flightId,
  ownerId,
  endpoint: "takeoff" | "landing",
  mode: "reuse" | "create",
  existingSiteId?,
  name?,
  visibility?,
})
```

The core:

1. Loads the flight owner-scoped and confirms it has a coordinate for the endpoint.
2. Runs visible-site candidate lookup first.
3. If reusing, verifies the chosen site is visible to the owner.
4. If creating, validates and normalizes the name, rounds the coordinate, inserts
   the `Site`, and links the current flight in one transaction.
5. Uses the public-cache helper so private names are never denormalized.
6. Revalidates the flight page, logbook, profile, and feed paths affected by that
   flight.

The UI flow is deliberately small: owner-only inline control on the flight page
where "Unknown site" appears. If a visible match is inside the normal match radius,
"Use existing site" is the primary action and creating a new site is secondary. If
nearby visible sites exist outside the match radius but inside the duplicate
advisory radius, the UI warns before allowing creation.

### Retroactive association

Request-time work is bounded:

- Always link the current flight synchronously.
- Also scan up to 200 of the creator's own ready flights missing that endpoint and
  attach those that match the new/reused site under the normal radius.
- Do not scan every pilot's history in the request path, even for a public site.

`scripts/backfill-sites.ts` becomes the operator path for larger sweeps. It must
select each flight's `ownerId`, call scoped lookup with `viewerId: ownerId`, and
write public cache columns only through the shared helper. Add flags:

- default: only fill missing site ids
- `--site-id <id>`: backfill flights matching one newly public site
- `--public-only`: ignore private sites for a community-wide public-site sweep

### Naming and coordinates

Names are normalized as NFKC, trimmed, whitespace-collapsed, and compared via a
lowercase `normalizedName`. v1 allows normal place-name punctuation and Unicode
letters/numbers, rejects control characters and angle brackets, and requires a
length of 2-80 characters after normalization. Reserved values include
`unknown`, `unknown site`, `takeoff`, `landing`, `private`, and `public`.

Do not add a global unique name constraint. Place names repeat around the world;
geo matching and duplicate suggestions are the v1 duplicate guard.

Site coordinates come from the flight endpoint rounded to 4 decimal places
(roughly 11 m latitude; smaller than the match radius but less exact than the raw
fix). Pilot-adjustable markers are deferred.

Site kind is endpoint-specific on create: takeoff creates `kind='takeoff'`;
landing creates `kind='landing'`. If a visible existing site is explicitly reused
from the opposite endpoint, widen `kind` to `both`. Never narrow kind in v1.

## Implementation

Ordered so the privacy invariant lands before user-facing creation.

### PR1 — Site schema, visibility core, and viewer-safe flight DTOs
- Migration `site_visibility`: add `Site.ownerId`, `visibility`,
  `normalizedName`, `updatedAt`, relations, indexes, and raw-SQL CHECKs. Backfill
  existing curated rows to `public` with normalized names.
- `lib/sites/visibility.ts` with fail-closed normalizer and `canSeeSite`.
- `lib/sites/name.ts` with normalization, validation, and reserved-name checks.
- `lib/flights/repo.ts`: return viewer-safe flight DTOs for detail, profile,
  logbook, and feed reads; sanitize inaccessible site ids and names.
- Redefine `Flight.takeoffSiteName` / `landingSiteName` as public-cache columns
  in comments and helper code; clear cache on private-site association.
- Update `FlightHeader` / `FlightRow` only as needed to consume the repo DTOs,
  keeping the existing `"Unknown site"` fallback.
- Tests: `normalizeSiteVisibility`, `canSeeSite`, name validation, and the
  denormalized-name matrix proving private site name/id are absent for friend,
  stranger, and anonymous viewers of a visible flight.

### PR2 — Scoped lookup, ingest, and backfill
- Split pure matcher pieces into `lib/sites/geo.ts`; keep unit tests for bbox,
  haversine ranking, radius boundaries, kind filtering, high latitude, and
  antimeridian behavior.
- Change `findSite` to take `{ lat, lon, kind, viewerId }` and return only public
  sites plus the viewer's own private sites.
- `lib/ingest/ingest-flight.ts`: pass `viewerId: ownerId` for both takeoff and
  landing lookup; write cache columns through the public-cache helper.
- Ensure both ingestion callers still need no UI fallback: web upload and device
  push get the same owner-scoped behavior.
- `scripts/backfill-sites.ts`: select `ownerId`, call scoped lookup, support the
  flags listed above, and never write private names into cache columns.
- Integration tests: device-pushed flight resolves a public site; resolves the
  owner's private site; does not resolve a stranger's private site; public/friends
  flight display still hides private site labels from unauthorized viewers.
- Depends on PR1.

### PR3 — Owner creates or reuses a site from the flight page
- `lib/sites/repo.ts` or `lib/sites/create-site.ts` with
  `createOrAttachSiteFromFlight`, candidate lookup, reuse validation, transaction
  boundaries, kind widening to `both` on explicit opposite-endpoint reuse, and
  bounded owner re-association.
- `app/flights/[id]/site-action.ts`: owner-only server action; no raw Prisma site
  writes in the page.
- `components/flight/site-name-control.tsx`: inline owner-only affordance for
  unknown takeoff and landing sites; public/private selector; reuse suggestion
  state; per-field validation errors.
- `components/flight/flight-header.tsx`: show takeoff name as today, and add a
  compact landing-site line/control so landing creation is reachable in v1.
- Tests: owner can create public/private takeoff and landing sites; non-owner
  cannot mutate; reuse visible site; cannot reuse invisible private site; name
  validation; duplicate advisory behavior.
- Depends on PR1 and PR2.

### PR4 — Privacy matrix, e2e, and release pass
- `test/sites.integration.test.ts`: owner / friend / stranger / anonymous x
  private site / public site x lookup candidate / visible flight display. Include
  fail-closed assertions that distinguish "no rows returned" from "right rows
  returned".
- Expand ingest-path tests and update existing privacy/feed tests for sanitized
  site DTOs.
- Playwright: upload or seed a flight with unknown site, name it from the flight
  page, see it render, upload a second nearby flight, see auto-association. Cover
  private-site owner display and public-viewer "Unknown site" on a visible flight.
- CI: keep the Postgres service mandatory for integration tests; a skipped site
  privacy suite is a failed sprint.
- Add `lib/whats-new.ts` entry and update `FEATURES.md` with shipped/deferred
  notes.
- Depends on PR1, PR2, and PR3.

## Files Summary

**New:** `lib/sites/visibility.ts`, `lib/sites/name.ts`,
`lib/sites/geo.ts`, `lib/sites/repo.ts` or `lib/sites/create-site.ts`,
`components/flight/site-name-control.tsx`,
`app/flights/[id]/site-action.ts`, `test/sites.integration.test.ts`,
`prisma/migrations/*site_visibility*/`.

**Modified:** `prisma/schema.prisma`, `prisma/seed.ts`,
`lib/sites/lookup.ts` + tests, `lib/ingest/ingest-flight.ts`,
`lib/flights/repo.ts`, `components/flight/flight-header.tsx`,
`components/logbook/flight-row.tsx`, `scripts/backfill-sites.ts`,
`test/privacy.integration.test.ts`, ingest/device tests, Playwright e2e,
`lib/whats-new.ts`, `FEATURES.md`.

**Not modified in v1:** `lib/prisma.ts` short-id extension, because sites do not
get URLs; `Profile.homeSiteId` UI, because home sites stay deferred.

## Definition of Done

- [ ] A flight owner can name an unknown takeoff or landing site from the flight
      page and choose public or private.
- [ ] Saving links the current flight immediately; the flight page, logbook,
      profile, and feed render the correct viewer-safe site display after
      revalidation.
- [ ] Public sites are matched by later uploads and device-pushed flights from any
      pilot; private sites are matched only for the owning pilot.
- [ ] Creating near a visible existing site offers reuse first; accepting reuse
      links to the existing site instead of creating a duplicate.
- [ ] `Flight.*SiteName` caches only public site names. Private site associations
      have `null` cached names, and inaccessible private site ids/names are
      stripped in `lib/flights/repo.ts`.
- [ ] Flight visibility transitions cannot leak private site names. A public or
      friends-visible flight with a private site shows "Unknown site" to viewers
      who cannot read that site.
- [ ] Site lookup, creation, and all site display reads are app-layer scoped. No
      page or route performs ad-hoc private-site authorization.
- [ ] Unit tests cover geo radii, kind matching, bbox-vs-haversine behavior,
      high-latitude/antimeridian cases, and name normalization/validation.
- [ ] Postgres integration tests cover the site privacy matrix and ingest paths;
      CI provisions Postgres so the suite cannot silently skip.
- [ ] Playwright covers the happy path: unknown flight -> name site -> render ->
      second nearby upload auto-associates.
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm e2e`
      are green before PR/merge.
- [ ] `/whats-new` and `FEATURES.md` are updated; deferred moderation, site pages,
      home site wiring, and marker adjustment are explicitly logged.

## Risks

- **Denormalized private-site leak (highest).** A cached private site name on a
  public/friends flight would silently leak. Mitigation: redefine the cache as
  public-only, centralize cache writes, sanitize names and ids in `repo.ts`, and
  test the matrix.
- **Unscoped lookup.** Leaving any old `findSite(prisma, lat, lon, kind)` call
  around would let one pilot match another pilot's private site. Mitigation:
  signature requires `viewerId`; TypeScript breaks all callers.
- **Public UGC quality.** Immediate public creation can introduce typos, jokes, or
  duplicates. Mitigation: strict naming, reuse-first UX, public edit/moderation
  deferred but risk accepted for v1.
- **Request-time backfill cost.** A public site could match many historical
  flights. Mitigation: current flight plus bounded owner scan only; global sweep
  remains an operator script.
- **Kind widening side effects.** Changing a public site to `both` increases future
  match surface. Mitigation: only widen on explicit reuse from the opposite
  endpoint; never automatic background widening.
- **Per-viewer cache.** Profile/feed/logbook rows differ by viewer because private
  site names differ by viewer. Mitigation: keep dynamic/no-store behavior from
  Sprint 003 and compute display names in viewer-scoped repos.
- **Coordinate sensitivity.** Public user sites reveal launch/landing locations.
  Mitigation: explicit public/private choice, private default in the create form,
  rounded stored coordinates, and no browse/search in v1.

## Security

- **Invariant:** private site names and ids are never returned to a viewer unless
  `canSeeSite(site.visibility, site.ownerId, viewerId)` is true.
- Flight read authorization still lives in `lib/flights/repo.ts`; site display
  sanitation is added there, not scattered across pages.
- Site lookup is scoped to public sites plus the viewer's own private sites.
  Ingest uses the owner as the viewer; reader display remains separately scoped.
- Owner-only mutation uses the session owner, not request body owner ids. Missing,
  unauthorized, and invisible resources return not-found-equivalent responses.
- React output escaping handles display names, but server-side name validation
  rejects controls, angle brackets, empty/reserved names, and overlong values.
- No site pages, search, or public browse endpoint in v1, reducing enumeration and
  moderation surface.
- CI-run integration tests are part of the security contract.

## Dependencies

- **Internal:** PR2 depends on PR1; PR3 depends on PR1+PR2; PR4 depends on all
  prior PRs.
- **Stack:** no new external services. Prisma v6, hand-written SQL migrations,
  Railway Postgres, NextAuth v5, existing app-layer privacy model.
- **UI:** reuse existing form/button/card primitives and `lucide-react` icons.
- **Seed/test data:** curated public sites plus at least three pilots (owner,
  friend, stranger) and flights with public, friends, and private visibility.

## Open Questions (resolved here; revisit only if product changes)

1. **Denormalization leak.** `Flight.takeoffSiteName` and `landingSiteName` become
   public-cache columns only. Private site associations keep the site id on the
   flight but store `null` in the cached name. `lib/flights/repo.ts` joins the site
   row and returns viewer-safe names/ids: owner sees their private site; everyone
   else gets `null` and the UI renders "Unknown site". Flight visibility changes
   need no data rewrite because private names were never cached. Private-to-public
   promotion is deferred as UI, but when added it must be a single repo transaction
   that flips the site to public and fills cached names on linked flights. Public-
   to-private demotion is out of scope and should not exist without a symmetric
   cache-clearing migration.
2. **Viewer-scoping `findSite`.** New signature is
   `findSite(db, { lat, lon, kind, viewerId })`. Candidates are public sites plus
   `viewerId`'s private sites. `ingestFlight` passes `ownerId` as `viewerId` for
   both web and device paths. `scripts/backfill-sites.ts` selects each flight's
   `ownerId` and scopes per row. Owner-scoping at write time is correct because it
   decides what the owner may attach; display is still reader-scoped later.
3. **Public site creation.** Public creation is immediate in v1. The create form
   defaults to private and clearly labels public as shared. Public rename/delete
   UI is deferred; operator SQL/admin tooling handles emergencies. Private sites
   may be owner-renamed/deleted in a later small follow-up, but v1 only creates and
   attaches. Moderation/report surfaces are an explicit non-goal with the risk
   logged.
4. **Retroactive re-association.** Synchronously link the current flight and scan
   up to 200 of the creator's own unmatched flights for that endpoint. Do not
   scan everyone on request. For public community-wide backfill, enhance
   `scripts/backfill-sites.ts` and run it deliberately as an operator task.
5. **Dedup / snap-to-existing UX.** Creation first runs scoped lookup. Inside the
   normal match radius (600 m takeoff / 900 m landing), reuse is the primary
   action. A wider advisory radius of 2x warns about possible near-duplicates but
   does not block creation; auto-association still uses the existing match radii
   to avoid surprise future matches.
6. **Site coordinate.** Use the flight endpoint coordinate rounded to 4 decimal
   places. That is precise enough for 600/900 m matching but avoids storing the
   exact fix as the site coordinate. Pilot-adjustable map markers are deferred.
7. **Site kind.** Creating from takeoff creates `kind='takeoff'`; creating from
   landing creates `kind='landing'`. Curated seeds may remain `both`. If a visible
   existing site is explicitly reused from the opposite endpoint, widen it to
   `both`; never narrow kind in v1.
8. **Surface area.** No site pages, URLs, browse, or search in v1. Sites remain
   plumbing surfaced as names on flights. Therefore `lib/prisma.ts` continues to
   inject short ids only for `Flight`.
9. **`Profile.homeSiteId`.** Out of scope. Leave the dormant schema field alone
   except for relation updates required by `Site.ownerId`; do not wire profile
   home-site UI into this sprint.
10. **Naming rules.** Normalize with NFKC, trim, collapse whitespace, store
    lowercase `normalizedName`, require 2-80 characters, reject controls and angle
    brackets, and reserve `unknown`, `unknown site`, `takeoff`, `landing`,
    `private`, and `public`. Do not enforce global uniqueness; use geo reuse
    suggestions instead.
