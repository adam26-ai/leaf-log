# Leaf Log: device pairing + flight ingest API

Status: **v1 implementation** · This doc covers the **`leaf-log` side only**.
The **firmware** side (on-device config page, upload logic, U8g2-SDL test harness)
is planned separately in `leaf/docs/device-upload-plan.md` and is **out of scope
here** — this side defines the contract the firmware consumes.

## Goal

Accept IGC flights pushed directly from a Leaf vario into the owner's Leaf Log
account, and provide a pairing flow so a device can authenticate without a browser
session.

## Architecture (leaf-log's view)

```
[Leaf vario — separate repo]                    [leaf-log (this app)]
 pairing-code flow:
   POST /api/devices/pair/start  ───────────►  mint short code + pollHandle
   show code on device screen
                                  user enters code in browser (Settings → Devices)
                                  session-authed server action binds code → user,
                                                 mints device token
   POST /api/devices/pair/poll   ───────────►  return token once claimed, once only
 upload:
   POST /api/ingest (Bearer token) ─────────►  token → ownerId →
                                                 ingestFlight({ source:'device_push' })
```

The device calls `pair/start`, `pair/poll`, and `/api/ingest` over plain HTTP via
the Leaf Log reverse proxy. TLS termination and any device-network routing live in
the proxy layer; the app still treats the device token as a bearer secret and keeps
device-pushed flights private by default.

Two facts that make this tractable:

- **Device push uses the existing ingestion seam.** `lib/ingest/ingest-flight.ts`
  defines `IngestSource = "web_upload" | "device_push"`. The shared
  `ingestFlight()` does parse + derive + dedupe + persist and never throws on bad
  IGC.
- **One upload path.** Keep parse/derive/persist out of routes; the device route is
  a thin caller of `ingestFlight()`, exactly like the web upload route.

## v1 decision (2026-06-30): pairing code first

v1 uses the short pairing-code flow: the device requests a code and opaque poll
handle, the pilot enters the code while signed in under Settings → Devices, and the
device polls with the handle until it receives the real upload token. The browser
never displays the token, and the token is delivered to the device only once.

This replaces the earlier copy/paste API-key proposal. The device still ends in the
same place: it stores a scoped, revocable `llk_…` bearer token and uploads IGC with
`Authorization: Bearer llk_…`.

## Auth: short pairing-code flow

The web app uses NextAuth **sessions**; a device cannot do magic-link login, so it
needs its own credential. Use a **short pairing code** so no long token is typed on
the vario:

1. Device calls **pair/start** → gets a six-character, human-readable **code** plus
   an opaque poll handle.
2. Device **displays the code**. User, signed in to Leaf Log in a browser, enters
   it under Settings → Devices to **claim** it.
3. On **claim**, Leaf Log binds the pairing to the user's profile and mints a
   `DeviceToken`.
4. The device, **polling**, receives the token once and stores it. Subsequent
   uploads use `Authorization: Bearer <token>`.

Codes are short-lived, single-use, rate-limitable, and stored only as SHA-256
hashes. Tokens are stored hashed server-side; users can name/revoke devices.

## Workstream (leaf-log)

### Prisma models

- `DeviceToken` — token hash, ownerId, label, createdAt, lastUsedAt, revokedAt.
- `DevicePairing` — code hash, poll-handle hash, status (`pending` / `claimed` /
  `consumed`), optional label, claimed owner, device token id, temporary plaintext
  token bridge, createdAt, expiresAt.

### Routes and actions

- `POST /api/devices/pair/start` → `{ code, pollHandle, expiresAt }` (public device
  endpoint; add per-IP rate limiting before broad exposure).
- `POST /api/devices/pair/poll` with `{ pollHandle }` → `{ status, token? }`
  (public device endpoint; token appears only on the first claimed poll).
- Settings → Devices server action `claimDeviceAction(code, label?)` →
  **session-authed**; user submits code → binds pairing to the signed-in profile and
  mints the device token. There is no public claim route.
- `POST /api/ingest` → **Bearer-token** auth → resolve `ownerId` → guards
  (size / non-empty, mirror `app/api/upload/route.ts`) →
  `ingestFlight({ ownerId, bytes, source:'device_push', filename })`.
- Settings → Devices UI: enter pairing code, list/revoke devices.

### Privacy

Device-pushed flights are forced **private** in `lib/ingest/ingest-flight.ts`, even
when the owner's default visibility is public. The device credential may traverse
plain HTTP between the Leaf and reverse proxy, so a stolen token must never be able
to publish flights publicly under the pilot's identity.

### Testing (no firmware needed)

`pnpm db:up && pnpm db:migrate && pnpm dev`, then:

- Drive `pair/start` and `pair/poll` with `curl`, claim in Settings → Devices.
- `curl -H "Authorization: Bearer <token>" --data-binary @sample.igc \
  localhost:3000/api/ingest`.
- Vitest coverage for ingest auth + the pairing state machine.

Follow the repo's working agreement (CLAUDE.md): feature branch + PR, ask before
committing/merging; gates `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
`pnpm e2e`.

## Open questions (leaf-log-relevant)

- Exact public rate-limit policy for `pair/start` and `pair/poll`.
- Cleanup schedule for expired `DevicePairing` rows.
- Dedup is by exact bytes (`ownerId + igcSha256`) — re-uploads are safe no-ops.
- Whether `/api/ingest` accepts a single IGC body or multipart (the firmware uploads
  one flight at a time; web upload uses multipart `files`).
