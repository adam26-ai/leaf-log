# QA Validation Prompt — 3D Animated Flight Replay

## Summary
The flight page now has a **2D / 3D toggle**. The 3D view renders the flight as a
true 3D track over terrain, with an **animated replay** (play/pause, a time
scrubber, and speed control) and a glider marker. This prompt covers only the new
3D replay surface — auth, upload, logbook, sharing/privacy, delete, and short ids
were covered in the first QA pass.

## Changes Overview
- A **Map / 3D replay** toggle above the flight visualization on `/flights/[id]`.
- 3D view: a WebGL map with terrain, the full track coloured by climb/sink
  (green = lift, red = sink), a glider marker, and replay controls.
- New endpoint **`GET /api/flights/[id]/replay`** returning the time-aligned 3D
  path; it is visibility-scoped exactly like the flight page (owner or public).
- The 2D map and the barograph still work; the barograph stays below both modes.

## Validation Scenarios

### 2D/3D toggle
**E2E (Route: `/flights/[id]` for a READY flight you own or that is public):**
- The viz starts in **Map** (2D) mode. A "3D replay" toggle button is present.
- Click **3D replay** → a `<canvas>` appears along with replay controls (a **Play**
  button, a range slider, and speed buttons 4×/8×/16×/32×). Click **Map** → the 2D
  map returns and the controls disappear.
- The barograph remains visible in both modes.
- Note: assert structural presence (canvas exists, controls render/respond), NOT
  pixel content — the WebGL/terrain render isn't reliable to assert headless.

### Replay controls
**E2E:**
- **Play** starts playback: the time label (top-right of the controls, `HH:MM:SS`)
  advances and the slider value increases; the button label becomes **Pause**.
- **Pause** stops the advance.
- Dragging the **slider** scrubs: the time label updates to match the slider.
- Clicking a **speed** button (e.g. 16×) marks it active (visually selected); the
  others deselect.
- Playback **loops** back to the start after reaching the end (let it run to the end
  at 32× on a short flight, or scrub near the end and play).

### Replay endpoint privacy  ← important
**E2E / API (Route: `GET /api/flights/[id]/replay`):**
- A **public** flight: returns **200** with JSON containing a non-empty `samples`
  array (each entry `[lon, lat, alt, t]`), a `vario` array of equal length,
  `durationS`, and `altSource`.
- A **private** flight: returns **404** to an anonymous client AND to an
  authenticated **non-owner** (same privacy contract as `/flights/[id]` and the 2D
  `/track` endpoint). The owner gets **200**.
- A non-existent flight id → **404**.

## Vitest scenarios (pure logic)
- `buildReplayPath` in `lib/igc/replay.ts`: given a parsed IGC + derived metrics,
  it returns `samples` of `[lon,lat,alt,t]` with **monotonic non-decreasing t
  starting at 0**, `vario.length === samples.length`, the sample count capped
  (≤ ~1500), the **last fix preserved** after downsampling, and vario **positive
  during a climb / negative during a glide** on a synthetic climb-then-glide flight
  (see `test/igc/make-igc.ts` `makeRealisticFlight`).

## Regression Checks
- The existing **2D map** still renders the amber track and fits bounds.
- The **barograph** still renders on a local-time axis.
- The flight-page metric tiles, header (named site, local time), share toggle, and
  delete control are unaffected.
- `GET /api/flights/[id]/track` (the 2D artifact endpoint) still returns 200 for a
  viewable flight and 404 for a hidden one.

## Environment Notes
- **App:** http://localhost:3000. App repo `~/code/leaf-log` (read-only for QA).
- **WebGL in Playwright:** launch Chromium with software GL so the canvas
  initializes headless, e.g. `--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader`. Terrain relief won't render meaningfully under
  SwiftShader — don't assert on terrain pixels; assert the canvas + controls +
  endpoint instead.
- **A flight with a track** is required. Upload one via `/upload` (generate a
  sample with `node --import tsx scripts/gen-fixture.ts /tmp/sample.igc`, a synthetic
  Mussel Rock flight). For the privacy cases, have one **public** and one **private**
  flight, and a second account (two accounts via the dev magic link).
- **Magic-link in dev:** no email is sent — read the sign-in URL from
  `/tmp/leaf-magic-link.txt` (delete it before requesting to avoid a stale link).
- The replay path is derived fresh from the stored raw IGC, so it works for any
  flight regardless of when it was uploaded.
