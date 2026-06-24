# Sprint 002 Intent: Geotagged Flight Photos

## Seed

Let pilots upload photos from a flight; photos are tagged onto the flight route on the
map (placed at the spot they were taken); hovering a tag shows the photo; photos also
appear in a thumbnail album/gallery on the flight page. See the **Geotagged Flight
Photos** entry in `FEATURES.md`.

## Context (Orientation Summary)

- **Leaf Log** is a Next.js 16 / Prisma 6 / NextAuth v5 / Postgres flight logbook,
  deployed on Railway. Private-by-default; **privacy is app-layer (no RLS)** — every
  flight read goes through the viewer-scoped repo `lib/flights/repo.ts`
  (`getFlightForViewer` / `listPublicFlights` / `listOwnFlights`).
- **Files live in Postgres**: raw IGC (`bytea`) + derived track (`jsonb`) on a separate
  `FlightData` row, kept off the `Flight` row so list queries stay fast.
- **Single ingestion seam**: `lib/ingest/ingest-flight.ts` `ingestFlight({source, ownerId,
  bytes})`; the web upload route (`app/api/upload/route.ts`) is a thin caller. Pure IGC
  logic lives in `lib/igc/` and is unit-tested (no DB/Next imports).
- The flight page already has a rich client viz: `components/flight/flight-viz.tsx`
  orchestrates `track-map.tsx` (2D MapLibre), `flight-replay-3d.tsx` (deck.gl), and the
  barograph over a shared timeline. Track/replay are fetched from authorizing routes
  `app/api/flights/[id]/track` and `/replay`.
- **`sharp`** is already a dependency (used by `gen:icons`). `exifr` is NOT yet a dep.

## Recent Sprint Context

- SPRINT-001 delivered M1 (accounts, IGC upload/parse/derive, site reverse-lookup,
  flight detail map + barograph, logbook).
- PRs #1–#9 since: short ids, 3D replay (+ terrain-anchor fixes), linked hover, selectable
  basemaps (MapTiler), live instrument readout, compact header, and a shared-timeline
  interaction rework with a rigid chase camera.
- **Directly relevant**: `lib/igc/replay.ts` exposes the aligned `[lon,lat,alt,t]` samples
  and `ReplayResponse` (`takeoffMs`, `offsetMin = localUtcOffsetMinutes`); `lib/flights/
  instruments.ts` `instrumentAt()` and `flight-viz.tsx` `posAt()` already interpolate
  position at a time — the exact machinery photo placement needs.

## Relevant Codebase Areas

- `prisma/schema.prisma` — `Flight` (ownerId, visibility, takeoffAt, landingAt,
  localUtcOffsetMinutes, bounds), `FlightData` (rawIgc bytea, track jsonb). New `Photo` model.
- `lib/flights/repo.ts` — viewer-scoped reads to mirror for photo authorization.
- `lib/ingest/`, `app/api/upload/route.ts` — upload pattern (guards, thin route → core).
- `lib/igc/replay.ts` + `lib/flights/instruments.ts` — time→position interpolation to reuse.
- `components/flight/track-map.tsx`, `flight-viz.tsx` — where map markers + gallery mount.
- `app/api/flights/[id]/*` — authorizing route pattern for serving image bytes.

## Constraints

- Follow `CLAUDE.md`: never commit to `main`; feature branch + PR per item; ask before
  commit/merge; gates `pnpm build` / `test` / `typecheck` / `lint` / `e2e` must pass.
- **Privacy is non-negotiable**: photos inherit the flight's visibility and MUST be served
  through an authorizing, viewer-scoped route (mirror `getFlightForViewer`). Owner-only
  upload/delete. **Strip EXIF** from served images except the coords we deliberately keep.
- Keep pure logic (EXIF→time, time→position matching) in `lib/` and unit-tested, free of
  DB/Next imports — mirror `lib/igc/`.
- Reuse the ingestion-seam philosophy: a single `addPhotos()` core; the route is thin.

## Success Criteria

1. An owner can upload one or more JPEGs to their flight; each is stored (downscaled) and
   appears in a thumbnail gallery on the flight page.
2. Photos with a usable capture time are **pinned on the 2D track** at the interpolated
   position; hovering a pin shows the photo (popover). Un-pinnable photos still appear in
   the gallery, unpinned.
3. Placement is **timestamp-first** (EXIF `DateTimeOriginal` → bridge local→UTC via the
   flight's `localUtcOffsetMinutes` → interpolate on the track), with EXIF GPS as an
   override when present.
4. A non-owner viewing a **public** flight sees the photos; a non-owner/anon CANNOT fetch a
   **private** flight's photos (404), enforced server-side. Served images carry no EXIF
   beyond intended data.
5. Gates green; pure matching logic unit-tested; an e2e happy-path (upload → pin → gallery).

## Verification Strategy

- **Unit** (`lib/photos/*.test.ts`): EXIF time → UTC bridging (incl. missing
  `OffsetTimeOriginal`); time→track position interpolation (reuse replay samples); GPS
  override; out-of-window / no-time → unpinned.
- **Integration**: privacy — private flight photos 404 for non-owner/anon across the
  list/serve routes (mirror existing privacy tests); owner-only upload/delete.
- **E2E** (Playwright): owner uploads a JPEG → thumbnail appears in gallery → pin on map →
  hover shows photo.
- **Manual/headless caveat**: map-pin visuals verified structurally (DOM/markers), not
  pixel-rendered (SwiftShader limits), per recent practice.

## Uncertainty Assessment

- **Correctness: Medium** — EXIF time-zone handling (local, often no offset tag) and the
  local→UTC bridge are the subtle part; placement reuses proven interpolation.
- **Scope: Medium** — clear core; the spread (map pins, hover popover, gallery, 3D pins,
  HEIC, multi-upload, captions) needs a firm v1 line.
- **Architecture: Low–Medium** — extends established patterns (Postgres-files, viewer-scoped
  repo, thin-route+core, pure lib). The one real fork is storage (Postgres-downscaled vs
  object storage).

## Open Questions

1. **Storage**: Postgres `bytea` (downscaled via `sharp`, matching the house pattern) vs
   external object storage? Lean Postgres-downscaled for v1 unless drafts surface a blocker.
   What max dimension / quality / per-photo + per-flight caps?
2. **Photo↔FlightData split**: separate `Photo` rows with `bytea`, or a new
   `PhotoData`-style split (metadata row vs blob) so the gallery list stays light? Thumbnail
   stored separately from the display image?
3. **Placement tolerance**: how far outside `[takeoffAt, landingAt]` still pins (clamp to
   nearest endpoint vs leave unpinned)? Default caption (time/altitude)?
4. **v1 line**: are 3D-replay pins, HEIC support, captions, and reordering in or out of v1?
5. **Upload UX**: drag-drop multi-file with client-side resize before upload, or
   server-only resize? Progress / failure handling for a partial batch.
6. **Abuse/limits**: max file size, allowed mime types, per-flight photo count, and how the
   `/api/ingest` device-push future (separate sprint) might also attach photos.
