# QA Validation Prompt — Friend search + 3D replay (CATCH-UP re-issue)

> **This is a re-issue, not new work.** The original
> [`QA-PROMPT-2026-06-29-search-3d.md`](./QA-PROMPT-2026-06-29-search-3d.md) was handed over
> on 2026-06-29 but **never ingested** — the validator repo is still at batch 006.
>
> **The original was re-verified against `main` on 2026-07-27 and has no drift at all.** No
> commit since has touched the friend-search or 3D-replay surfaces (the only intervening work
> was the device release, which added new files under `lib/devices/` and two settings
> components and left these areas alone). **Use the original prompt as-is.** This file exists
> so the catch-up batch is explicit about what to pick up and in what order.

## Order of work

Take this batch **after** the social catch-up
([`QA-PROMPT-2026-07-27-social-catchup.md`](./QA-PROMPT-2026-07-27-social-catchup.md)). Two
reasons:

1. The social batch carries the friends-only privacy matrix, which is the security-critical
   coverage gap. This batch is feature-polish validation.
2. Friend search sits on `/friends` and its inline actions (Add friend / Requested / Respond /
   Friends) are the *same* state machine the social batch exercises. Doing social first means
   the fixtures and helpers this batch needs already exist.

## Scope recap

- **Friend search** on `/friends` — autocomplete by handle and by display name, `@`-prefix
  tolerated, ≥2-char minimum, self excluded, correct inline action per relationship state,
  graceful no-match empty state.
- **3D replay** on `/flights/[id]` — the view toggle reads exactly **"2D" / "3D"**; a
  ground-shadow toggle (drape + plumb line) persisting via `localStorage` key
  `leaf-3d-shadow`; a camera control cycling **Follow → Chase → Fixed**, persisting via
  `leaf-camera-mode`, with back-compat migration of a saved `leaf-camera-follow=false` to
  **Fixed**; both controls present in 3D and absent in 2D.

## The one thing worth re-emphasizing

**Most of the 3D work is not E2E-assertable.** The draped ground shadow, the plumb line, and
the chase camera's geometry all render on a WebGL canvas that Playwright cannot meaningfully
inspect. Do not sink time into trying.

What *is* assertable, and what this batch should actually cover:
- Button **label text** ("2D" / "3D", and the camera button cycling through three labels).
- Toggle **active state** in the DOM.
- **`localStorage` persistence across reload**, including the back-compat migration.
- Control **presence in 3D and absence in 2D**.

The camera math itself is already covered by unit tests — `bearingDeg` / `headingAt` in
`lib/igc/interpolate.ts`, including the near-zero-displacement case that freezes heading while
thermalling. Re-verify those rather than reimplementing them. The "chase actually sits behind
the glider" and "the shadow looks right" properties are **manual-verification items**; flag
them as such rather than writing brittle canvas assertions.

## Regression Checks

Per the original: existing 3D replay still renders and scrubs, basemap switching works, photo
pins still hover/click, the default Follow camera still centres on the glider, the 2D tab is
unchanged, and the friends inbox and feed still work alongside the search field.

## Environment Notes

Per the original: friend search needs **≥2 other pilots** with varied handles and display
names, one with a pending request to you and one accepted friend, to exercise every inline
state. Dev auth is the magic link at `/tmp/leaf-magic-link.txt` followed by the "Keep me
signed in?" interstitial.
