# Leaf Log: device pairing + flight ingest API

Status: **planning** · This doc covers the **`leaf-log` side only**.
The **firmware** side (on-device config page, upload logic, U8g2-SDL test harness)
is planned separately in `leaf/docs/device-upload-plan.md` and is **out of scope
here** — this side defines the contract the firmware consumes.

## Goal

Accept IGC flights pushed directly from a Leaf vario into the owner's Leaf Log
account, and provide a pairing flow so a device can authenticate without a session.

## Architecture (leaf-log's view)

```
[Leaf vario — separate repo]                    [leaf-log (this app)]
 link flow (pairing code):
   POST /api/devices/pair/start  ───────────►  mint short code + pollHandle
   show code on device screen
                                  user enters code in browser (Account → Devices)
   POST /api/devices/pair/claim  ◄───────────  session-authed: bind code → user,
                                                 mint device token
   POST /api/devices/pair/poll   ───────────►  return token once claimed
 upload:
   POST /api/ingest (Bearer token) ─────────►  token → ownerId →
                                                 ingestFlight({ source:'device_push' })
```

Two facts that make this tractable:

- **Device push is already anticipated.** `lib/ingest/ingest-flight.ts` defines
  `IngestSource = "web_upload" | "device_push"`, and `app/api/upload/route.ts`
  notes the future device API "will call the same core with `source='device_push'`."
  The shared `ingestFlight()` already does parse + derive + dedupe + persist and
  never throws on bad IGC.
- **One ingestion seam.** Keep parse/derive/persist out of routes; the device route
  is a thin caller of `ingestFlight()`, exactly like the web upload route.

## v1 decision (2026-06-30): copy/paste API key first

After review with the Leaf developer, **v1 ships the simpler, equally-secure
copy/paste API-key flow**; the pairing-code state machine below becomes **phase 2**
(the slicker "device shows a code" UX). Both end in the same place: the device holds
a Bearer token and uploads to `POST /api/ingest`.

**v1 flow:** the Leaf web app shows a "Connect to Leaf Log Online" link →
`https://leaflog.norcalflight.com/pair#payload=base64url({email?, device?})` (MAC/email
are onboarding metadata only, in the URL **fragment** so they don't hit the server or
logs) → user logs in → generates a **scoped, revocable API key** (`llk_…`, shown once,
stored sha256-hashed) → copies it into the Leaf's pilot profile → the Leaf uploads IGC
with `Authorization: Bearer llk_…`. **The key is never put in a URL.**

This dissolves the earlier HTTP / email+MAC / auto-create proposal: HTTPS + a key you
generate while signed in means no auto-create, no auto-attach, no quarantine. Multiple
on-device profiles each hold their own key (the key *is* the identity; MAC is just an
optional device label). Pre-setup flights are buffered on-device and uploaded once a
key is configured — no server-side holding store.

v1 scope: `DeviceToken` model, Settings → Devices key UI (generate/name/revoke), the
`/pair` landing page, and `POST /api/ingest` (single raw IGC body). `DevicePairing` +
the pair/start·poll·claim routes are **phase 2**.

## Auth: short pairing-code flow (phase 2 — the original "decided" design)

The web upload uses NextAuth **sessions**; a device can't do magic-link login, so
it needs its own credential. Use a **short pairing code** so no long token is ever
typed on the 5-button vario:

1. Device (already on WiFi) calls **pair/start** → gets a short, human-readable
   **code** (e.g. `ABCD-1234`) + a poll handle.
2. Device **displays the code**. User, signed in to leaf-log in a browser, enters
   it under Account → Devices to **claim** it.
3. On **claim**, leaf-log binds the pairing to the user and mints a **device
   token**. The device, **polling**, receives the token and stores it. Subsequent
   uploads use `Authorization: Bearer <token>`.

Codes are short-lived, single-use, rate-limited; tokens are stored hashed,
server-side; users can name/revoke devices.

## Workstream (leaf-log)

### Prisma models

- `DevicePairing` — code (hashed), createdAt, expiresAt, claimedByUserId?,
  deviceTokenId?, status.
- `DeviceToken` — token (hashed), ownerId, label, createdAt, lastUsedAt,
  revokedAt?.

### Routes

- `POST /api/devices/pair/start` → `{ code, pollHandle, expiresAt }`.
- `POST /api/devices/pair/poll` (with handle) → `{ status, token? }`.
- `POST /api/devices/pair/claim` → **session-authed** (browser); user submits
  code → binds pairing to user, mints token.
- `POST /api/ingest` → **Bearer-token** auth → resolve `ownerId` → guards
  (size / `.igc` / non-empty, mirror `app/api/upload/route.ts`) →
  `ingestFlight({ ownerId, bytes, source:'device_push', filename })`.
- Account → Devices UI: enter pairing code, list/revoke devices.

### Testing (no firmware needed)

`pnpm db:up && pnpm db:migrate && pnpm dev`, then:

- Drive the pairing routes with `curl`, claim in the browser.
- `curl -H "Authorization: Bearer <token>" --data-binary @sample.igc \
  localhost:3000/api/ingest`.
- Vitest coverage for ingest auth + the pairing state machine.

Follow the repo's working agreement (CLAUDE.md): feature branch + PR, ask before
committing/merging; gates `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
`pnpm e2e`.

## Open questions (leaf-log-relevant)

- Code format/length, TTL, and rate limits for pairing.
- Token format + hashing/storage; revocation UX.
- Dedup is by exact bytes (`ownerId + igcSha256`) — re-uploads are safe no-ops.
- Whether `/api/ingest` accepts a single IGC body or multipart (the firmware
  uploads one flight at a time; web upload uses multipart `files`).
