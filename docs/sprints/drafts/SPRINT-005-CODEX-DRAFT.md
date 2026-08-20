# SPRINT-005 Codex Draft: Two-level site hierarchy - Site + Zone

## Overview

SPRINT-004 made sites user-generated, private-aware, and ingest-matched. It also
left the data model intentionally flat: one `Site` row is both the named flying
area and the exact launch or landing point. This sprint splits that concept into
the two levels pilots actually use:

- `Site`: the parent flying area, for example "Mission Ridge".
- `Zone`: a concrete takeoff or landing spot inside that site, for example
  "North Launch" or "Lower LZ".

The anchoring decision for this draft: **`Site` remains the privacy boundary and
the parent display concept; `Zone` is a child location with its own owner for
attribution and undo, but it inherits visibility from its parent site.** A public
zone under a private site, or a private zone under a public site, is not a v1
state. That keeps the SPRINT-004 privacy matrix tractable and avoids a new class
of "public parent reveals hidden child" bugs.

`Flight.{takeoff,landing}SiteId` continues to point at the parent `Site`. New
optional `Flight.{takeoff,landing}ZoneId` columns point at the child `Zone` when
the endpoint matched a specific spot. The read path composes display names:

- Zone match: `Mission Ridge - North Launch`
- Site fallback: `Mission Ridge`
- Hidden parent site: `Unknown site`

The other anchoring decision: **matching considers endpoint-compatible zones and
endpoint-fallback sites as one ranked candidate set.** A site is fallback-eligible
for an endpoint only when it has no visible endpoint-compatible zones yet. That
preserves bare-site behavior, while allowing a site with a takeoff zone to keep
working as a landing fallback until someone names a landing zone.

Committed v1 scope:

1. Add a required `Zone.siteId` hierarchy and optional zone FKs/cache columns on
   `Flight`, with no production data backfill required.
2. Extend ingest matching to return either a zone match or a site fallback match,
   scoped to the flight owner exactly like SPRINT-004.
3. Extend the `lib/flights/repo.ts` read-path firewall so every displayed site
   and zone name is re-read and re-scoped per viewer.
4. Update the "name this site" flow into a zone-aware create/reuse flow: use an
   existing zone, use a bare site, create a new site optionally with its first
   zone, or add a zone under a visible site.
5. Extend creator undo and operator remedy to handle zones without introducing
   moderation, site pages, browse, search, or community editing.

Explicitly out of scope:

- **Independent zone visibility.** Useful eventually, but it multiplies the
  read and match matrix. In v1, parent site visibility is the only privacy gate.
- **Moving a zone between sites in the pilot UI.** Wrong-parent repairs are an
  operator remedy. User-facing move flows need browse/search context this sprint
  explicitly avoids.
- **Site pages, zone pages, browse, search, maps, or public URLs.** The feature
  remains attached to flight display and ingest, preserving the SPRINT-004
  choice that site ids are not URL-visible.
- **Cross-pilot request-time re-association.** Creating a public zone may help
  future ingest immediately, but it does not rewrite other pilots' history in a
  request. Operator backfill remains the bulk tool.
- **Launch-coordinate obfuscation or marker editing.** Site/zone rows round
  coordinates to 4 decimals like SPRINT-004; flight coordinates and tracks keep
  their existing visibility semantics.

## Use Cases

1. A pilot uploads a flight near a known zone. Ingest matches `North Launch`,
   stores both the parent site id and zone id, and the flight renders
   `Mission Ridge - North Launch`.
2. A pilot uploads near a bare site with no zones yet. Ingest still matches the
   parent site and renders `Mission Ridge`, with no behavior regression from
   SPRINT-004.
3. A site has a takeoff zone but no landing zone. Takeoff matching chooses the
   zone; landing matching may still use the parent site fallback until a landing
   zone exists.
4. A pilot opens an unknown endpoint and sees nearby visible zones first, then
   nearby visible sites. They can bind to a zone, bind to a bare site, add a new
   zone under a visible site, or create a new site with or without a first zone.
5. A public site with multiple zones helps everyone on future ingest. Flights
   may resolve to different zones under the same parent site without creating
   duplicate parent sites.
6. A private site and all of its zones are visible only to the owner. A public
   flight bound to a private site/zone renders `Unknown site` to friends,
   strangers, and anonymous viewers.
7. A zone creator can rename, unpublish via parent-site demotion when they own
   the site, or delete their own zone while no other pilot's flight references
   it. Once another pilot depends on the zone, the operator remedy path takes
   over.
8. An operator can merge duplicate zones, merge duplicate sites, rename either
   level, or force a site private without raw Prisma writes to the cache columns.

## Architecture

### Data model

`Site` remains the parent location and visibility boundary. Its existing `kind`
stays, but its meaning narrows: it is the fallback endpoint kind for a site with
no endpoint-compatible zones. `Zone.kind` is the primary endpoint classifier once
zones exist.

```prisma
model Profile {
  // existing fields
  ownedSites Site[] @relation("OwnedSites")
  ownedZones Zone[] @relation("OwnedZones") // NEW
}

model Site {
  id             String    @id @default(cuid())
  name           String
  normalizedName String
  // Fallback kind only: used for direct site matching when no compatible
  // zones exist under this site.
  kind           String    @default("unknown") // takeoff | landing | both | unknown
  lat            Float
  lon            Float
  countryCode    String?
  region         String?
  source         String    @default("manual") // manual | user
  sourceId       String?
  sourceUrl      String?
  license        String?
  ownerId        String?
  owner          Profile?  @relation("OwnedSites", fields: [ownerId], references: [id], onDelete: SetNull)
  visibility     String    // private | public; still no column default
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  zones          Zone[]
  takeoffFlights Flight[]  @relation("TakeoffSite")
  landingFlights Flight[]  @relation("LandingSite")
  homeProfiles   Profile[] @relation("HomeSite")

  @@index([lat, lon])
  @@index([ownerId])
  @@index([ownerId, normalizedName])
}

model Zone {
  id             String   @id @default(cuid())
  siteId         String
  site           Site     @relation(fields: [siteId], references: [id], onDelete: Cascade)
  name           String
  normalizedName String
  kind           String   // takeoff | landing | both; no "unknown" for v1 zones
  lat            Float
  lon            Float
  source         String   @default("user") // manual | user
  sourceId       String?
  sourceUrl      String?
  license        String?
  ownerId        String?
  owner          Profile? @relation("OwnedZones", fields: [ownerId], references: [id], onDelete: SetNull)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  takeoffFlights Flight[] @relation("TakeoffZone")
  landingFlights Flight[] @relation("LandingZone")

  @@index([siteId])
  @@index([lat, lon])
  @@index([ownerId])
  @@index([siteId, normalizedName])
  @@index([ownerId, normalizedName])
}

model Flight {
  // Existing parent site fields remain.
  takeoffSiteId   String?
  takeoffSite     Site?   @relation("TakeoffSite", fields: [takeoffSiteId], references: [id], onDelete: SetNull)
  takeoffSiteName String?
  landingSiteId   String?
  landingSite     Site?   @relation("LandingSite", fields: [landingSiteId], references: [id], onDelete: SetNull)
  landingSiteName String?

  // NEW child zone fields. Non-null zone id implies a non-null site id at the
  // application layer; Prisma cannot express "zone.siteId equals flight.siteId"
  // as a cross-row CHECK, so all writes go through lib/sites/associate.ts.
  takeoffZoneId   String?
  takeoffZone     Zone?   @relation("TakeoffZone", fields: [takeoffZoneId], references: [id], onDelete: SetNull)
  takeoffZoneName String?
  landingZoneId   String?
  landingZone     Zone?   @relation("LandingZone", fields: [landingZoneId], references: [id], onDelete: SetNull)
  landingZoneName String?

  @@index([takeoffSiteId])
  @@index([landingSiteId])
  @@index([takeoffZoneId])
  @@index([landingZoneId])
}
```

Raw SQL appended to the migration:

```sql
ALTER TABLE "Zone" ADD CONSTRAINT "zone_kind_check"
  CHECK ("kind" IN ('takeoff','landing','both'));
ALTER TABLE "Zone" ADD CONSTRAINT "zone_source_check"
  CHECK ("source" IN ('manual','user'));
```

No production data migration is needed because production has zero `Site` rows.
Local developer rows can remain as bare sites after migration; if the migration
is awkward locally, `pnpm db:reset`/`prisma migrate reset` is acceptable because
the 11 rows are test data.

### Matching

Replace `findSite` with a zone-aware lookup while keeping a compatibility export
only if it helps stage PRs.

```ts
export interface LocationSiteMatch {
  level: "site";
  site: SiteMatchRow;
  zone: null;
  distanceM: number;
}

export interface LocationZoneMatch {
  level: "zone";
  site: SiteMatchRow;
  zone: ZoneMatchRow;
  distanceM: number;
}

export type LocationMatch = LocationSiteMatch | LocationZoneMatch;

export interface FindLocationOptions {
  lat: number;
  lon: number;
  kind: MatchKind;
  viewerId: string | null;
}

export async function findLocation(
  db: Pick<Db, "site" | "zone">,
  options: FindLocationOptions,
): Promise<LocationMatch | null>;
```

Candidate construction:

1. Query visible endpoint-compatible zones by bbox, joining parent `Site` with
   `siteVisibleWhere(viewerId)`.
2. Query visible endpoint-compatible sites by bbox where no visible child zone
   exists with `kind IN (requested, "both")`.
3. Run exact haversine filtering with the existing 600 m takeoff and 900 m
   landing radii.
4. Rank all candidates together: distance ascending -> `level:"zone"` before
   `level:"site"` on exact ties -> curated/manual license first -> id.

The "no compatible zone" rule is endpoint-specific. A site with only takeoff
zones remains a landing fallback; a site with any takeoff/both zone does not
also compete as a bare takeoff site.

### Read path

`lib/flights/repo.ts` remains the only display-read firewall. `LIST_SELECT` and
`FEED_SELECT` gain the four zone columns. The resolver becomes
`resolveLocationFields` and re-verifies every non-null site id and every
non-null zone id on every page slice.

```ts
interface LocationFieldRow {
  takeoffSiteId: string | null;
  takeoffSiteName: string | null;
  takeoffZoneId: string | null;
  takeoffZoneName: string | null;
  landingSiteId: string | null;
  landingSiteName: string | null;
  landingZoneId: string | null;
  landingZoneName: string | null;
}

async function resolveLocationFields<T extends LocationFieldRow>(
  rows: T[],
  viewerId: string | null,
): Promise<T[]>;
```

Per endpoint:

- If `zoneId` is non-null, load the zone with its parent site. If the parent
  site is visible and `zone.siteId === siteId`, return live parent and live zone
  names.
- If `zoneId` is hidden, missing, or mismatched, strip both zone and site
  identity unless the parent site id independently resolves as visible.
- If `siteId` is non-null and visible but `zoneId` is null, return the live site
  name and the cached zone name only as a historical suffix.
- If `siteId` is null, use cached names only as historical fallback, exactly
  like SPRINT-004. A hidden live row never relies on cache.

The DTO should expose parent and child fields, not just one composite string.
The UI can compose `siteName` plus `zoneName`; stats can continue counting
distinct visible parent `takeoffSiteId` unless a later product decision wants
"distinct zones" as a separate metric.

### Cache writes

`lib/sites/associate.ts` remains the only writer of location cache fields, but
the helper takes a `LocationMatch` rather than a bare `Site`.

```ts
export interface LocationFieldPatch {
  takeoffSiteId?: string | null;
  takeoffSiteName?: string | null;
  takeoffZoneId?: string | null;
  takeoffZoneName?: string | null;
  landingSiteId?: string | null;
  landingSiteName?: string | null;
  landingZoneId?: string | null;
  landingZoneName?: string | null;
}

export function locationCachePatch(
  match: LocationMatch | null,
  endpoint: SiteEndpoint,
): LocationFieldPatch;

export async function resolveLocationCache(
  db: LocationCacheDb,
  match: LocationMatch | null,
  endpoint: SiteEndpoint,
  ownerId: string,
): Promise<LocationFieldPatch>;
```

Public parent site means public cache:

- Site fallback: cache site id/name; zone id/name null.
- Zone match: cache site id/name and zone id/name.
- Private parent site: cache ids but cache names null, so only the viewer-scoped
  resolver can show names to the owner.

Transition writers:

- Site rename: update `*SiteName` on all direct site and child-zone flight
  references when public.
- Zone rename: update only `*ZoneName` on zone references when parent site is
  public.
- Site public -> private: null `*SiteName` and `*ZoneName` on every referencing
  flight, direct and zone-bound.
- Site private -> public: repopulate both parent and child cache names.
- Zone delete: `onDelete: SetNull` clears zone ids; leave cached zone names as
  historical fallback. Parent site ids remain unless the delete action also
  deliberately detaches the endpoint.
- Site delete: cascades zones and `SetNull`s flight site/zone ids; cached names
  remain historical fallback.

### Creation and reuse

Zone-aware server core:

```ts
export type LocationAttachMode =
  | "reuse_zone"
  | "reuse_site"
  | "create_site"
  | "create_zone";

export interface CreateOrAttachLocationInput {
  flightId: string;
  ownerId: string;
  endpoint: SiteEndpoint;
  mode: LocationAttachMode;
  existingSiteId?: string;
  existingZoneId?: string;
  siteName?: string;
  zoneName?: string;
  visibility?: SiteVisibility; // site visibility only
}

export interface CreateOrAttachLocationResult {
  site: Site;
  zone: Zone | null;
  createdSite: boolean;
  createdZone: boolean;
  reassociated: { updated: number; truncated: boolean };
}

export async function createOrAttachLocationFromFlight(
  input: CreateOrAttachLocationInput,
): Promise<CreateOrAttachLocationResult>;
```

Rules:

- Coordinates always come from the owner-scoped flight row, never the client.
- `reuse_zone` verifies the zone and parent site are visible to the owner, then
  binds both ids.
- `reuse_site` verifies a visible site and binds only the parent id. If the
  endpoint is opposite the site's fallback `kind`, widen site `kind` to `both`.
- `create_site` validates `siteName`, creates the parent site at the rounded
  endpoint coordinate, and optionally creates a first zone when `zoneName` is
  present. Public remains preselected, with SPRINT-004 consequence copy.
- `create_zone` verifies a visible parent site, validates `zoneName`, creates a
  child zone at the rounded endpoint coordinate, and binds both ids.
- Duplicate checks are proximity-scoped and visible-row-scoped at both levels:
  duplicate parent site names are rejected within 2 km; duplicate zone names are
  rejected within the same site.
- Concurrent duplicate creation is guarded by re-running the visible candidate
  probe inside the transaction before insert. No global unique constraint on
  names.
- Reassociation stays owner-only and capped at 200. When a new zone is created,
  reassociate the creator's own matching unmatched endpoints to the zone; when
  only a bare site is created, reassociate to the parent fallback.

### UI shape

Rename only where the product copy benefits; the domain code can still live
under `lib/sites/`.

- `SiteNameControl` should accept and update `{ siteId, siteName, zoneId,
  zoneName }` for each endpoint.
- The dialog shows nearby visible zones first: `Mission Ridge - North Launch`.
- It then shows visible parent sites within 2 km with two actions: `Use site`
  and `Add spot`.
- The create form has `Site name` and an optional `Spot name` field. Leaving the
  spot blank creates a bare site, which is intentionally supported.
- Existing bound zone: owner can rename/delete the zone if they own the zone and
  no other pilot references it.
- Existing bound bare site: owner can add first zone, rename/unpublish/delete the
  site if they own the site, subject to the existing guards.

## Implementation

Four ordered PRs, each with its own migration/tests where applicable and all
five gates before merge.

### PR1 - Schema and pure zone-aware matching

- Migration `site_zones`: add `Zone`, `Profile.ownedZones`,
  `Flight.{takeoff,landing}ZoneId`, `Flight.{takeoff,landing}ZoneName`, indexes,
  and raw SQL CHECKs for `Zone.kind` and `Zone.source`.
- Keep existing `Site.kind` and document its narrowed fallback meaning in
  `schema.prisma`.
- Extend `lib/sites/geo.ts` with `compareLocationCandidates` and tests for
  mixed zone/site fallback ordering.
- Replace/extend `lib/sites/lookup.ts` with `findLocation(db, options)`.
- Tests:
  - zone match wins when an endpoint-compatible zone is within radius;
  - bare site fallback still matches;
  - site with takeoff zone remains landing fallback;
  - site with takeoff zone does not also match as bare takeoff;
  - two zones of the same kind sort by distance then deterministic tie-break;
  - private parent site's zones match only for the owner;
  - anonymous sees only public parent sites and zones.
- Depends on: nothing.

### PR2 - Read-path firewall and cache writer

- Extend `lib/sites/associate.ts` from `siteCachePatch`/`resolveSiteCache` to
  `locationCachePatch`/`resolveLocationCache`, preserving a deprecated wrapper
  only if it makes the PR smaller.
- Update `lib/ingest/ingest-flight.ts` to call `findLocation` for both endpoints
  and re-resolve both matches inside the create transaction.
- Extend `lib/flights/repo.ts` selects and resolver to re-scope every non-null
  site id and zone id.
- Update the write audit to allow only `lib/sites/associate.ts`,
  `lib/flights/repo.ts`, and operator scripts to assign any `*SiteName` or
  `*ZoneName` cache field.
- Tests:
  - owner/friend/stranger/anonymous x private/public parent site x zone/site
    fallback x private/friends/public flight;
  - stale row with a private zone name in cache is stripped;
  - stale row with mismatched `zone.siteId` and `flight.siteId` cannot leak;
  - site/zone id nulling does not change feed cursor stability;
  - ingest demotion/delete race does not cache hidden names.
- Depends on: PR1.

### PR3 - Zone-aware naming flow

- Update `lib/sites/repo.ts`: `suggestNearbyLocations`,
  `createOrAttachLocationFromFlight`, `reassociateOwnFlights` for site or zone
  targets, and zone-specific duplicate checks.
- Update `app/flights/[id]/site-action.ts` server action types and validation.
- Update `components/flight/name-site-dialog.tsx` and flight page rendering to
  show parent/zone display without changing route-level ingest/upload code.
- Keep public preselected for new public parent sites, with consequence copy.
- Structured log lines distinguish `create_site`, `create_zone`, `reuse_site`,
  and `reuse_zone`.
- Tests:
  - create bare public/private site;
  - create site with first zone;
  - add zone under visible existing site;
  - bind existing zone;
  - bind existing bare site;
  - duplicate zone name under same site is refused;
  - duplicate zone name under different visible site is allowed;
  - non-owner cannot name another pilot's flight;
  - concurrent zone creation resolves to one visible winner;
  - reassociation updates only the creator's own ready unmatched flights.
- Depends on: PR2.

### PR4 - Undo, operator remedy, release pass

- Extend `lib/sites/associate.ts` transition writers:
  `renameZone`, `deleteZone`, zone-aware `renameSite`, zone-aware
  `setSiteVisibility`, zone-aware `deleteSite`, and guarded creator wrappers.
- Extend `getBoundSiteInfo` to return site ownership and zone ownership
  independently, since a pilot may own a zone under another pilot's public site.
- Extend `scripts/admin-sites.ts` with zone operations:
  `rename-zone`, `merge-zone`, `delete-zone`, and site merge behavior that moves
  or merges child zones before deleting the duplicate site.
- Extend `scripts/backfill-sites.ts` to use `findLocation` and
  `locationCachePatch`, with `--site-id`, `--zone-id`, and `--public-only`.
- E2E: upload unknown flight -> create site with zone -> headline shows
  `Site - Zone` -> upload distinct nearby IGC -> auto-associates to the same
  zone; also cover bare-site fallback with a seeded site that has no zones.
- Add `/whats-new` entry, update `FEATURES.md`, update `docs/architecture.md`,
  and hand off `/qa-prompt`.
- Depends on: PR3.

## Files Summary

New:

- `prisma/migrations/*_site_zones/`
- `test/zones.integration.test.ts` or extended `test/sites.integration.test.ts`
- optional `lib/sites/location-types.ts` if shared types make imports cleaner

Modified:

- `prisma/schema.prisma`
- `lib/sites/geo.ts` and `lib/sites/geo.test.ts`
- `lib/sites/lookup.ts` and `lib/sites/lookup.test.ts`
- `lib/sites/associate.ts`
- `lib/sites/repo.ts`
- `lib/sites/write-audit.test.ts`
- `lib/sites/visibility.ts` and `lib/sites/visibility.test.ts`
- `lib/flights/repo.ts`
- `lib/ingest/ingest-flight.ts`
- `app/flights/[id]/site-action.ts`
- `components/flight/name-site-dialog.tsx`
- `app/flights/[id]/page.tsx`
- `components/logbook/flight-row.tsx`
- `components/flight/flight-header.tsx`
- `scripts/admin-sites.ts`
- `scripts/backfill-sites.ts`
- `lib/whats-new.ts`
- `FEATURES.md`
- `docs/architecture.md`

Unchanged on purpose:

- `app/api/upload/route.ts`
- `app/api/ingest/route.ts`
- `lib/prisma.ts`
- `lib/flights/visibility.ts`
- `lib/sites/name.ts` except for exported aliases if UI copy wants "zone name"

## Definition of Done

- [ ] `Zone` exists with required `siteId`, own `ownerId`, own name/kind/lat/lon,
      and no independent visibility column.
- [ ] `Flight` keeps parent `*SiteId` columns and gains optional `*ZoneId` and
      `*ZoneName` columns for both endpoints.
- [ ] `Site.kind` remains only as fallback kind for direct site matching.
- [ ] `findLocation` requires `viewerId` and returns a discriminated site/zone
      match; no ingest caller can compile without stating write-time scope.
- [ ] Matching ranks endpoint-compatible zones and endpoint-fallback sites in one
      deterministic candidate set.
- [ ] A bare site with zero zones still matches and displays exactly like
      SPRINT-004 from a pilot's perspective.
- [ ] A site with a takeoff zone but no landing zone can still match as a landing
      fallback.
- [ ] A private parent site hides all child zones from matching, suggestions, and
      display for everyone except the owner.
- [ ] `lib/flights/repo.ts` re-verifies every non-null site id and zone id on
      every display read; a stale cached private zone name never leaks.
- [ ] The read DTO carries viewer-safe site and zone fields; UI composes the
      label and never reads raw Prisma flight rows for display.
- [ ] `Flight.*SiteName` and `Flight.*ZoneName` are written only through
      `lib/sites/associate.ts`, enforced by the audited allowlist test.
- [ ] Ingest re-resolves matched site/zone rows inside the flight create
      transaction.
- [ ] Site rename/demote/promote/delete and zone rename/delete update or preserve
      cache fields according to the historical-fallback rules.
- [ ] The naming dialog supports reuse zone, reuse site, create bare site, create
      site with first zone, and add zone under visible site.
- [ ] Duplicate checks are proximity-scoped for sites and parent-scoped for zones;
      no global name uniqueness is introduced.
- [ ] Creator undo works for zones independently of site ownership until another
      pilot references the zone.
- [ ] Operator scripts can repair duplicate/wrong zones without raw cache writes.
- [ ] Owner-only reassociation is capped at 200 and logs truncation.
- [ ] Privacy matrix tests cover zone matches and site fallback matches across
      owner/friend/stranger/anonymous viewers.
- [ ] E2E covers zone display and bare-site fallback.
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm e2e`
      pass before PRs merge.
- [ ] `/whats-new`, `FEATURES.md`, and `docs/architecture.md` are updated.

## Risks

- **Zone names leaking through stale cache.** Mitigation: strict read-path
  resolver re-reads every site and zone id; cache writer allowlist includes zone
  fields; stale-row tests cover private cached names and mismatched parent ids.
- **Ambiguous fallback behavior.** Mitigation: endpoint-specific fallback rule:
  a parent site competes only when no visible compatible child zone exists.
- **Contributed zones under someone else's public site.** Mitigation: zone has
  its own owner for attribution and creator undo, while parent visibility still
  controls read scope. Once another pilot references the zone, operator remedy
  replaces creator deletion.
- **Larger read-path cost.** Mitigation: one additional `Zone.id IN (...)`
  lookup after page slicing, with parent `Site` selected in the same query.
  Feed remains capped at 50 and cursor fields remain untouched.
- **A child zone orphaning display when deleted.** Mitigation: `onDelete:
  SetNull` plus cached historical names; parent site id remains available unless
  the parent is also deleted.
- **Schema invariant not fully enforceable in Prisma.** `flight.zoneId` should
  imply `flight.siteId === zone.siteId`; enforce through `locationCachePatch`,
  `resolveLocationCache`, audit tests, and a stale-row read-path defense.
- **UX complexity.** Mitigation: suggestions are ordered by concrete usefulness:
  existing zones first, then parent sites, then create. The bare-site path stays
  explicit so pilots are not forced to invent a spot name.
- **Operator tool drift.** Mitigation: scripts route through the same cache
  helpers or mirror them in audited allowlist files, with tests for merge/rename.

## Security

- Parent `Site.visibility` is the only visibility boundary. A zone is visible if
  and only if its parent site is visible to the viewer.
- Write-time scope and read-time scope stay separate. Ingest matches against
  `public` plus the owner's private sites; display re-scopes to the current
  viewer on every read.
- Hidden and nonexistent site/zone ids return indistinguishable errors from
  server actions.
- Client input never supplies coordinates. Site and zone coordinates are derived
  from the owner-scoped flight endpoint and rounded to 4 decimals.
- Names remain user content and use the existing normalization/validation rules:
  NFKC, strip control/zero-width/bidi characters, length cap, reserved words
  rejected, React escaping on render.
- No new public URL surface exposes site or zone ids.
- Raw `prisma.site`/`prisma.zone` reads for display are forbidden outside the
  viewer-scoped repos; raw cache writes are forbidden outside the audited
  allowlist.

## Dependencies

- Internal sequencing: PR2 depends on PR1, PR3 depends on PR2, PR4 depends on
  PR3. The ordering is a safety property: user creation waits until the
  read-path firewall understands zones.
- Stack: no new package or service. Prisma 6, Postgres, Next 16 App Router, and
  NextAuth v5 remain the stack.
- Test data: add fixtures for a bare site, a site with one takeoff zone, a site
  with multiple takeoff zones, and a private site with a child zone. E2E needs a
  second distinct IGC near the first zone because exact-byte dedupe prevents
  reusing the same upload.
- Production data: no site rows today, so no production backfill. Local dev data
  can be reset or left as bare sites.

## Open Questions

1. Should the final merged sprint keep the name `Zone`, or use the user-facing
   word "Spot" in UI while keeping `Zone` in code? This draft recommends
   `Zone` in schema/code and "spot" in user-facing copy.
2. Should zone-level stats become a separate profile metric later? This draft
   leaves `statsFrom.siteCount` counting parent takeoff sites only.
3. Should operator tooling include `move-zone` in v1, or is `merge-zone` plus
   `delete-zone` enough? This draft treats move as useful but not required for
   the pilot-facing release.
