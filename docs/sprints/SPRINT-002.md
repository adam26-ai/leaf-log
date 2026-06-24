# SPRINT-002 — Geotagged Flight Photos

> Planned via the multi-agent sprint-plan workflow — consensus(opus-4.8, gpt-5.5). Drafts,
> critiques, and merge notes under `docs/sprints/drafts/SPRINT-002-*`.

## Overview

Let a flight's **owner** attach photos to the flight. Each photo is downscaled and
EXIF-stripped on upload, **placed on the track** at where it was taken (timestamp-first, with
EXIF-GPS override), shown as a hoverable **pin** on the 2D map, and listed in a **lightbox
gallery** on the flight page. Clicking a pin scrubs the shared replay timeline to the moment the
photo was taken. Photos inherit the flight's visibility and are served only through
viewer-scoped authorizing routes.

The feature reuses proven seams — the `FlightData` metadata/bytes split, the `ingestFlight`
thin-route+core pattern, the viewer-scoped `lib/flights/repo.ts`, the replay sample
interpolation, and the shared playback timeline from PR #9. The genuinely new logic
(EXIF→UTC→track-position, HEIC decode) is isolated in a pure, unit-tested `lib/photos/`.

**v1 scope:** JPEG/PNG/**HEIC** upload (multi-file, owner-only); server-side rotate + downscale
+ EXIF strip; 2D map pins with hover preview; **pin→timeline scrub**; **lightbox** gallery;
owner delete. **Deferred:** 3D-replay pins, captions, reordering, original retention, object
storage, owner time-offset correction.

## Use Cases

1. **Owner uploads photos** (private or public flight): selects/drops JPEG/PNG/HEIC; sees
   per-file success/failure; successes appear in the gallery immediately; placeable ones pin on
   the map.
2. **Viewer browses**: anyone who can see the flight sees the gallery + pins; hover a pin → photo
   preview; click a pin → the replay glider/cursor jumps to that moment; open the lightbox →
   prev/next/keyboard.
3. **Private stays private**: non-owner/anon gets `404` from the list AND serve routes for a
   private flight; served bytes carry no EXIF.
4. **Graceful placement**: a photo with EXIF GPS pins from GPS; one with only a timestamp pins via
   track interpolation; one with neither usable time/GPS (or taken outside the flight window, or
   on a flight with no UTC offset) uploads and shows in the gallery **unpinned**.

## Architecture

### Storage — Postgres, downscaled, metadata/bytes split (decided)

Object storage would add buckets, signed URLs, lifecycle, and delete-consistency before there's
evidence photo volume needs it. Keep files in Postgres (the house pattern) but **never store
originals** — only sanitized derivatives — and split the listable metadata from the heavy bytes
exactly like `Flight`/`FlightData`.

```prisma
model Flight {
  // existing…
  photos Photo[]
}

model Photo {
  id                     String    @id @default(cuid())
  flightId               String
  flight                 Flight    @relation(fields: [flightId], references: [id], onDelete: Cascade)

  originalFilename       String?
  contentType            String    @default("image/jpeg") // OUTPUT type (always jpeg in v1)
  displayWidth           Int
  displayHeight          Int
  displayBytes           Int
  thumbWidth             Int
  thumbHeight            Int
  thumbBytes             Int

  takenAt                DateTime? // UTC instant of capture
  tSec                   Float?    // seconds from takeoff (timeline link) when time-placed
  exifOffsetMinutes      Int?      // diagnostic only; flight offset is used for v1
  lat                    Float?
  lon                    Float?
  altM                   Int?
  placementSource        String    @default("unpinned") // exif_gps | interpolated_time | unpinned
  placementFailureReason String?   // e.g. no_time, out_of_window, missing_flight_offset, bad_gps

  sha256                 String    // over the ORIGINAL bytes — exact-dupe guard
  createdAt              DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  data                   PhotoData?

  @@unique([flightId, sha256])     // transactional dedupe within a flight
  @@index([flightId, takenAt])
}

model PhotoData {
  photoId String @id
  photo   Photo  @relation(fields: [photoId], references: [id], onDelete: Cascade)
  display Bytes  // JPEG, ≤2048px long edge, q≈82
  thumb   Bytes  // JPEG, ≤420px long edge, q≈76
}
```

The gallery list selects metadata only (no `bytea`); `<img>` tags pull bytes from per-photo
serve routes — identical to track/replay separation.

### Pure placement lib (`lib/photos/`, no DB/Next imports, unit-tested)

- `exif.ts` — `parsePhotoMeta(bytes)` via `exifr` → `{ takenAtLocal?, exifOffsetMinutes?, gps? }`.
  Parse `DateTimeOriginal` as **naive components** (year…second); never via `new Date(string)`
  (server-tz leak). Read `OffsetTimeOriginal`, `GPSLatitude/Longitude/Altitude`.
- `time.ts` — `toUtcMs(localComponents, offsetMin)` = `Date.UTC(y,mo-1,d,h,mi,s) - offsetMin*60000`.
  Prefer `flight.localUtcOffsetMinutes`; store `exifOffsetMinutes` for diagnostics only (v1).
  Null flight offset → caller leaves unpinned (`missing_flight_offset`).
- `placement.ts` — `placePhoto(meta, flight, samples)`:
  1. **GPS** finite + in-range + within inflated flight bounds → `exif_gps`; set `takenAt`/`tSec`
     if a time exists. Invalid GPS → fall through.
  2. **Time** in `[takeoffMs, takeoffMs + durationS*1000]` → interpolate `lat/lon/altM` and set
     `tSec`; `interpolated_time`. Out of window → unpinned (`out_of_window`, **no clamp**).
  3. Else → unpinned (`no_time`).
- Extract the time→position interpolation now duplicated in `flight-viz.tsx` `posAt()` /
  `lib/flights/instruments.ts` into one shared helper used by both placement and the map.

### Image processing (`lib/photos/process.ts`)

- Accept `image/jpeg`, `image/png`, `image/heic`/`heif` (sniff by content, not just extension).
- Reject zero-byte, >25 MB input, decoded dimensions beyond a sane cap (image-bomb guard),
  corrupt (sharp/exifr throw) — per file, not whole batch.
- **HEIC**: decode to a raster first (see PR-0). Then `sharp().rotate()` (orientation) → resize →
  JPEG. **Do not** call `withMetadata()` — re-encode strips EXIF. Stored dims describe the
  **post-rotation** derivatives.
- Display ≤2048px q82; thumb ≤420px q76. Process files **sequentially / bounded concurrency**
  (10×decoded images = real memory).

### Core (`lib/photos/add-photos.ts`)

`addPhotos({flightId, ownerId, files})`: assert owner; load flight + build replay samples once;
per file → guard → `sha256` (skip dupes via the unique key) → parse EXIF on original → process →
place → persist `Photo` + `PhotoData` in a tx. Returns per-file results
(`placed|unplaced|skipped_dupe|rejected`). A bad file never fails the batch; an invalid request
does.

### Routes (thin, nested, viewer-scoped)

- `POST /api/flights/[id]/photos` — owner-only multipart → `addPhotos`.
- `GET /api/flights/[id]/photos` — `getFlightForViewer` → metadata list (no bytes).
- `GET /api/flights/[id]/photos/[photoId]?variant=thumb|display` — `getFlightForViewer` +
  `photo.flightId === id` → stream JPEG; `Content-Type: image/jpeg`, `X-Content-Type-Options:
  nosniff`, `Cache-Control: private, max-age=300`. 404 on any miss/unauth.
- `DELETE /api/flights/[id]/photos/[photoId]` — owner-only → cascade.

### UI

- `PhotoUpload` (owner-only): multi-file `<input accept="image/jpeg,image/png,image/heic,…">`,
  per-file status, optimistic refresh.
- `PhotoGallery`: thumbnail grid + **lightbox** (prev/next, keyboard, esc). No captions.
- `TrackMap`: `photos` prop → a `photo-pins` GeoJSON source/symbol layer, **re-added after
  `setStyle`** (same path as track/cursor); hover → `Popup` with a display preview; **click →
  `onPhotoSelect(tSec)`**.
- `FlightViz`: fetch the photo list; pass to `TrackMap` + `PhotoGallery`; wire pin click to the
  shared timeline (`scrubTo(tSec)` + `setActive(true)` from PR #9).

## Implementation (a spike + 4 non-overlapping PRs)

**PR-0 — HEIC decode spike (tiny, may merge into PR-2).** Verify the Railway/Nixpacks `sharp`
build decodes HEIC (libheif present). If yes, use sharp directly. If no, add `heic-convert`
(libheif-wasm, pure JS) as the decode step. Lock the approach + a fixture; document in the PR.

**PR-1 — Schema + pure lib.** `Photo`/`PhotoData` + migration + `Flight.photos`; `lib/photos/{exif,
time,placement}.ts` + the shared interpolation extraction; unit tests (UTC offsets ±/0, missing
`OffsetTimeOriginal`, null flight offset, boundary/out-of-window, GPS valid/invalid/out-of-bounds,
no-time). Add deps (`exifr`, `heic-convert` if PR-0 needs it). Gate.

**PR-2 — Core + all routes + privacy/security.** `process.ts` (rotate/resize/strip/HEIC/dims-guard)
+ `add-photos.ts`; upload/list/serve/delete routes. Integration tests: private→404 for
non-owner/anon on list+serve; owner-only mutate; wrong-flight photo fetch→404; **served bytes have
no EXIF** (re-parse with exifr); dedupe no-op; partial-batch per-file errors. Gate.

**PR-3 — Gallery + lightbox + upload UI.** `PhotoGallery` (+ lightbox), `PhotoUpload`,
owner-only delete control; wire into the flight page. Small e2e: upload a JPEG → thumbnail. Gate.

**PR-4 — Map pins + hover + pin→timeline + e2e.** `TrackMap` pin layer + hover popover + click→
scrub; `FlightViz` wiring. e2e happy-path: upload timestamped JPEG → pin appears → click scrubs
the replay → hover shows the photo. Gate.

## Files Summary

**New:** `lib/photos/{types,exif,time,placement,process,add-photos,repo}.ts` + `*.test.ts`;
`app/api/flights/[id]/photos/route.ts`, `app/api/flights/[id]/photos/[photoId]/route.ts`;
`components/flight/{photo-gallery,photo-upload}.tsx`.
**Modified:** `prisma/schema.prisma` (+migration), `package.json`/lockfile,
`components/flight/{flight-viz,track-map}.tsx`, `app/flights/[id]/page.tsx`,
`lib/flights/instruments.ts` (or wherever interpolation is extracted), privacy integration tests,
an e2e spec, `FEATURES.md`.

## Definition of Done

- Owner uploads ≥1 JPEG/PNG/HEIC to their own flight; HEIC is converted; orientation normalized;
  only sanitized display+thumb JPEGs stored (no originals); list queries select no `bytea`.
- GPS-tagged photos pin from GPS; timestamped photos pin via the flight-offset UTC bridge +
  interpolation; un-placeable/out-of-window/null-offset photos upload **unpinned** but visible.
- 2D map shows pins (surviving basemap changes); hover shows the photo; **click scrubs the replay**
  to the photo's moment; gallery offers a working lightbox.
- Upload/delete owner-only; public-flight photos visible to anon; private-flight photos `404` for
  anon + non-owner on **both** list and serve; serve route asserts flight/photo match; **served
  bytes contain no EXIF**.
- Re-upload of identical bytes is a no-op (unique `[flightId, sha256]`); partial batches return
  per-file results; size/count/dimension caps enforced.
- Pure placement logic unit-tested (incl. the timezone bridge); privacy integration tests; one
  e2e happy-path. `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm e2e` all green.
- `FEATURES.md` updated (v1 shipped / deferred noted).

## Risks

- **HEIC / libheif on Railway** *(top risk)* — native `sharp` may lack HEIC. Mitigate with PR-0:
  verify, else fall back to `heic-convert` (WASM). Don't let it block the other PRs.
- **EXIF timezone correctness** — local parsing, missing offset, null flight offset, wrong camera
  clocks, DST/boundary. Mitigate: naive-component parsing + flight offset + tests; fail to
  *unpinned*, never confidently wrong.
- **Orientation** — strip-without-rotate stores sideways photos. Mitigate: `sharp.rotate()` first.
- **Stale/bogus EXIF GPS** — validate vs inflated flight bounds; fall back to time.
- **DB growth** — caps + aggressive downscale + no originals + metadata/bytes split; object
  storage remains the scaling path if usage proves it.
- **Multipart memory** — caps + sequential/bounded processing + decoded-dimension guard.
- **MapLibre layer lifecycle / pin perf** — re-add on `setStyle`; GeoJSON layer (not N DOM
  markers); cap/cluster if many; hover loads one preview, not all.

## Security

Owner-only mutations (session). All reads authorize the parent flight via `getFlightForViewer`;
serve asserts `photo.flightId === id`; all unauthorized/missing → `404` (no existence leak).
Validate MIME by content + size + decoded dimensions; re-encode to neutralize payloads; **strip
all EXIF** from served bytes (coords live only in DB columns/JSON); `nosniff` + deliberate
`Content-Type`; `Cache-Control: private` for non-public. No public/unauthenticated static image
paths.

## Dependencies

- **New:** `exifr` (EXIF parse); `heic-convert` **iff** PR-0 finds native HEIC unavailable.
- **Existing:** `sharp` (rotate/resize/encode/strip), Prisma 6/Postgres, NextAuth, MapLibre,
  the PR-#9 shared timeline.
- Migration required; no new env/infra (Postgres only).

## Open Questions

1. PR-0 outcome: native `sharp` HEIC vs `heic-convert` fallback (perf + image size differ).
2. Final caps — input MB (HEIC can be larger), display long-edge (2048 vs 1600), batch/flight
   counts — tune against real photo sizes during PR-2.
3. Hover preview variant — `display` vs a mid ~800px variant (extra stored variant)?
4. Should the future device-push ingestion (separate sprint) also attach photos, and does
   `Photo` need a non-`web_upload` source field then? (Out of scope now; noted.)
