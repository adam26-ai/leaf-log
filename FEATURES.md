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
  silently stopped excluding Prettier-formatted `: true` boolean flags. (SPRINT-005)
