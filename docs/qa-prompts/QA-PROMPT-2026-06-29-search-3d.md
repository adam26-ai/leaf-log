# QA Validation Prompt — Friend search + 3D replay (shadow, labels, chase cam)

## Summary
Two areas shipped since the social foundation: a **friend search/autocomplete** on
the Friends page, and three **3D flight-replay** upgrades — renamed 2D/3D view
buttons, a ground-shadow + glider-plumb-line toggle (an AGL cue), and a new Chase
camera mode that flies behind the glider.

## Changes Overview
- **Friend search:** on `/friends`, a search field autocompletes pilots by handle
  or display name; each result shows the correct inline action (Add friend /
  Requested / Respond / Friends).
- **3D replay** (flight detail → 3D tab): view buttons now read **"2D" / "3D"**; a
  ground-shadow toggle drapes the track's footprint on the terrain and draws a
  vertical line from the glider down to the ground; the camera control now cycles
  **Follow → Chase → Fixed** (was Follow/Fixed).

## Validation Scenarios

### Friend search (`/friends`)

**E2E scenarios:**
- **Autocomplete by handle:** type ≥2 chars of an existing pilot's handle → that
  pilot appears in the dropdown. Route: `/friends`. State: at least one other pilot
  exists.
- **Autocomplete by display name:** typing part of a pilot's display name (case
  different from stored) also matches (case-insensitive).
- **`@`-prefix tolerated:** typing `@han` matches handle `han...` the same as `han`.
- **Min length / empty:** a single character (or empty) shows no results / no
  dropdown (the search requires ≥2 chars).
- **Self excluded:** searching your own handle/name does not list yourself.
- **Inline action reflects state:** a stranger result shows **Add friend**; after
  sending, it shows **Requested**; a pilot who already requested you shows
  **Respond**; an accepted friend shows **Friends**. Clicking **Add friend** from a
  result sends the request (verify on `/friends` or the target's profile).
- **No-match:** a query that matches nobody shows an empty state, not an error.

### 3D replay — view labels & toggles (flight detail page)

Setup: a **ready** flight with a 3D replay (e.g. one with a real track). Open the
flight page and switch to the **3D** tab.

**E2E scenarios:**
- **Renamed labels:** the view toggle buttons read exactly **"2D"** and **"3D"**
  (no longer "Map" / "3D replay"). Route: `/flights/[id]`.
- **Ground-shadow toggle:** in 3D, a shadow toggle button is present; clicking it
  toggles its active (amber) state, and the choice **persists across reload**
  (localStorage `leaf-3d-shadow`). (The actual draped footprint + plumb line are
  WebGL/canvas — not assertable via DOM; verify the toggle state + persistence.)
- **Camera mode cycles Follow → Chase → Fixed:** the camera button cycles through
  all three labels on successive clicks and **persists across reload** (localStorage
  `leaf-camera-mode`). A previously-saved `leaf-camera-follow=false` should restore
  as **Fixed** (back-compat migration).
- **Toggles only in 3D:** the shadow + camera controls appear in the 3D tab and not
  in the 2D tab.

**Vitest scenarios (pure heading math — already covered, re-verify):**
- `bearingDeg` / `headingAt` in `lib/igc/interpolate.ts`: eastbound track ≈ 90°,
  northbound ≈ 0/360°, and a tight circle / near-zero net displacement returns
  `null` (the thermalling freeze). These back the chase camera.

## Regression Checks
- **Existing 3D replay still works:** the track renders, the glider sphere moves
  with the scrubber, basemap switching still works, photo pins still appear and
  hover/click. The Follow camera (default) still centres on the glider.
- **2D map tab** unchanged (track, photo pins, linked barograph cursor).
- **Friends inbox** (incoming/outgoing/accept/decline) and the **feed** still work
  alongside the new search field.
- **Flight visibility / privacy** unchanged (public/friends/private still enforced;
  the 3D and search changes don't touch the viewer-scoped repo).

## Environment Notes
- **Friend search needs ≥2 other pilots** with varied handles/display names, plus
  one with a pending request to you and one accepted friend, to exercise all the
  inline states.
- **The deck.gl/MapLibre visuals are not E2E-assertable** (ground-shadow drape,
  plumb line, chase-camera motion happen on a WebGL canvas). Cover the toggle
  *state*, label text, and localStorage persistence via Playwright; the camera
  geometry is exercised by the `headingAt` unit tests. The "Chase sits behind the
  glider" property and the shadow's look are best verified manually.
- Dev auth: magic link → `/tmp/leaf-magic-link.txt`, then click through the
  **"Keep me signed in?"** interstitial before onboarding (the repo's own e2e
  helpers do this).
