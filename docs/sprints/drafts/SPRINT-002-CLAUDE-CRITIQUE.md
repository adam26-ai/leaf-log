# Claude critique of the Codex draft (SPRINT-002)

The two drafts converge on the right architecture (Postgres downscaled, `Flight`/`FlightData`-
style split, viewer-scoped serving, timestamp-first with the flight offset, pure unit-tested
placement lib). Critique focuses on deltas.

## Strengths (adopt these — better than the Claude draft)

1. **EXIF orientation normalization (`sharp.rotate()`).** The Claude draft missed this. Phone
   photos rely on the EXIF Orientation tag; once we strip metadata, an un-rotated image displays
   sideways. This is a correctness must, not a nicety. **Adopt.**
2. **Explicit, concrete caps** (12 MB input, 10/batch, 40/flight, 2048 px display, 420 px
   thumb). The Claude draft left these as open questions. Codex's numbers are sane defaults.
   **Adopt** (tune 2048→~1600 if DB size matters; otherwise fine).
3. **Drop `caption` from v1.** Correct — an unused nullable column with no edit UI is dead
   weight. The Claude draft included it speculatively. **Adopt the removal.**
4. **Nested serve route `GET /api/flights/[id]/photos/[photoId]`** (vs the Claude draft's
   `/api/photos/[photoId]`). Better: the flight id is in the path, so you authorize the flight
   via `getFlightForViewer(id, viewer)` directly and assert `photo.flightId === id` — fewer
   joins, and it mirrors the existing `/api/flights/[id]/*` shape. **Adopt.**
5. **`nosniff` header + an explicit test that served bytes contain no EXIF** (re-parse with
   `exifr`). Both are concrete security wins the Claude draft only implied. **Adopt.**
6. **`missing_flight_offset → unpinned`** (never guess from the server timezone) and **GPS
   sanity-check against inflated flight bounds with fallback to time**. Good defensive
   defaults. **Adopt.**

## Weaknesses / gaps in the Codex draft

1. **No deduplication.** The Codex draft has no `sha256` / content hash, so re-uploading the
   same file (common with multi-select or retries) creates duplicate pins. The Claude draft's
   per-flight `sha256` unique guard should be merged in.
2. **Over-modeled metadata columns.** `exifLocalDateTimeOriginal` (string), `exifOffsetMinutes`,
   AND `flightUtcOffsetMinutes` on every row is diagnostic cruft — `flightUtcOffsetMinutes`
   just duplicates `Flight.localUtcOffsetMinutes`. Keep `takenAt` (UTC) + a single
   `placementSource`/`placedBy` enum (+ optional `placementFailureReason`); drop the rest or
   log them, not store them.
3. **No `tSec` (seconds-from-takeoff) column.** Codex computes it for interpolation then throws
   it away. Storing it lets a pin hook into the **shared replay timeline we just built** (click
   a pin → scrub the glider to that moment; the photo's instant lights up on the barograph).
   That's the feature's best payoff and nearly free — keep `tSec`.
4. **6 PRs with overlapping file ownership.** PR3 and PR4 both edit
   `app/api/flights/[id]/photos/route.ts` (POST then GET), and PR1 (schema+dep only) / PR6
   (hardening+docs) are thin. Collapse to ~4–5 PRs: (1) schema + pure lib, (2) core + all
   routes + privacy tests, (3) gallery+upload UI, (4) map pins + e2e. Cleaner review units, no
   same-file churn across PRs.
5. **HEIC impact understated.** Deferring HEIC is fine, but iOS shoots HEIC **by default** — a
   large fraction of real uploads will bounce. The merged plan should (a) reject HEIC with a
   clear, actionable message, and (b) spike whether the Railway `sharp` build has libheif so a
   fast-follow is cheap. Flag this as a known v1 limitation, loudly.
6. **Multipart memory not addressed.** 10 × 12 MB = 120 MB decoded in memory per request.
   Process files **sequentially** (not Promise.all) and consider a smaller batch cap, or note
   the memory ceiling explicitly.
7. **Hover image variant.** Codex's hover preview loads the 420 px **thumb**, which is small for
   a "see the photo" hover. Consider hover = display (or a mid ~800 px variant); thumb is for
   the gallery grid. Minor, but name it.

## Definition of Done

Codex's DoD is more complete than the Claude draft's (explicit "no EXIF in served bytes", "list
queries don't select bytes", per-route 404 cases). Merge Codex's DoD wholesale, plus add:
dedupe no-op on re-upload; pin click integrates with the timeline (if `tSec` kept).

## Prioritized changes for the merged sprint

1. Keep Postgres-downscaled + `Photo`/`PhotoData` split, but a **lean** column set: add
   `sha256` (dedupe) and `tSec` (timeline); drop `caption` and the extra EXIF-diagnostic columns.
2. Adopt `sharp.rotate()`, the explicit caps, `nosniff`, and the no-EXIF-in-output test.
3. Adopt the nested `/api/flights/[id]/photos/[photoId]` serve route.
4. Collapse to ~4–5 non-overlapping PRs.
5. Process uploads sequentially; reject HEIC clearly + spike libheif availability.
6. Keep timestamp-first + flight-offset bridge; `missing_flight_offset`/out-of-window → unpinned.
