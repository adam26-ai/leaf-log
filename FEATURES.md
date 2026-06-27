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
  `/api/devices/pair/{start,poll,claim}` and `POST /api/ingest` (Bearer); an Account → Devices
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

## 3D Track Ground Shadow (height projection)
- **Area:** Flight detail page (3D replay)
- **Description:** In the 3D replay, project the flight track straight down onto the terrain
  below it — a "ground shadow" footprint draped on the surface — and optionally vertical drop
  lines (a curtain) connecting the airborne track to its ground projection. This makes
  height-above-ground legible at a glance (you can see how high each thermal and glide was over
  the terrain), like the Google Earth flight view.
- **Priority:** Medium
- **Notes:** deck.gl — add a second `PathLayer` that drapes the track's `[lon,lat]` onto the
  terrain (z = DEM elevation at each point; the terrarium DEM is already loaded), styled as a
  faint shadow line. Optionally add periodic vertical `LineLayer` segments (or a `PolygonLayer`
  wall/curtain) from track points down to their ground projection for the height effect. Reuse
  the existing replay `samples`. Keep it subtle so it doesn't fight the climb/sink-coloured main
  track; a toggle (like the camera-follow toggle) would be ideal. Pairs well with the
  center-on-sphere / fixed-camera work.

## Rename 2D / 3D Toggle Labels
- **Area:** Flight detail page (view-mode toggle)
- **Description:** Rename the flight-view toggle buttons from "Map" and "3D replay" to
  "2D" and "3D" for a tighter, clearer pair of labels.
- **Priority:** Low
- **Notes:** One-line change in `components/flight/flight-viz.tsx` — the mode toggle
  currently renders `m === "2d" ? "Map" : "3D replay"`.

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

## 3D Chase-Cam (Behind-the-Glider) View
- **Area:** Flight detail page (3D replay camera)
- **Description:** A "chase" camera mode for the 3D replay that also tracks the glider's **bearing**
  (direction of travel), keeping the camera positioned **behind and slightly above** the glider and
  looking forward along the flight path — a true third-person follow-cam. A third option alongside
  the current **Follow** / **Fixed**.
- **Priority:** Medium
- **Notes:** Builds on the existing chase camera (`centerOnGlider` →
  `setCenterClampedToGround(false)` + `jumpTo({center, elevation})` so the glider is the look-at
  point). For chase, additionally drive the map **bearing** to the glider's instantaneous heading
  (compute from the velocity vector between bracketing samples at `tSec` — add a `headingAt()` next
  to `positionAt()` in `lib/igc/interpolate.ts`) and hold a fixed pitch so the camera sits
  behind+above. **Key caveat:** thermalling (tight circles) makes raw heading spin wildly — damp it
  (low-pass / moving-average over a few seconds, or freeze the bearing when turn-rate is high) or it
  will be nauseating while circling. Distance/pitch reuse the existing chase state. Surface as a
  third toggle state (Follow / Chase / Fixed).

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

---

## Shipped
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
