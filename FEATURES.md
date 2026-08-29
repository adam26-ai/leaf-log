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
- **Priority:** Medium — **shipped, 2026-08-29 (PR #51).**
- **Notes:** Landed as a live glider marker rather than a static site marker (the design evolved
  through live iteration): a composed badge + green name-plate band (pilot's display name, not
  site name) anchored to the glider's current position on the flight path, a live
  "`<altitude>` ASL" readout connected by a short leader line, and a paraglider-icon badge on top —
  all baked into one canvas image drawn via a single `IconLayer` (sidesteps a `TextLayer`
  rotation-truncation bug and a world-metres sizing problem hit along the way). Anchors to
  whichever is higher of the flight path or queried ground so it can't end up buried in terrain.
  The 2D map's flat pins were left unchanged, as anticipated.

## USHPA Rating Progress & Flight Instructor Sign-offs
- **Area:** Flight metadata / Social (instructor assignment) / new "Ratings Progress" page
- **Description:** Leaf Log License progress functionality. Adds flight notes, flight type, and
  flight-instructor metadata to each flight. A flight instructor can be assigned from your
  accepted friends; that instructor can then add instructor notes and mark the flight against
  various USHPA license-level criteria signoffs (e.g. precision landings). A new "Ratings
  Progress" page shows a pilot's progress toward each available USHPA rating, combining
  auto-calculated criteria (from logged flight data) with instructor-marked signoffs for the
  criteria that require a witnessed skill demonstration.
- **Priority:** High
- **Notes:** Researched against USHPA's official Pilot Proficiency System, **SOP-12-02
  (V.2017-3-4, last amended March 2017)** — this is the most recent published version found;
  re-verify against USHPA's current SOP before implementation in case of a newer revision. The
  paragliding ladder is P0 (Student/tandem) → P1 (Beginner) → P2 (Novice) → P3 (Intermediate) →
  P4 (Advanced) → P5 (Master). P0/P1 are pre-solo, instructor-supervised territory with little
  flight-log data to hang a progress view on, and P5/Master is a separate, much larger
  points-based award (1,450 points across categories like airtime, flights, altitude gain,
  cross-country miles, site/glider diversity, competition results — see SOP-12-02 §12-02.10 for
  hang gliding / §12-02.17 for paragliding) — **P2, P3, and P4 are the practical MVP scope**;
  P1/P5/Special Skill endorsements (Ridge Soaring, Cross Country, High Altitude Launch, etc.) are
  real parts of the same system but a natural v2.

  **Auto-calculable today or with data Leaf Log already has/plans (no instructor needed):**
  - P2: minimum 25 logged flights.
  - P3: minimum 30 flying days, minimum 90 total flights, minimum 20 hours solo airtime.
  - P4: 250 flights; minimum 80 flying days; minimum 75 hours total airtime; flown at least 5
    different sites (using the existing `Site` model for site diversity); flown at least 5
    different canopies (using the already-parsed `Flight.glider` string, with a data-quality
    caveat — pilots may name the same wing inconsistently across uploads).
  - P4's tandem-hour sub-limits (≤25 of the 75 hours tandem, ≤10 of the 25 thermal hours tandem)
    become auto-calculable once this feature's own proposed `flightType` field (solo/tandem)
    exists — a nice example of the new metadata directly unlocking an existing auto-calc gap.

  **Partially auto (needs new track analysis, not just metadata — flag as a stretch goal, treat
  as instructor-tagged for v1):**
  - P4 requires specific flights "in thermal lift without sustaining ridge lift" (three 1-hour
    flights from ≥2 sites) and "in ridge lift without sustaining thermal lift" (one 1-hour
    flight). Duration and site-count are already auto-calculable; classifying a flight's LIFT
    TYPE from its own track shape (sustained circling vs. back-and-forth ridge traversal) is not
    something Leaf Log currently derives, though it's plausible future work.
  - P4's "5 sites... of which at least 3 were inland" needs a coastal/inland attribute on `Site`
    that doesn't exist today.

  **Requires instructor sign-off (witnessed maneuvers/technique — inherently subjective, not
  verifiable from a GPS track alone, and USHPA's own rules require a human witness regardless):**
  - Every "Demonstrated Skills and Knowledge" task at every level: forward/reverse inflations,
    ground handling/kiting, S-turns, 180°/360° turns, asymmetric wing collapses, surge control,
    PLF technique, simulated reserve deployment, verbal flight-plan/conditions analysis, written
    exams, and "convince the Instructor or Observer" the pilot can fly rated sites safely.
  - **Precision/spot landings specifically** (the example named in the request): P2 requires 5
    landings within 25' of a target, P3 within 10', P4 three consecutive within 10' (target moved
    between each, minimum 1 minute and 200' AGL). USHPA requires a human witness for these
    regardless of GPS accuracy. A nice hybrid: Leaf Log could auto-detect a flight's actual
    touchdown point and, if a landing target/zone were tagged, surface a "candidate precision
    landing" (measured distance-to-target) for the instructor to confirm or reject — but the
    signoff itself must stay instructor-gated, matching USHPA's rule.
  - P2's 8-hour ground-school theory requirement isn't flight data at all and would need separate
    manual logging (by the pilot or instructor) rather than any kind of auto-calculation.

  **Shape of the build** (for future planning, not decided here): new `Flight` fields — `notes`
  (free text), `flightType` (solo/tandem/tow), `instructorId` (a `Profile` relation, constrained
  to accepted friends via the existing `lib/social/friends.ts` model). A new `InstructorNote`
  model, separate from the pilot's own flight notes, editable only by the assigned instructor and
  visible only to instructor + pilot (never public). A new rating-criterion/signoff model
  tracking per-pilot progress per task — auto-computed criteria refreshed from flight data,
  instructor-marked criteria stored as an explicit signoff record (which instructor, when). A new
  page (e.g. `/ratings`) aggregating both into a per-rating-level progress view.

## Flight Edit Page
- **Area:** Flight page — new owner-only edit flow
- **Description:** Flight edit page that allows ability to update flight visibility for now.
  Later it will add more. Closes a real gap: the flight page's own visibility control was just
  simplified to a read-only icon (Lock/Users/Globe) rather than an inline clickable toggle, on
  the understanding that real editing would move to a dedicated edit page — this is that page.
- **Priority:** High — **shipped, 2026-08-29.** `/flights/[id]/edit` (owner-only, 404 otherwise)
  now covers visibility (the three-way control moved here from the old inline `ShareToggle`,
  reusing `setVisibility` unchanged), a new free-text **notes** field (`Flight.notes`, migration
  `20260829185017_add_flight_notes`, shown on the flight page in its own card when set), photo
  upload (`PhotoUpload` reused as-is), and the flight-delete action (moved here from the bottom of
  the flight page). A pencil icon next to the visibility/kudos icons on the flight page links here.
- **Notes:** Remaining follow-up: the three e2e specs (`test/e2e/happy-path.spec.ts`,
  `community.spec.ts`, `social.spec.ts`) that stand in for visibility changes with a direct Prisma
  write in their setup steps haven't been switched to drive the real edit-page UI yet. Notes are
  owner-only for now (never shown to other viewers, even on a public flight) — a deliberate,
  conservative default given a note could be self-critical ("sketchy LZ, avoid"); revisit if pilots
  want notes to be public alongside a public flight. Photo delete/management still lives on the
  flight page's existing gallery, not duplicated here.

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

## Auto-Detect Co-Flying Friends and Overlay Their Track
- **Area:** Flight detail page — 3D replay / friend graph
- **Description:** Automatically detect when a friend (per the existing friend graph) was also
  flying at the same time and place as one of your flights, and surface their flight as an option
  to overlay on the 3D replay — so you can turn their track on alongside your own and see how the
  flight went together.
- **Priority:** Medium
- **Notes:** Detection needs both a temporal and spatial overlap check between the viewer's flight
  and a friend's flight — not just "same takeoff site," since a shared site alone doesn't mean they
  flew together (could be hours apart). A reasonable heuristic: the two flights' time windows
  overlap AND their tracks pass within some distance threshold (e.g. a few hundred meters, reusing
  `haversineM` from `lib/geo/distance.ts`) during that overlap. Only ever surface a friend's flight
  if it's visible to the viewer under the normal privacy rules (`getFlightForViewer` /
  friends-visibility) — never leak a friend's private flight just because it happens to overlap.
  UI-wise this could be a new entry in the 3D replay's right-side icon rail (alongside the recently
  added Camera/Basemap/Shadow controls in `components/flight/flight-viz.tsx`), listing detected
  co-flying friends by name with a toggle per friend; overlaying a track can likely reuse the same
  `PathLayer`/`IconLayer` machinery `flight-replay-3d.tsx` already uses for the viewer's own glider
  and path, just keyed to a second flight's replay data.

## Custom Glider Marker Color
- **Area:** Profile settings / 3D replay marker
- **Description:** Let a pilot choose the color of their own glider marker badge in the 3D replay,
  instead of the current fixed green for everyone.
- **Priority:** Medium
- **Notes:** Today the badge/connector-dot color is a single hardcoded constant, `LEAF_GREEN` in
  `components/flight/flight-replay-3d.tsx` (used for the connector dot and the badge fill). Making
  it a per-profile setting means adding a color field to `Profile`, a picker on `/settings`, and
  threading it into `FlightReplay3D` as a prop instead of the constant. This pairs naturally with
  the "Auto-Detect Co-Flying Friends and Overlay Their Track" idea above — distinct marker colors
  per pilot would make two overlaid tracks much easier to tell apart at a glance.

## Flight Path Data-Coloring Modes
- **Area:** 3D replay — flight path rendering
- **Description:** Flight path should be a strong solid color by default, and then the user should
  have the ability to "paint" the flight path with different data indications — for example speed,
  sink/climb rate, and potentially others.
- **Priority:** Medium
- **Notes:** The plumbing for this mostly already exists — the path is currently ALWAYS colored by
  vario via `varioColor()` in `components/flight/flight-replay-3d.tsx`, applied per-segment through
  the `PathLayer`'s `getColor: (s) => s.color`. This feature is really about (1) making a plain
  strong single color the default instead of the always-on vario coloring, (2) adding a "solid"
  color mode alongside a "climb/sink" mode (the existing `varioColor` logic) and a new "speed" mode
  (color segments by ground speed, e.g. a min/max gradient across the flight), and (3) exposing a
  mode picker — a natural fit for the 3D replay's new right-side icon rail (alongside the
  Camera/Basemap/Shadow controls just added to `components/flight/flight-viz.tsx`). Other candidate
  data dimensions once the mode-switching plumbing exists: altitude, and (if the "Custom Glider
  Marker Color" or "Auto-Detect Co-Flying Friends" ideas above ship) per-pilot identity coloring.
