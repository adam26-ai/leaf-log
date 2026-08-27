# Feature Ideas

Track potential feature ideas for future sprints.

## Logbook-Level Batch Photo Upload + Auto-Associate to Flights
- **Area:** Logbook / photo ingestion / placement
- **Description:** A photo-upload entry point at the **logbook (flights list)** level, not just
  per-flight. Drop a whole batch (an end-of-day or whole-vacation dump spanning multiple flights)
  and the app **auto-routes each photo to the correct flight** by capture timestamp (and/or GPS),
  then places it on that flight's track. Solves the common real case where you upload everything at
  once and shouldn't have to open each flight and upload by hand. (Motivated by a real upload that
  landed `out_of_window` because it was attached to the wrong day's flight.)
- **Priority:** High
- **Notes:** Reuses the SPRINT-002 placement engine (`lib/photos` `parsePhotoMeta`, the local→UTC
  bridge, `placePhoto`). **Routing:** build a per-owner index of flight windows once; for each
  photo find the flight whose `[takeoffAt, landingAt]` contains the photo's UTC instant. **Timezone
  catch:** a photo's EXIF time is *local with no zone*, and each candidate flight has its own
  `localUtcOffsetMinutes` — bridge per-candidate (or use EXIF `OffsetTimeOriginal` when present);
  prefer GPS-in-bounds to disambiguate. No match (between flights, no time, no GPS) → an
  **"unassigned"** bucket the user can manually assign, plus a "move photo to another flight"
  action. Add a **review/confirm step** showing the proposed flight per photo before committing.
  Implementation: a routing layer that picks `flightId` per photo, then calls the existing
  owner-only `addPhotos({ flightId, … })` core per flight (no change to the write seam). New UI at
  `/logbook` or `/upload` (multi-flight). Surfaces the just-added unpinned/unassigned reasons.

## Rate-Limit the Device Endpoints (pair/start, pair/poll, ingest)
- **Area:** Device integration / abuse hardening
- **Description:** The three unauthenticated-or-token-authed device endpoints have **no rate
  limiting** — a documented follow-up from PR #28 that never got tracked. `pair/start` mints a
  pairing code per call, `pair/poll` is a guessable-handle polling loop, and `/api/ingest` accepts
  IGC bodies; all three are open to hammering.
- **Priority:** Medium — worth closing before the firmware ships and real devices are in the field.
- **Notes:** Codes and handles are already short-lived, single-use, and sha256-hashed, so the
  exposure is brute-force/DoS rather than direct compromise. Per-endpoint limits keyed on IP (and
  on token for `/api/ingest`) are the shape; a small in-process limiter is probably enough at
  current scale, but note Railway may run more than one instance, so a shared store (or accepting
  per-instance limits) is the decision to make.

## Pending Friend-Request Badge + Feed Indicator
- **Area:** Social / navigation (account menu, feed)
- **Description:** Show a badge when you have incoming friend request(s) waiting to be
  accepted — under your profile/avatar (e.g. a count dot on the header account menu), and
  surface something on the **feed** page too, so a pilot notices and acts on pending requests
  without having to visit `/friends` directly.
- **Priority:** Medium
- **Notes:** The count already exists — `listIncomingRequests(meId)` in `lib/social/friends.ts`
  (pending where addressee = me). Add a lightweight `countIncomingRequests(meId)` and surface it
  on the `AvatarMenu` (a small dot/number, linking to `/friends`) and as a banner/prompt on
  `/feed` ("N friend requests waiting"). Header is server-rendered per request (the menu already
  receives the profile), so the count can be fetched alongside it — keep it cheap. Real-time
  updates are out of scope; refresh-on-navigation is fine. Pairs with the deferred notifications
  work in [[social-sprint-state]] but is much lighter (no notification model needed).

## Following / Followers List Page
- **Area:** Social / profile
- **Description:** A page (likely under `/friends` or a pilot's profile) that lists a pilot's
  connections as "Following" / "Followers" for a clearer social/community feel — but backed by
  the existing mutual, accept-required Friendship model, not a new asymmetric follow relationship.
  Since friendship is symmetric, both lists are the same underlying accepted-friends set; this is
  a presentation/framing feature, not a new data relationship.
- **Priority:** Low
- **Notes:** `lib/social/friends.ts` already has the accepted-friends query this would reuse (no
  schema change needed). Mostly a UI/naming exercise on top of `/friends` — decide whether
  "Following"/"Followers" are shown as one combined list (since they're identical for a mutual
  model) or kept as two views for familiarity, and whether it lives on `/friends` or on each
  pilot's public profile page.

## Consistent Top Navigation Across Pages
- **Area:** Navigation / layout
- **Description:** The shared top nav (`components/app-header.tsx` — Logbook/Feed/Upload/Profile
  links + avatar menu) only appeared on `/logbook`, `/feed`, `/friends`, `/upload`, `/settings`,
  `/settings/devices`, and `/whats-new`. The flight detail page (`app/flights/[id]/page.tsx`) and
  a pilot's public profile page (`app/[handle]/page.tsx`) instead rendered their own bare
  Wordmark-only header with no nav links or avatar menu, so a signed-in pilot lost navigation
  the moment they opened a flight or a profile.
- **Priority:** Medium — **shipped, 2026-08-26.**
- **Notes:** `AppHeader` now takes `profile: Profile | null` — the full nav + avatar menu when
  signed in, the same bare Wordmark-linking-to-`/` fallback as before when the viewer is
  anonymous. Both pages now fetch `getCurrentProfile()` (rather than just the id) and pass it
  straight through; the flight page's Wordmark link also picks up a small consistency
  improvement as a side effect — a signed-in non-owner viewing someone else's public flight now
  gets "Logbook" as the destination instead of "/", matching every other authenticated page.
  Pre-auth/onboarding flows (`sign-in`, `check-email`, `stay-signed-in`, `onboarding`,
  `activate`) were left header-less, matching the original scope note.

## 3D Flight-Marker Pole (Site Name + Altitude)
- **Area:** Flight page / 3D replay markers
- **Description:** Update the flight marker to look more like a reference screenshot: a vertical
  pole rising from the terrain at the takeoff/landing point, topped with a small paraglider icon,
  the site name running vertically along the pole (e.g. "SCOTT O'BRIEN"), and a dark label box at
  the base showing the ground altitude (e.g. "394 ft ASL"). Today's markers are much plainer — a
  flat colored circle pin in the 2D map (`components/flight/track-map.tsx`, green for takeoff,
  dark for landing) and no equivalent site marker at all in the 3D replay
  (`components/flight/flight-replay-3d.tsx`, which currently only renders the glider sphere and
  photo pins).
- **Priority:** Medium
- **Notes:** The pole/label style is inherently a 3D element (it reads as a physical object
  standing on the terrain), so this is really a 3D-replay-only marker — the 2D map's flat pins
  would stay as-is. Would need a deck.gl layer (matching the existing IconLayer/sphere approach
  in `flight-replay-3d.tsx`) for the pole + glider icon, plus a text/label layer for the site name
  and an altitude readout box; altitude display should respect whatever unit system the flight
  page ends up using (see the in-progress key-statistics Metric/Imperial toggle). Site name text
  would come from `takeoffSiteName`/`landingSiteName` on `Flight`.

Completed ideas (see git history / PRs for detail):

- Short Flight URL IDs — 4-char `[a-z0-9]` flight URLs (PR #2)
- Owner-only flight delete (PR #1)
- Leaf Log favicon + app icons (PR #4)
- 3D Flight Visualization — deck.gl + MapLibre terrain replay (PR #3), with the track-on-terrain fix (PR #5)
- Linked Hover: Barograph ↔ Map, scrubber-follows-hover, 3D sphere glider + follow-camera + scrub-persist (PR #6)
- Selectable Map Layers incl. Satellite — basemap switcher (PR #7)
- Live Instrument Readout + Compact Flight Summary Header (PR #8)
- Shared Replay Timeline + interaction rework; terrain-anchor track fix (PR #9)
- Geotagged Flight Photos — HEIC-capable decode seam, EXIF/timestamp placement engine,
  owner-only upload, viewer-scoped serving, thumbnail gallery + 2D map pins, and 3D pins
  on the replay track (SPRINT-002: PRs #10–#13)
- Profile Settings Page — `/settings` to edit handle / display name / bio, upload an avatar
  with a **pan & zoom cropper** (circular mask; 512²/128² JPEGs, EXIF stripped; HEIC falls back
  to a smart center-crop), and set **default flight privacy** (public/private) that new uploads
  inherit. Also removed the redundant header "Upload flight" button. *Both follow-ons deferred here
  have since shipped: "friends only" visibility with SPRINT-003, and the Leaf-device API token as
  Settings → Devices with the device auto-upload work.* (PR #14)
- "Keep me signed in?" after magic-link login — a `/stay-signed-in` interstitial offering a
  1-month persistent session vs. a session-only cookie; signed-in pilots are redirected from
  `/` to `/logbook` (PR #17)
- Production deploy — Railway (Nixpacks, `prisma migrate deploy` pre-release, `/api/health`
  check, pnpm-10 build pin in PR #15), live at <https://leaflog.norcalflight.com>
- Social foundation — friends (request/accept), friends-only flight visibility, kudos, friends
  feed, and friend search/autocomplete (SPRINT-003, PRs #21-26)
- 3D flight-page polish — "2D"/"3D" toggle labels, a ground-shadow footprint toggle (track draped
  on the terrain), and a Chase camera mode (Follow/Chase/Fixed) with damped heading tracking
  (PR #27)
- Leaf Device Auto-Upload — the leaf-log side of the headline VISION.md hook. A pairing-code flow
  (`POST /api/devices/pair/{start,poll}`, codes and poll handles sha256-hashed, 10-min TTL,
  single-use and claimed atomically), a token-authed `POST /api/ingest` that is a thin caller of the
  existing `ingestFlight({ source: "device_push" })` seam, and a **Settings → Devices** page to
  claim / name / revoke device keys. The browser never displays a token — the device receives it
  exactly once from `pair/poll`. Later refined to **direct HTTPS** (the firmware does TLS, so the
  Caddy front door was dropped) with device pushes honoring the owner's default visibility like web
  uploads (PR #29), then made one-tap via an **`/activate?code=…`** landing page the Leaf can show
  as a QR or link — the code survives the magic-link round-trip, and manual code entry remains as a
  fallback (PR #31). Contract for the firmware: `docs/device-api-contract.md`.
  (PRs #28, #29, #31) — *this also closes the deferred Leaf-device API token from PR #14.*
  Announced on `/whats-new` (2026-07-27) with an explicit "needs a firmware update" caveat — the
  `leaf` firmware side is still at planning status, so the server half is live and waiting.
- User-generated site locations (SPRINT-004) — a pilot can name their own unmatched takeoff or
  landing as **public** (shared gazetteer) or **private** (theirs only), directly on the flight
  page. `Site` gains `ownerId`/`visibility`/`normalizedName`; the read path
  (`lib/flights/repo.ts`) re-verifies every site id per viewer on every read, so a private site's
  name never leaks through the cached column even via a public flight — proven by a
  owner/friend/stranger/anonymous × private/public × flight-visibility matrix, a leak sweep, and
  a stale-row defence test. Naming offers nearby sites to reuse first (kind-agnostic, 2 km,
  distance + bearing) before creating a new one; creating widens an opposite-endpoint reuse to
  `kind:"both"` and never narrows, guards against concurrent duplicate creation, and retroactively
  re-associates the creator's own older unmatched flights (capped at 200). A later flight — web
  upload or device push — auto-associates with no interaction. The creator can undo (unpublish or
  delete) their own site while no other pilot's flight depends on it; once one does, it's
  community property and `scripts/admin-sites.ts` (rename / force-private / merge) is the operator
  remedy — no moderation queue in v1. (SPRINT-004, PRs #36-39)
- Removed the curated site seed — sites are now **fully community-driven**. `prisma/seed.ts` no
  longer creates the 12 curated launches (Mussel Rock, Ed Levin, etc.); every flight starts as
  "Unknown site" until a pilot names it via SPRINT-004's naming flow. `prisma/seed.ts` stays as a
  no-op entry point for any future non-site seed data; `Site.source`/`license` keep their
  `manual`/`"curated"` schema values (unused today) for a possible future gazetteer import.
  Updated the tests/fixtures that assumed curated data existed (the E2E happy-path and social
  specs, and `lib/sites/lookup.test.ts`'s curated-launch tests, now use dynamically-created
  community sites instead). (PR #40)
- Two-level site hierarchy — `Zone`, a specific launch/landing spot within a `Site` (e.g. "Mission
  Ridge — North Launch"). Matching is zone-first at a tighter radius (300 m takeoff / 400 m
  landing) with the site pass **always** running as a fallback, whether or not the winning site
  has zones — a bare site keeps matching and displaying exactly as SPRINT-004 produces, with zero
  behaviour change. Zone visibility is independent of its parent's; effective visibility is the
  conjunction (`canSeeSite(site) AND canSeeSite(zone)`), which is what lets a private spot exist
  under an otherwise-public site — the read-path firewall (`lib/flights/repo.ts`) extends to
  re-verify both levels on every read, stripping a zone whenever its site isn't visible. The
  naming dialog becomes an optional two-step flow ("Which spot?", with **Skip — just the site** as
  a first-class action); creating a zone retroactively upgrades the creator's own
  *already-site-bound* back-catalog at that spot, not only previously-unmatched flights — the fix
  for the split-logbook problem the sprint exists to solve. A site's own owner can also
  rename/unpublish/delete a zone another pilot contributed under their site, alongside the zone's
  own creator; `scripts/admin-sites.ts` gains `zone-rename` / `zone-force-private` / `zone-merge`
  (which also handles reparenting a zone to a different site) / `list` for what neither reaches.
  Along the way, found and fixed a real Postgres limitation (two FK cascade paths converging on
  one `Flight` row during a site delete) and a latent regex bug in the SPRINT-004 write-audit that
  silently stopped excluding Prettier-formatted `: true` boolean flags. (SPRINT-005) **Hidden from
  the product surface as of SPRINT-008** ("too complicated" — the user's own call) behind the
  `ZONES_ENABLED` gate, default off; every zone here is preserved data and code, not deleted, and
  a future re-enable is a re-exposure pass, not a reconstruction.
- Custom boundaries for sites and zones — a pilot can now draw a polygon that **replaces** the
  fixed-radius circle for that one `Site` or `Zone` (a versioned `jsonb` envelope + derived bbox
  columns, no PostGIS), so a 3 km ridge site can finally catch flights from both ends and two
  close-together launches can stop grabbing each other's flights. `lib/sites/lookup.ts`'s
  `findLocation` unions a boundary-bbox prefilter alongside the existing circle one (still exactly
  two DB round trips per endpoint) and every matched row — circle or boundary — gets a real
  `distanceM`, so ranking never needed a "boundary beats circle" tier. An owner-scoped picker
  (`lib/sites/associate.ts`'s `listOwnedSitesForBoundaryEditing`/`listOwnedZonesForBoundaryEditing`)
  lets a pilot edit a boundary on any site/zone they own or edit-control even with no flight bound
  to it — closing a reachability gap the original planning drafts left (the editor could otherwise
  only be reached from an already-bound flight, making "expand a ridge site" unreachable in
  practice). No radius-configurability column shipped separately — the envelope's `kind`
  discriminant is designed to absorb that as a future variant of the same column. Zone boundaries
  were deliberately left uncapped near the old circle scale (a stakeholder call, not an oversight)
  — the accepted tradeoff is documented alongside the mitigations (editor context, `boundary-clear`)
  in `docs/sprints/SPRINT-006.md`'s Risks section. Ships with a `SITE_BOUNDARY_MATCHING=off` kill
  switch, a `boundaryUpdatedById` attribution column, a per-caller daily edit cap, and
  `scripts/admin-sites.ts`'s `boundary-clear` / `zone-boundary-clear` (plus a boundary-preservation
  guard on `merge`/`zone-merge`). (SPRINT-006) **Zone boundaries specifically are hidden from
  pilots as of SPRINT-008** (see the SPRINT-005 note above) — site boundaries are unaffected.

## Manual Zone Correction on a Flight
- **Area:** Flight page / sites & zones
- **Description:** On a flight's takeoff or landing endpoint, let the pilot **remove** a
  previously bound zone (whether it was auto-matched on ingest or manually selected before) and
  **manually pick a different, nearby zone** even when it falls outside the auto-match radius.
  Motivated by a real gap: if the Leaf device starts recording a few seconds after actual launch,
  the recorded endpoint can sit meters to tens of meters past the true launch point — enough to
  miss a zone's 300 m/400 m match radius even though the pilot knows exactly which zone it was.
- **Priority:** Medium — **on hold as of SPRINT-008**, since zones are currently hidden from the
  product surface; revisit if/when `ZONES_ENABLED` is turned back on.
- **Notes:** "Remove a zone" is mostly already there in spirit (`unpublishZoneForFlight` /
  `deleteZoneForFlight` in `app/flights/[id]/site-action.ts` cover unpublishing/deleting the zone
  *itself*), but there's no existing action to simply *unbind* a flight from its matched zone
  while leaving the zone and the parent site intact. "Manually pick a nearby zone" needs a new
  picker UI — likely reusing `suggestNearbyLocations()` (`lib/sites/repo.ts`, currently a 2 km
  `SUGGEST_RADIUS_M` sweep used for site/zone creation) to list candidate zones near the endpoint,
  then a direct bind path that skips the 300 m/400 m match-radius gate entirely (an explicit pilot
  choice, not an auto-match). Should reuse `locationCachePatch`/the existing single-writer pattern
  in `lib/sites/associate.ts` rather than introduce a second write path for the same cache
  columns. *Now that SPRINT-006 shipped custom boundaries, a pilot who draws the right shape may
  need this less — but one who's drawn a boundary and still hits a mis-match will want the manual
  override more, not less (see SPRINT-006.md's "genuinely still open" list).*

## Community-Owned Public Sites & Zones
- **Area:** Sites & zones / ownership model
- **Description:** Sites and zones that are public should be "community property" rather than
  owned by a single user. There should be a "contributors" roster of users who have contributed to
  the site, and an audit history of who did what — to hold folks accountable for screwing things
  up. Other users should also be able to "upvote" the current site to add "weight" to the
  legitimacy of that site. Later on, additional metadata could be added to sites and zones.
- **Priority:** Medium — **shipped (SPRINT-007), 2026-08-23.** The zone half of this feature is
  hidden from pilots as of SPRINT-008 (`ZONES_ENABLED` off) — community ownership on **sites**
  (contributors, audit log, endorsements, community-edit v1) is unaffected and fully reachable.
- **Notes:** Shipped as community-edit v1: any signed-in, onboarded pilot may now rename or
  redraw the boundary of a PUBLIC `Site`/`Zone` — not just its owner. `ownerId` stays (creator/
  provenance, still drives publish/unpublish and the delete guard); a new append-only
  `LocationAuditEntry` table (nullable-FK + CHECK discriminator) is the accountability log,
  written only for mutations made while the row is public so private history can never leak on a
  later publish. The contributor roster is derived from the audit log (`DISTINCT actorId`), not a
  separate table — no dual-write drift risk. `SiteEndorsement`/`ZoneEndorsement` mirror the
  existing `Kudo` pattern — self-endorsement allowed, one vote per pilot per row via composite PK,
  pure display signal (no ranking/matching effect). Destructive actions (delete, demote to
  private) stay creator-gated and now also refuse once another pilot has made a real edit
  (`hasCommunityFootprint`) — a bare endorsement never blocks it. A new, non-owner-reachable
  `LocationCommunityDialog` (any viewer, including anonymous, read-only) is what makes the whole
  feature reachable — `SiteNameControl` was owner-only before this sprint, which would have made
  community editing dead code with no way to trigger it. `scripts/admin-sites.ts merge`/
  `zone-merge` carry audit/endorsement rows onto the survivor rather than dropping them; new
  `audit`/`zone-audit` operator commands. Full design/decision trail:
  [`docs/sprints/SPRINT-007.md`](docs/sprints/SPRINT-007.md). Deferred: approval queues/
  moderation voting, endorsement-weighted ranking, new metadata fields, edit-conflict locking UI,
  a minimum-flight-count edit gate.

## Hide Zones (Sites Only, For Now)
- **Area:** Sites & zones / product surface
- **Description:** After three sprints of added zone surface area (two-level hierarchy, custom
  boundaries, community ownership), the user's own call: "let's go ahead and remove zones... we
  will just keep sites. the zones are getting too complicated." Every pilot-facing zone
  affordance (naming, matching, boundaries, community info) is hidden; sites are unaffected and
  remain the app's one location concept for now.
- **Priority:** High — **shipped (SPRINT-008), 2026-08-24.**
- **Notes:** A hide, not a delete — chosen explicitly over removal after a clarifying interview.
  Zero schema migration, zero data touched: the `Zone` table, `Flight`'s zone columns, and every
  zone-aware matching/boundary/audit/endorsement code path stay exactly as they are. One
  centralized, fail-closed, default-off gate (`zonesEnabled()`, `lib/sites/zones-enabled.ts`,
  `ZONES_ENABLED` env var) is checked everywhere a pilot could otherwise reach a zone: matching
  (`findLocation` skips the `Zone` query entirely), display (`resolveEndpoint` suppresses
  zoneId/zoneName for every viewer, including on flights bound to a zone before this sprint),
  creation (`createOrAttachSiteFromFlight` rejects a zone input), the naming dialog (a
  server-derived prop threaded from `FlightHeader`, since a client component can't read
  `process.env` — the one real implementation gap the sprint's cross-critique caught), and every
  zone-parallel server action (rejects/null-returns with a generic "Zones are not available.",
  never revealing whether a given zone exists, is private, or is owned by someone else).
  `scripts/admin-sites.ts`'s `zone-*` operator commands are the one deliberate exemption — they
  keep working regardless, since a hidden zone can still need an operator remedy. Pre-existing
  zone tests are split into "gate-on legacy" (set `ZONES_ENABLED=true`, prove the hidden
  machinery still works — the reversibility proof) and "default-off" (prove the shipped hidden
  behavior); nothing was deleted or skipped. Full design/decision trail:
  [`docs/sprints/SPRINT-008.md`](docs/sprints/SPRINT-008.md). A future "bring zones back" sprint
  should be a small re-exposure pass (flip the gate, confirm the preserved suites still pass),
  not a reconstruction.
