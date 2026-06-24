# SPRINT-002 Merge Notes

Consensus: opus-4.8 (Claude) + gpt-5.5 (Codex). Gemini unavailable (ineligible-tier) — the
weather report lists it as optional for Sprint Planning, so a two-model consensus stands.

## Where the drafts agreed (kept as-is)

- Postgres, downscaled, `Photo` + `PhotoData` (FlightData-style metadata/bytes split).
- Single `addPhotos()` core behind a thin route; pure, unit-tested placement lib in `lib/photos/`.
- Viewer-scoped serving via `getFlightForViewer`; owner-only upload/delete; 404 (not 403).
- Timestamp-first placement bridged through `flight.localUtcOffsetMinutes`; GPS as override.
- Out-of-window / no-time / null-offset → **unpinned** (never clamp, never guess server tz).

## Claude draft strengths adopted

- `sha256` **dedupe** (Codex's draft omitted it; its critique agreed it needs a unique
  constraint) → `@@unique([flightId, sha256])`.
- **`tSec`** (seconds-from-takeoff) stored, enabling pin→replay-timeline integration — the
  feature's best payoff, reusing the shared timeline shipped in PR #9.
- Leaner column set (dropped redundant `flightUtcOffsetMinutes`, stringly EXIF diagnostics).

## Codex draft strengths adopted

- `sharp.rotate()` orientation normalization (Claude missed it) — a correctness must.
- Concrete caps (batch/flight/dimension) and precise **naive-component** UTC parsing.
- Nested serve route `/api/flights/[id]/photos/[photoId]` (authorize flight + assert
  `photo.flightId === id`) over a global `/api/photos/[id]`.
- `nosniff`; an explicit test that **served bytes carry no EXIF**; GPS sanity-check vs inflated
  flight bounds; `missing_flight_offset → unpinned`; per-variant dims/bytes + `originalFilename`.
- MapLibre photo layer must be **re-added after `setStyle`** (same path as track/cursor).

## Critiques resolved

- **JPEG/PNG ambiguity** (Codex flagged) → resolved by the interview: accept JPEG/PNG **and
  HEIC** (HEIC converted server-side).
- **Caption / lightbox leak into v1** (Codex flagged) → caption stays deferred; **lightbox is
  IN** per the interview (prev/next + keyboard), but no captions.
- **6 vs 5 PRs** (Claude flagged overlap) → collapsed to a spike + 4 non-overlapping PRs.

## Interview decisions (override both drafts' "v1" lines)

1. **HEIC supported in v1** (iPhones default to HEIC). Adds an infra risk: `sharp` needs
   libheif on the Railway image. Mitigation: **PR-0 spike** to verify; fall back to the pure-JS
   `heic-convert` (libheif-wasm) if the native build lacks it. This is the sprint's top risk.
2. **Pin → timeline**: store `tSec`; clicking a pin scrubs the replay to that moment.
3. **Full lightbox** gallery (prev/next, keyboard), no captions.

## Deferred (explicit)

3D-replay pins, captions/editing, reordering, original-file retention, object storage,
client-side pre-resize, owner time-offset correction.
