# SPRINT-002 (Claude draft): Geotagged Flight Photos

## Overview

Let a flight's owner attach photos to the flight. Each photo is **placed on the track** at
where it was taken (timestamp-first, EXIF-GPS override), shown as a hoverable pin on the 2D
map, and listed in a thumbnail gallery on the flight page. Photos inherit the flight's
visibility and are served only through viewer-scoped authorizing routes. v1 targets 2D pins +
gallery + upload; 3D pins and captions are stretch.

The feature is mostly **assembly of proven seams**: the `FlightData` "heavy bytes in a
separate Postgres row" pattern, the `ingestFlight` thin-route-+-core pattern, the
viewer-scoped `lib/flights/repo.ts`, and the replay sample interpolation (`posAt`). The only
genuinely new logic is EXIF→UTC→track-position matching, which is pure and unit-testable.

## Use Cases

1. **Owner uploads photos.** On their own flight page, the owner selects one or more JPEGs;
   each is downscaled, EXIF-stripped, placed, and appears in the gallery (placed ones also pin
   on the map).
2. **Viewer browses photos.** Anyone who can see the flight sees the gallery; clicking a
   thumbnail enlarges it; hovering a map pin shows the photo.
3. **Private stays private.** A non-owner/anon cannot list or fetch a private flight's photos
   (404), and served images carry no leaked EXIF.
4. **Graceful placement.** A photo with no usable time (or taken outside the flight window)
   still uploads and shows in the gallery, just unpinned.

## Architecture

**Storage — Postgres, downscaled, FlightData-style split (decided).** Photos are heavier than
IGC, but external object storage would add infra (bucket, signed URLs, lifecycle) out of step
with the rest of M-scale. Instead, downscale aggressively on upload and split metadata from
bytes exactly like `Flight`/`FlightData`:

- `Photo` — the light, listable metadata row (no bytea): `id`, `flightId`, `ownerId`,
  `takenAt?` (UTC), `lat?`, `lon?`, `tSec?` (seconds-from-takeoff for the pin), `pinned`
  (bool), `placedBy` (`gps` | `time` | `none`), `width`, `height`, `bytes`, `sha256`,
  `sortIndex`, `caption?`, `createdAt`.
- `PhotoData` — heavy bytes, fetched on demand: `photoId` (PK/FK), `display` (bytea, JPEG
  ≤1600px long edge, q~80), `thumb` (bytea, JPEG ≤320px). `onDelete: Cascade`.

This keeps `GET …/photos` (the gallery list) a metadata-only query, and `<img>` tags pull
bytes from per-photo serve routes — identical to how track/replay are separated from `Flight`.

**Placement (pure lib, `lib/photos/`).**
- `parsePhotoMeta(bytes)` → `{ takenAtLocal?, utcOffsetMin?, lat?, lon? }` via `exifr`
  (DateTimeOriginal, OffsetTimeOriginal, GPS).
- `placePhoto(meta, flight, samples)` → `{ lat, lon, tSec, takenAt, placedBy }`:
  1. **EXIF GPS present** → use it directly (`placedBy: 'gps'`); derive `tSec`/`takenAt` if a
     time exists, else pin without a track time.
  2. **Else time present** → bridge to UTC: `utc = local − (utcOffsetMin ?? flight.localUtcOffsetMinutes)`
     (EXIF rarely carries `OffsetTimeOriginal`, so the flight's offset is the workhorse).
     Match `utc` against sample absolute times (`takeoffMs + tSec*1000`); if within
     `[takeoff−TOL, landing+TOL]`, interpolate `lat/lon` (reuse the replay interpolation),
     `placedBy: 'time'`; else unpinned.
  3. **Else** → unpinned (`placedBy: 'none'`).

**Core (`lib/photos/add-photos.ts`).** `addPhotos({flightId, ownerId, files})`: assert owner;
load the flight + its track samples once; for each file — guard (mime ∈ {jpeg, png}, size ≤
~15 MB, count cap), `sha256` dedupe within the flight, `sharp` → display + thumb (re-encode
strips EXIF), `parsePhotoMeta` on the **original** bytes, `placePhoto`, persist `Photo` +
`PhotoData` in a tx. Returns per-file results (placed/unplaced/skipped). Thin route calls this.

**Serving (authorizing, viewer-scoped).**
- `GET /api/flights/[id]/photos` → `getFlightForViewer` gate → metadata list.
- `GET /api/photos/[photoId]/[variant]` (`thumb`|`display`) → load photo → its flight →
  `getFlightForViewer(viewer)` → 404 if not visible → stream bytea with `Content-Type`,
  `Cache-Control: private`. No EXIF (already stripped).
- `POST /api/flights/[id]/photos` (multipart) → owner-only → `addPhotos`.
- `DELETE /api/photos/[photoId]` → owner-only → cascade.

**UI.** `FlightViz` (or the flight page) fetches the photo list. `PhotoGallery` renders a
thumbnail strip + lightbox. `TrackMap` gains a `photos` prop → a `photo-pins` geojson source +
symbol/circle layer; hover a pin → MapLibre `Popup` (or reuse the cursor overlay) showing the
display image + time. Owner-only `PhotoUpload` (file input, client-side count check, optimistic
list refresh). 3D pins (deck.gl `IconLayer`) deferred.

## Implementation (ordered, each its own PR)

**PR-1 — Data model + pure placement lib (no UI, no routes).**
- Prisma `Photo` + `PhotoData`; migration; relation on `Flight` (`photos Photo[]`).
- `lib/photos/parse-meta.ts`, `lib/photos/placement.ts` (pure), `lib/photos/*.test.ts`:
  local→UTC bridging (with/without `OffsetTimeOriginal`), GPS override, in/out-of-window,
  no-time. Reuse/extract the replay interpolation so map + placement share one implementation.
- Gate: build/typecheck/lint/test.

**PR-2 — Core + upload/serve routes + privacy.**
- `lib/photos/add-photos.ts` (sharp downscale, EXIF strip, dedupe, tx persist).
- Routes: `POST /api/flights/[id]/photos`, `GET /api/flights/[id]/photos`,
  `GET /api/photos/[photoId]/[variant]`, `DELETE /api/photos/[photoId]`.
- `add exifr`. Integration tests (mirror existing privacy tests): private flight photos 404
  for non-owner/anon on list + serve; owner-only upload/delete; dedupe no-op on re-upload.
- Gate.

**PR-3 — Gallery + upload UI.**
- `PhotoGallery` (thumbnail strip + lightbox) on the flight page; owner-only `PhotoUpload`.
- Multi-file upload with per-file success/failure surfaced; optimistic refresh.
- Gate (+ a small e2e: upload → thumbnail appears).

**PR-4 — Map pins + hover popover (2D).**
- `TrackMap` `photos` prop → pin layer + hover `Popup`; wire `FlightViz`.
- e2e happy-path: upload a timestamped JPEG → pin appears → hover shows photo.
- Gate.

**PR-5 (stretch) — 3D replay pins, captions, drag-to-reposition a mis-placed pin.**

## Files Summary

- `prisma/schema.prisma` (+migration) — `Photo`, `PhotoData`, `Flight.photos`.
- `lib/photos/parse-meta.ts`, `placement.ts`, `add-photos.ts`, `*.test.ts` (new).
- `lib/igc/` — extract shared time→position interpolation if not already reusable.
- `app/api/flights/[id]/photos/route.ts`, `app/api/photos/[photoId]/[variant]/route.ts`,
  `app/api/photos/[photoId]/route.ts` (new).
- `components/flight/photo-gallery.tsx`, `photo-upload.tsx` (new); `track-map.tsx`,
  `flight-viz.tsx` (edit).
- `package.json` — `exifr`.

## Definition of Done

- Owner uploads ≥1 JPEG → downscaled, EXIF-stripped, stored; gallery shows thumbnails;
  timestamped photos pin on the 2D track; hover shows the photo.
- Un-pinnable photos upload and appear unpinned. Re-upload of the same bytes is a no-op.
- Private-flight photos 404 for non-owner/anon (list + both serve variants); public visible.
- Pure placement logic unit-tested incl. the timezone bridge; privacy integration tests;
  one e2e happy-path. All gates green.
- README/env note if any new config; no new required env (Postgres only).

## Risks

- **DB bloat** — downscaled display (~150–400 KB) + thumb (~15 KB) per photo; mitigate with
  caps (size, count/flight) and the metadata/bytes split so lists stay fast. Revisit object
  storage only if volume demands.
- **Timezone correctness** — the local→UTC bridge is the subtle bit; cover it with tests and
  fail safe to unpinned rather than mis-pin.
- **HEIC** — iPhone default; `sharp` may lack HEIC on the Railway image. v1 accepts JPEG/PNG
  and rejects HEIC with a clear message; HEIC is a follow-up.
- **EXIF leak** — must re-encode (strip) for served images; never stream original bytes.
- **Large multipart uploads** — enforce size/count limits at the route; stream/guard memory.

## Security

- Owner-only mutations (upload/delete) via session; serve/list via `getFlightForViewer`.
- Validate mime by content (not just extension) and cap size/count; re-encode to neutralize
  malicious payloads; set `Content-Disposition`/`Content-Type` deliberately; `Cache-Control:
  private` for non-public. Strip all EXIF except the coords we intentionally store as columns.

## Dependencies

- New: `exifr` (EXIF parse). Existing: `sharp` (resize/strip), Prisma, NextAuth, MapLibre.
- No new infra/env. Migration required.

## Open Questions

1. Store both display+thumb in `PhotoData`, or thumb on `Photo` for one-query galleries?
   (Draft: both in `PhotoData`; gallery uses the serve route — keeps list rows tiny.)
2. Out-of-window tolerance `TOL` (e.g. ±5 min) before leaving unpinned?
3. HEIC in v1 or follow-up? (Draft: follow-up.)
4. Max size / count-per-flight defaults?
5. Should device-push ingestion (future) also carry photos, and does the model anticipate a
   non-`web_upload` source on `Photo`?
