# SPRINT-005 Claude Draft Critique

## Overall assessment

This is a strong draft. It clearly understands that SPRINT-005 is an extension of the
SPRINT-004 site system shipped in PRs #36-40, not a replacement for it. The most important
architectural choice - keeping `Flight.takeoffSiteId` / `landingSiteId` authoritative for
the parent and adding optional `takeoffZoneId` / `landingZoneId` alongside them - is the
right default for preserving bare-site behavior, `statsFrom`, creator undo, and the
existing read-path firewall.

The draft is also unusually good at sequencing: PR1 creates the model and lookup shape
without writing zone caches, PR2 lands the two-level firewall before any user can create a
zone, PR3 adds the "Which spot?" UX, and PR4 handles undo/operator/release work. That
mirrors the security-first ordering of SPRINT-004 PR2.

The weaknesses are mostly second-order invariants the draft introduces but does not fully
close. The biggest gaps are `Zone.kind` lifecycle, deleted-zone cache semantics, hidden
private-zone name conflicts under `@@unique([siteId, normalizedName])`, and site-level
undo after zones can be authored by a different pilot than the parent site.

## Strengths

- **Correct parent/child FK shape.** The draft's `Flight` schema keeps
  `takeoffSiteId` / `takeoffSiteName` and `landingSiteId` / `landingSiteName`, then adds
  nullable `takeoffZoneId` / `takeoffZoneName` and `landingZoneId` / `landingZoneName`.
  This directly satisfies the intent's "Site can exist standalone with zero zones" rule
  and avoids making "Mission Ridge" without a specific launch unrepresentable.

- **Bare sites remain first-class.** The matching algorithm says `findLocation` falls back
  to the site pass whenever no zone is inside `ZONE_TAKEOFF_RADIUS_M` /
  `ZONE_LANDING_RADIUS_M`, "whether or not the winning site has zones." That is better
  than only falling back for zoneless sites, because it supports "Mission Ridge" when a
  pilot is 500 m from `North Launch` but still inside the parent site's 600 m radius.

- **Privacy model is explicit and compositional.** `canSeeZone(zone, site, viewerId)` takes
  the parent site as a required argument and applies `canSeeSite(site) &&
  canSeeSite(zone)`, with fail-closed behavior on missing or mismatched parents. This is
  the right extension of SPRINT-004's `lib/sites/visibility.ts` and
  `lib/flights/repo.ts` firewall.

- **The read-path firewall is treated as the security boundary.** Replacing
  `resolveSiteFields` with `resolveLocationFields`, verifying every non-null site id and
  zone id, and stripping the child whenever the parent is hidden preserves the SPRINT-004
  principle that denormalized names are never trusted for authorization.

- **Single-writer discipline is maintained.** Replacing `siteCachePatch` with
  `locationCachePatch` in `lib/sites/associate.ts`, and extending `write-audit.test.ts` to
  cover all eight denormalized columns plus raw SQL, correctly recognizes that the new
  `takeoffZoneName` / `landingZoneName` fields double the cache-leak surface.

- **The PR boundaries are defensible.** The draft's PR1/PR2/PR3/PR4 split preserves the
  SPRINT-004 precedent: schema and lookup first, firewall before creation, UX after the
  security matrix, then undo/operator/release.

- **The draft answers the intent's open questions concretely.** It chooses own
  `Zone.ownerId` / `visibility`, optional zone FKs on `Flight`, a progressive two-step UX,
  fixed tighter radii of 300 m / 400 m, no `Site.hasZones`, and no local reset requirement.

## Weaknesses

- **`Zone.kind` is underspecified and likely wrong on create/reuse.** The schema defines
  `Zone.kind String @default("unknown")`, and `findLocation` filters by `kindMatches`, but
  the PR3 `ZoneChoice` type only has `{ mode: "create"; name; visibility }` and no `kind`.
  The create steps say "insert at the endpoint coordinate" but never say to set
  `Zone.kind` from `endpoint`. If Prisma's default `"unknown"` is used, the newly created
  zone may never auto-match future takeoffs/landings under the existing SPRINT-004
  `kind IN (requested, "both")` semantics. The draft also says to widen `Site.kind`, but
  does not say to widen `Zone.kind` when a takeoff zone is explicitly reused from a landing
  endpoint, or vice versa.

- **Deleted-zone cache behavior is internally ambiguous.** The transition table says
  `zone deleted` leaves `takeoffZoneName` / `landingZoneName` as history while the flight
  "falls back to site-level display." The `resolveLocationFields` pseudocode says when
  `siteId null`, keep both cached names, but it does not spell out what happens when
  `siteId` is still visible and `zoneId` was set to null by `onDelete: SetNull`. Unless
  the resolver explicitly ignores or nulls `zoneName` when `zoneId IS NULL` and
  `siteId IS NOT NULL`, `formatLocationLabel(siteName, zoneName)` can continue rendering a
  deleted zone as "Mission Ridge - North Launch" instead of "Mission Ridge."

- **`@@unique([siteId, normalizedName])` conflicts with private zones.** The draft argues
  sibling duplicate zone names are unambiguously a bug, but private zones under public
  sites make this less clean. A pilot can create a private `North Launch` under public
  `Mission Ridge`; another pilot then cannot create a public `North Launch` because the DB
  unique key fires. The `P2002 -> re-read winner and reuse` plan cannot reuse a hidden
  private zone, and returning "duplicate" may itself leak that a hidden zone name exists.
  This is a real abuse/data-quality risk the draft does not analyze.

- **Site-level creator undo may delete another pilot's zone.** The draft says site undo
  needs "no change at all" because any flight referencing a zone also references its
  parent site, so the existing `referencedByOthers` guard over `takeoffSiteId` /
  `landingSiteId` covers it. That is true only while every other-owned zone is still
  referenced by another pilot's flight. The draft also explicitly allows "a pilot may add a
  zone to another pilot's public site" via `Zone.ownerId`. If zones can outlive the flight
  that created them, or if an operator/import path creates a zone without a flight, then
  deleting the parent site cascades and deletes someone else's `Zone` row without the
  guard noticing. The guard should either count `Zone.ownerId != creator` or the draft
  should state that zones cannot exist without at least one current referencing flight.

- **Global zone-first matching can shadow a nearer bare site.** `findLocation` ranks all
  visible zones first and returns the winning zone's parent "regardless of the parent's own
  distance." That is clean for "zone beats its own parent," but it can make a zone 290 m
  away under Site B beat a bare Site A whose center is 50 m away. The draft calls this
  precise "by construction," but the construction is only radius-based; it does not prove
  the zone belongs to the intuitively nearest named place. This may be acceptable, but it
  should be named as a collision risk and covered by a test or tie-break rule.

- **The invalid public-zone/private-site case is inconsistent.** The overview says a
  public zone under a private site is incoherent and "neutralized at read time." PR1 says
  it "matches nobody but the site's owner"; the DoD says it "renders nothing to anyone but
  the site owner." Those are different policies from "neutralized" if the zone owner is
  not the site owner. `canSeeZone` as written would let the private site owner see a public
  child zone even if they do not own the zone. The draft should define the exact expected
  behavior for invalid existing rows across site owner, zone owner, stranger, and anonymous.

- **The raw-SQL audit proposal is brittle.** The draft says `write-audit.test.ts` should
  flag any file outside the allowlist that mentions `$executeRaw` / `$queryRaw`, `"Flight"`,
  and a `SiteName` / `ZoneName` column. That is a good direction, but it may miss
  `Prisma.sql` fragments split across helper constants or catch unrelated admin reads. If
  this audit becomes a security control, the draft should require positive and negative
  fixtures for the exact raw-SQL patterns used by `setSiteVisibility`, zone transitions,
  and `scripts/admin-sites.ts`.

## Gaps in risk analysis

- **Hidden-name squatting is not listed.** The Risks section covers zone proliferation and
  duplicate public quality, but not the stronger failure mode caused by
  `@@unique([siteId, normalizedName])`: an invisible private zone can block a visible
  public zone name under the same site.

- **Parent deletion risk is understated.** "Site undo needs no change" depends on the
  `zone.siteId = flight.siteId` invariant plus current flight references. It does not
  address zones as user-authored rows with their own `ownerId`, nor what happens when the
  last referencing flight is deleted before the parent site creator invokes undo.

- **Radius collision risk is too narrow.** The draft mentions adjacent zones 250 m apart,
  but not cross-site collisions where a zone under one site beats a closer site-level
  match under another. This is especially relevant because the draft deliberately runs
  site fallback even when sites have zones, meaning bare and zoned sites can coexist
  nearby.

- **Rollback risk ignores data created after PR3.** The rollback paragraph says reverting
  PR3/PR4 leaves a coherent system because "no zones exist yet," but after PR3 ships,
  zones can exist. The draft should distinguish rollback before PR3 release from rollback
  after pilots create zones, where a code rollback that ignores `takeoffZoneId` may be
  display-coherent but leaves orphaned feature data and changed matching behavior.

- **Operator remedies for invalid rows are incomplete.** `scripts/admin-sites.ts` gains
  `zone-rename`, `zone-force-private`, `zone-merge`, and `list`, but there is no explicit
  command or DoD item for detecting/repairing public zones under private sites, zone/site
  parent mismatches on flights, orphaned private zones with `ownerId = null`, or duplicate
  hidden-name conflicts after a policy change.

## Missing edge cases

- Creating a zone from a takeoff endpoint must set `Zone.kind = "takeoff"`; from landing,
  `Zone.kind = "landing"`; explicit opposite-endpoint reuse must widen the zone to
  `"both"` and never narrow it.

- A newly created zone should retroactively refine an already-site-bound flight only if
  that zone wins the same deterministic zone ranking that ingest would use. A flight
  inside overlapping radii for two sibling zones should not be blindly reassociated to the
  newest zone.

- A deleted zone with `zoneId = null`, `zoneName != null`, and visible `siteId != null`
  should render the site only. A deleted site with both ids null may render historical
  "Site - Zone" if that is the intended history behavior; the draft should state this
  distinction explicitly.

- A private zone under a public site with the same `normalizedName` as a requested public
  zone should have a specified UX/server error that does not reveal hidden data and does
  not permanently block useful public naming.

- Site creator undo should be tested when a different pilot owns a zone under the site but
  no other pilot currently has a flight referencing the site.

- The visibility matrix should include the site-owner-not-zone-owner and
  zone-owner-not-site-owner cases, not only owner/friend/stranger/anonymous as if there is
  one owner axis.

- Matching should cover cross-site precedence: nearby bare site vs farther zone under a
  different site; public zone vs owner-private site; owner-private zone vs nearby public
  site.

- `suggestNearbyLocations` should test hidden private zones that collide by name with the
  proposed input, not only visible nested suggestions.

- `scripts/backfill-sites.ts` should have an explicit expected behavior: does it call
  `findLocation` and write zone columns, or does it remain site-only? The Files Summary
  says it writes zone columns only through the helper, but the PR breakdown does not
  specify the zone-aware backfill semantics with the same precision SPRINT-004 required
  for owner-scoped `findSite`.

## Definition of Done completeness

The DoD is mostly complete and follows SPRINT-004's house style well: it includes schema,
matching, read-path firewall, stale-row tests, transition tests, UI behavior, audit tests,
E2E, release notes, and explicit deferred items.

Recommended DoD additions:

- [ ] Zone creation sets `Zone.kind` from `endpoint`; explicit opposite-endpoint zone reuse
      widens `Zone.kind` to `"both"` and never narrows; future ingest matches the reused
      zone for both endpoint types.

- [ ] A deleted zone with null `zoneId` but non-null cached `zoneName` renders site-only
      while the parent site id remains visible; historical "Site - Zone" rendering after
      parent site deletion is either explicitly accepted or explicitly suppressed.

- [ ] Private-zone sibling name conflicts under `@@unique([siteId, normalizedName])` are
      resolved without leaking hidden zone names and without allowing private hidden rows
      to permanently squat common public names.

- [ ] Site creator undo refuses or safely handles a site that has zones owned by another
      pilot, even if no other pilot's flight currently references the site.

- [ ] The zone privacy matrix distinguishes site owner, zone owner, both owners, other
      signed-in viewer, and anonymous viewer for public/private combinations.

- [ ] Matching tests cover a closer bare site losing or not losing to a farther zone under
      another site, with the chosen policy documented.

- [ ] Zone retroactive reassociation uses the same deterministic winner rule as
      `findLocation`, especially when sibling zone radii overlap.

- [ ] `scripts/backfill-sites.ts` has explicit zone-aware behavior, flags, and tests, or is
      explicitly kept site-only with a reason.

## Bottom line

The draft is a good foundation and should be merged forward structurally. I would not
accept it as final until it closes the `Zone.kind` lifecycle and resolves the three
privacy/data-ownership edge cases created by independent zone ownership:
private-zone sibling uniqueness, site deletion cascading another pilot's zone, and the
exact read/match behavior of invalid public-zone/private-site rows.
