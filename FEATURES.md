# Feature Ideas

Track potential feature ideas for future sprints.

## Leaf Device Auto-Upload (pairing + ingest API)
- **Area:** Ingestion / device integration / Account settings
- **Description:** Let a Leaf vario push recorded IGC flights straight into the owner's Leaf
  Log account — no manual export/upload. A short pairing-code flow authenticates the device
  (the vario can't do magic-link login), then flights arrive automatically via a token-authed
  ingest API. This is the headline "seamless Leaf auto-upload" hook from VISION.md.
- **Priority:** High
- **Notes:** Full leaf-log-side plan in `docs/device-upload-plan.md` (the firmware side —
  on-device config + upload — is planned in the `leaf` repo). Reuses the existing
  source-agnostic `ingestFlight({ source: 'device_push' })` seam, so parse/derive/dedupe/
  persist already work. Adds Prisma models `DevicePairing` + `DeviceToken`; routes
  `/api/devices/pair/{start,poll}` and `POST /api/ingest` (Bearer); a Settings → Devices
  UI to claim/name/revoke. Pairing codes are short-lived/single-use/rate-limited; tokens
  stored hashed. Fully testable without firmware via curl.

## User-Defined Takeoff Sites (public/private, auto-associate)
- **Area:** Sites / reverse-lookup / flight detail + onboarding
- **Description:** Let a pilot name a new site from a flight's detected takeoff
  location (when reverse-lookup returns "Unknown site") and save it as **public**
  (shared into the community gazetteer) or **private** (only theirs). Afterwards,
  any pilot whose takeoff falls close enough to that point auto-associates with the
  existing site instead of creating a duplicate — and when creating a site near an
  existing one, the app offers to reuse it rather than make a near-duplicate.
- **Priority:** Medium
- **Notes:** Extends the existing reverse-lookup rather than replacing it. **Distance
  threshold:** reuse the takeoff match radius already in `lib/sites/lookup.ts` —
  `TAKEOFF_RADIUS_M = 600` (landing is 900). ~500–600 m is the sweet spot: tight
  enough that two distinct nearby launches on the same ridge don't collapse into one,
  loose enough to absorb GPS scatter and pilots launching from different points of one
  site; for dense flying areas a 300–400 m option could be exposed later, but 600 m is
  a sound default and keeps behavior consistent with curated sites. **Data model:** add
  `ownerId String?` + `visibility` (`public`/`private`) to `Site` (curated seeds stay
  `ownerId=null`, `source="manual"`, public); set `source="user"` for pilot-created
  sites. **Privacy:** `findSite()` must become viewer-scoped (public sites ∪ the
  viewer's own private sites) — same app-layer privacy model as flights
  (`lib/flights/repo.ts`), no RLS. **Dedup/snap:** on create, run `findSite` at the
  takeoff coord first; if a match exists, suggest "use existing site" instead of
  inserting. Optional later: moderation/merge for public sites, and seeding from a
  licensed gazetteer (ParaglidingEarth) once redistribution terms are cleared.

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

## Profile "Friends Only" Visibility + Leaf-Device API Token
- **Area:** Account / profile / settings (follow-ons deferred from the shipped Profile Settings Page)
- **Description:** The two pieces of the original Profile Settings idea that were **not** shipped in
  PR #14: a **"friends only"** flight-visibility tier, and a **profile API token** for Leaf device
  auto-upload (generate / name / revoke).
- **Priority:** Medium
- **Notes:** **"Friends only" is a new visibility tier** that needs a **social/friends model**
  (follow or mutual-friend relationships) and a viewer-scoped check in `lib/flights/repo.ts` beyond
  today's public/private — ship the social feature first, then add the tier. **API token:** overlaps
  with [[Leaf Device Auto-Upload]] (`DeviceToken` + pairing) — `/settings` is the natural home for
  generate/name/revoke device tokens. (Avatar upload + cropper and default public/private privacy
  already shipped in PR #14 — see Shipped.)

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
  inherit. Also removed the redundant header "Upload flight" button. *Deferred: "friends only"
  visibility (needs a social model) and the Leaf-device API token — see [[Leaf Device Auto-Upload]].*
  (PR #14)
- "Keep me signed in?" after magic-link login — a `/stay-signed-in` interstitial offering a
  1-month persistent session vs. a session-only cookie; signed-in pilots are redirected from
  `/` to `/logbook` (PR #17)
- Production deploy — Railway (Nixpacks, `prisma migrate deploy` pre-release, `/api/health`
  check, pnpm-10 build pin in PR #15), live at <https://leaflog.norcalflight.com>
- Social foundation — friends (request/accept), friends-only flight visibility, kudos, friends
  feed, and friend search/autocomplete (SPRINT-003, PRs #21-26)
- 3D flight-page polish — "2D"/"3D" toggle labels, a ground-shadow footprint toggle (track draped
  on the terrain), and a Chase camera mode (Follow/Chase/Fixed) with damped heading tracking
