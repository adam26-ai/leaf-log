# QA Validation Prompt — Leaf device auto-upload (pairing, ingest, activation)

## Summary

A Leaf vario can now push its recorded IGC flights straight into the owner's Leaf Log
account — no SD card, no manual upload. A short **pairing code** links a device to an
account, after which the device holds a revocable **bearer key** and uploads flights to
`POST /api/ingest`. The pilot can claim a device by typing the code under
**Settings → Devices**, or with one tap via an **`/activate?code=…`** link the Leaf shows
as a QR code.

This is the first QA pass over the device surface. It is also the product's **first set of
publicly reachable write endpoints** — `pair/start` and `pair/poll` take no authentication
at all, and `/api/ingest` is authenticated by a bearer token rather than a browser session.
That shift is the reason this pass matters more than its size suggests.

> **Note on the delta:** PR #27 (3D ground shadow / 2D-3D labels / chase camera) is in the
> commit range since the `.qa-prompt-last-run` marker, but it was already covered by
> `QA-PROMPT-2026-06-29-search-3d.md` — the marker simply wasn't bumped. **Skip it.** This
> prompt covers PRs #28, #29, #31 only.
>
> **Two earlier prompts were never ingested** (`QA-PROMPT-2026-06-27-social.md` and
> `QA-PROMPT-2026-06-29-search-3d.md`) — the validator's `e2e/` has no friends/kudos/feed
> spec. If you are catching up, the social privacy matrix is the higher-priority backlog
> item; this device pass and that one are independent.

## Changes Overview

**Pairing (device ↔ account)**
- `POST /api/devices/pair/start` — **unauthenticated**. Mints a 6-char code plus an opaque
  base64url poll handle; returns both in plaintext along with `expiresAt`. Code alphabet is
  deliberately unambiguous (`23456789ABCDEFGHJKMNPQRSTUVWXYZ` — no 0/O/1/I/L). TTL 10 min.
  Both code and handle are stored **sha256-hashed**.
- `POST /api/devices/pair/poll` — **unauthenticated**, body `{ pollHandle }`. Returns one of
  `pending` / `claimed` (with the token, **once only**) / `consumed` / `expired` / `unknown`.
- Claiming is session-authed (`claimDeviceAction`): binds the pairing to the signed-in
  profile, mints a `DeviceToken`, and stores the plaintext key on the pairing row until the
  device collects it.

**Settings → Devices** (`/settings/devices`)
- A pairing-code entry form with an optional device name (max 60 chars).
- A list of device keys showing label, created, last used, and revoked state; each can be
  revoked. Revocation is owner-scoped.
- The browser **never displays the key itself** — only the device receives it, via `poll`.

**Activation link** (`/activate?code=…`)
- Signed in + onboarded → a one-tap "Connect this Leaf" confirm with an optional name.
- Not signed in → "Sign in to connect", preserving `next=/activate?code=…` so the code
  survives the magic-link round trip.
- Signed in but not onboarded → "Finish setting up" pointing at `/onboarding`.
- No `code` in the URL → a friendly "start the connection again on your Leaf" message.

**Ingest** (`POST /api/ingest`)
- `Authorization: Bearer llk_…`, raw IGC bytes as the body, optional `X-Filename` header.
- Thin caller of the shared `ingestFlight({ source: "device_push" })` seam — same parse /
  derive / dedupe / persist path as web upload.
- Limits: empty body → 400, > 5 MB → 413, missing/malformed key → 401, revoked key → 401.
- Device pushes **honor the owner's `defaultVisibility`**, same as web uploads. (This
  changed in PR #29 — #28 forced device flights private because the original transport was
  plain HTTP. That reasoning is gone now that the device speaks HTTPS directly.)

## Validation Scenarios

### Pairing lifecycle — the highest-value area

**E2E scenarios** (drive the API with Playwright's `request` fixture; no device needed):

- **Happy path, end to end.** `pair/start` → claim the code in the UI at
  `/settings/devices` as a signed-in pilot → `pair/poll` returns `status: "claimed"` with a
  `llk_`-prefixed token → `POST /api/ingest` with that token → the flight appears in that
  pilot's `/logbook`. This is the whole feature in one test.
- **The token is delivered exactly once.** Poll again after a successful claim-and-collect;
  it must return `consumed` and **must not** return the token a second time. Then confirm
  the already-collected token still works against `/api/ingest` — consuming the *pairing*
  must not invalidate the *key*.
- **Codes are single-use.** Claim a code, then try to claim the same code again (as the
  same pilot and as a second pilot). Both must fail with the invalid-or-expired message,
  and no second `DeviceToken` may be created.
- **Expiry.** A pairing older than its 10-minute TTL must not be claimable, and polling it
  must return `expired` rather than `claimed`. Note the implementation **nulls the stored
  plaintext token on expiry** — verify an expired-after-claim pairing can never yield a
  token. Seeding a row with a past `expiresAt` is the practical way in.
- **Unknown handles.** Polling a well-formed but never-issued handle returns `unknown` —
  never `pending`. (`pending` on an unknown handle would let an attacker distinguish real
  handles from fake ones.)
- **Codes are case- and separator-insensitive on entry.** A code shown as `K7M2QP` must
  claim when typed `k7m2qp` or `k7m-2qp`. This is a real pilot-typing path.

**Worth probing (design question, not a known bug):** between claim and collection, the
plaintext device key is stored on the `DevicePairing` row (`tokenPlaintext`). It is cleared
on collection and on expiry, so the window is bounded — but confirm there is **no route,
page, or server action that ever returns it to a browser**. Only `pair/poll`, holding the
opaque handle, should be able to read it.

### Ingest endpoint

**E2E scenarios:**

- **Auth rejection matrix**, all against `POST /api/ingest`: no `Authorization` header;
  `Bearer` with a malformed key (not `llk_`-prefixed); a well-formed but non-existent key;
  and — most importantly — **a key that was valid and has since been revoked** in
  `/settings/devices`. All must be `401`, and none may create a flight.
- **Cross-account isolation.** Pilot A's device key must upload only into A's logbook.
  Confirm the resulting flight's owner is A and that it does not appear in B's logbook.
- **Body limits.** Empty body → 400. A payload over 5 MB → 413. Neither creates a flight.
- **Dedupe.** Pushing the same IGC twice returns `deduped: true` on the second call and
  leaves exactly one flight — the device will retry after a dropped connection, so this is
  the normal case, not an edge case.
- **Visibility follows the owner's default.** Set the pilot's default to private, push a
  flight, confirm it is private and invisible to an anonymous visitor; set the default to
  public, push a different flight, confirm it is publicly visible. **This is a deliberate
  behavior change in PR #29** and deserves an explicit test in both directions.
- **Garbage IGC.** A non-IGC or truncated body must not 500 — `ingestFlight` is documented
  never to throw on bad IGC. Confirm the failure is graceful and reported in the response.

### Activation page

**E2E scenarios** — all four render states at `/activate`, which is the pilot's first
impression of the feature:

- **Signed in + onboarded:** `/activate?code=<valid>` shows "Connect this Leaf" naming the
  pilot; tapping it claims the device, shows the connected confirmation, and the device
  appears in `/settings/devices`.
- **Signed out:** the page offers "Sign in to connect", and **the code survives the whole
  magic-link round trip** — after completing sign-in the pilot lands back on `/activate`
  with the same code and can claim. This is the most breakable step in the flow.
- **Signed in, not onboarded:** the finish-setup prompt appears and points at `/onboarding`
  (do not claim silently).
- **No code / bad code:** `/activate` with no `code` shows the "missing its activation code"
  message; `/activate?code=ZZZZZZ` fails on tap with the invalid-or-expired error rather
  than an unhandled crash.
- **Security invariant:** the QR link only replaces *typing* the code — it must never
  bypass login. Hitting `/activate?code=<valid>` while signed out must not claim anything.

### Settings → Devices

**E2E scenarios:**

- Claim a device with a custom name → the name appears in the list. Claim without a name →
  it falls back to "Leaf device".
- A name over 60 chars is rejected with a visible message.
- Revoke a key → the row shows revoked, and that key is immediately rejected by
  `/api/ingest` (pair with the auth-matrix test above).
- **Revocation is owner-scoped:** pilot B must not be able to revoke pilot A's key by id.
  Server-action-level test.
- `lastUsedAt` updates after a successful ingest — the pilot's only signal that the device
  is actually working.
- The page requires a session: signed out, `/settings/devices` must not render another
  pilot's keys.

### Rate limiting — expected gap, please confirm and report

There is **no rate limiting anywhere in the codebase** (`pair/start`, `pair/poll`,
`/api/ingest` are all unthrottled) — confirmed by grep, and flagged as a follow-up in PR
#28 that has now been tracked in `FEATURES.md`. This is **known and not a bug report**, but
it would be useful to quantify: how many pairings can one client mint in a burst, and does
a poll-handle guessing loop hit anything at all? Numbers would help prioritize the fix
before real devices ship.

## Regression Checks

The device work touched one shared file — `lib/ingest/ingest-flight.ts` — which the **web
upload path also uses**. Smoke-test that path:

- Browser upload at `/upload` still parses, derives, and shows a flight page.
- Web-upload dedupe still works, and web uploads still inherit the owner's default
  visibility.
- The private/friends-only/public matrix on `/flights/[id]` is unchanged.

Also confirm `/settings` still renders correctly with the new Devices entry point, and
`/whats-new` shows the new "Your Leaf uploads its own flights" entry at the top.

## Environment Notes

- **No firmware required.** Every scenario is reachable with `curl` or Playwright's
  `request` fixture — the device is just an HTTPS client. `pair/start` and `pair/poll` need
  no auth; only claiming needs a browser session.
- Two pilot accounts are needed for the cross-account and owner-scoping tests.
- Expiry tests need a pairing row with a backdated `expiresAt` (10-min TTL is impractical to
  wait out); seed directly.
- Existing in-repo coverage to **avoid duplicating**: `lib/devices/pairing.test.ts` and
  `token.test.ts` (pure helpers — alphabet, normalization, hashing, bearer parsing) and
  `test/devices.integration.test.ts` (token hash/resolve/revoke/touch, the pairing state
  machine, deliver-once, expired codes, ingest dedupe and default visibility). Those were
  written by the same agents that built the feature — **independent E2E coverage of the
  browser-facing flows (`/activate`, `/settings/devices`) and the HTTP-level auth rejection
  matrix is the real gap.**
