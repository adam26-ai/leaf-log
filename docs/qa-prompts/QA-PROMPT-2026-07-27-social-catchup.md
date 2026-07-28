# QA Validation Prompt — Social foundation (CATCH-UP re-issue)

> **This is a re-issue, not new work.** The original
> [`QA-PROMPT-2026-06-27-social.md`](./QA-PROMPT-2026-06-27-social.md) was handed over on
> 2026-06-27 but **never ingested** — the validator repo is still at batch 006 (Profile
> Settings) and its `e2e/` has no spec matching `friend`, `kudos`, or `feed`. The social
> layer has therefore been live in production for a month with **no independent validation**.
>
> **Read the original prompt for the full scenario detail — it was re-verified against `main`
> on 2026-07-27 and is still accurate.** This file records what has changed since, and
> re-states the privacy matrix in full because it is the security-critical part and should
> not be read second-hand.
>
> **Priority: this is the highest-value outstanding QA work in the project**, above the
> device pass issued the same day. SPRINT-003 called friends-only "the single most
> security-sensitive change in the product."

## Why this still matters after a month

The friends-only rules are enforced in exactly one place — `lib/flights/repo.ts` — and are
covered by in-repo tests (`test/privacy.integration.test.ts`, `test/social.integration.test.ts`,
both passing, and CI provisions Postgres so they cannot silently skip). But **those tests
were written by the same agents that wrote the feature.** Independent adversarial coverage of
the deny direction is exactly the gap the validator partner exists to fill, and it is the one
gap that has never been filled.

## What changed since the original prompt (2026-06-27)

Only one behavioral change touches this surface, and it **adds a new path into the
friends-only tier**:

- **Device-pushed flights now inherit the owner's default visibility** (PR #29). Confirmed on
  `main`: `lib/ingest/ingest-flight.ts` calls `normalizeVisibility(owner.defaultVisibility)`,
  and `"friends"` is a valid value. So a flight can now become friends-only **without a
  browser ever being involved** — a Leaf vario pushes it over `POST /api/ingest` and it lands
  friends-only because that is the pilot's default.

  The original prompt's "default visibility on upload" scenario only covered the web upload
  path. **Add the device path:** set the Settings default to **Friends only**, push an IGC via
  `POST /api/ingest` with a device bearer token, and confirm the resulting flight is
  friends-only — visible to an accepted friend, denied to a stranger and to anonymous. This
  needs no firmware; `curl` or Playwright's `request` fixture is enough. See
  [`QA-PROMPT-2026-07-27-device-upload.md`](./QA-PROMPT-2026-07-27-device-upload.md) for how
  to obtain a token.

Everything else on this surface is unchanged. Friend search (PR #26) shipped after the
original and is covered by the companion catch-up prompt, not here.

Two small context updates for navigation-dependent assertions:
- Nav is **Logbook · Feed · Upload · Profile**, with the avatar menu at the right (What's new
  · Settings · Sign out). Verified on `main`.
- `/settings` now also links to **Devices** (`/settings/devices`). It does not affect social
  behavior, but a settings-page assertion written against the old layout may need updating.

## The privacy matrix — restated in full (highest priority)

Set up: pilots **A & B are accepted friends**; **C** is unrelated, or has only a *pending*
request to B; plus an **anonymous** visitor. B owns three flights, one each at **Private /
Friends only / Public**.

For B's **friends-only** flight, verify on the flight page (`/flights/[id]`), B's profile
(`/@b`), and the feed:

- **Allowed:** A (accepted friend) can open it and sees it listed on B's profile.
- **Denied — and indistinguishable from a flight that does not exist:** C with only a pending
  request; an unrelated signed-in stranger; an anonymous visitor. None may see it on the
  flight page, B's profile, or the feed. **Assert not-found-equivalence, not a 403** — a
  distinguishable denial leaks the flight's existence.
- **Owner:** B always sees their own private + friends-only + public flights on their own
  profile, **including non-ready uploads** (uploaded/processing/failed).
- **Private** flight: only B. A, C, and anonymous all denied.
- **Public** flight: everyone including anonymous.
- **Revocation is immediate.** A can see B's friends-only flight; then the friendship is
  removed (by either side); on the **next** load A is denied on the flight page, on B's
  profile list, and in the feed. There is no grace period and there must not be a cached view.
- **Subresources inherit visibility.** For a friends-only flight, the map track, 3D replay,
  and photos must be denied to C/anonymous and allowed to friend A:
  `/api/flights/[id]/track`, `/replay`, `/photos`, `/photos/[photoId]`. These should 404 for
  a non-friend. **This is the most commonly missed half of a privacy bug** — the page denies
  correctly while an API route underneath it does not.
- **Both entry points into the tier:** default-visibility uploads land friends-only via the
  **web upload** (`/upload`) *and* via **device push** (`/api/ingest`) — see above.

## Remaining areas

The original prompt covers these in detail and needs no changes: **friends graph & requests
inbox** (send/accept/decline/cancel, reverse-pending auto-accept, remove, self, public graph),
**kudos** (toggle, cannot-kudos-the-unseeable, no self-kudos, friend-can-kudos-friends-only),
and **feed** (shows friends' public and friends-only ready flights, excludes private /
non-ready / own / non-friends, empty state, keyset pagination with no duplicates or gaps).

Note the feed paginates by URL cursor — `/feed?cursor=…` — so paging is directly drivable in
Playwright without UI-scrolling tricks.

## Regression Checks

As in the original (auth interstitial, account menu, sharing control, existing privacy),
plus one addition: confirm the **web upload path still honors default visibility**, since
`ingest-flight.ts` is now shared with the device path and a regression there would hit both.

## Environment Notes

Same as the original — **≥3 pilots**, magic link at `/tmp/leaf-magic-link.txt`, click through
the "Keep me signed in?" interstitial before onboarding, and "denied" means not-found.

For the new device-push scenario you additionally need a device bearer token, obtainable
entirely over HTTP with no firmware: `POST /api/devices/pair/start` → claim the code at
`/settings/devices` as the signed-in pilot → `POST /api/devices/pair/poll` returns the token.
