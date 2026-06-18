# Leaf Log — Architecture (Milestone 1)

Deployed on **Railway**: Next.js app + a Railway **Postgres** plugin, accessed via
**Prisma**. Auth is **NextAuth v5** (email magic-link via Resend). There is no
Supabase and no DB RLS — privacy is enforced at the application layer.

## The ingestion seam

There is exactly one ingestion path: `ingestFlight({ source, ownerId, bytes })`
in `lib/ingest/ingest-flight.ts`. The M1 web upload (`POST /api/upload`) is its
first caller; the future Leaf **device-push** API (`POST /api/ingest`) will be its
second, calling the same core with `source='device_push'`. Parsing, derivation,
artifact building, site lookup, and persistence never know how the bytes arrived.

```
client drag-drop ─┐
                  ├─► POST /api/upload ─┐
(future) device ──┘   (authn, guards)   ├─► ingestFlight()
                       POST /api/ingest ┘        │
   1. sha256 + dedupe (ownerId, hash)            │
   2. parseIgc(bytes)        (tolerant; never throws)
   3. deriveMetrics()        (smoothed climb/sink, gain threshold, baro→gps, tz)
   4. findSite(takeoff/landing)  ── bbox + haversine ──► Site
   5. buildTrackArtifact()
   6. ONE transaction: Flight (scalars + site refs) + FlightData (rawIgc bytea,
      track jsonb). Atomic — a failure rolls back; no orphans.
```

Files live **in Postgres**: raw IGC as `bytea`, the derived track artifact as
`jsonb`, both on `FlightData` (kept off the `Flight` row so logbook/profile lists
stay fast).

## Privacy model (application layer)

This app has **no RLS** — the **viewer-scoped repo** (`lib/flights/repo.ts`) IS the
enforcement, and every flight read goes through it:

- `getFlightForViewer(id, viewerId)` returns a flight only if it is public OR owned
  by the viewer. Used by the flight page and the track route.
- `listPublicFlights(ownerId)` powers public profiles (public + ready only).
- `listOwnFlights(ownerId)` powers the owner's logbook.
- Public profile aggregate stats are computed from **public flights only**.
- The track route (`GET /api/flights/[id]/track`) calls `getFlightForViewer` before
  returning the artifact. Raw IGC is never served.

Proven by `test/privacy.integration.test.ts` (anon / non-owner / owner) and the
Playwright happy-path.

## Auth

NextAuth v5 with the Prisma adapter and a custom email magic-link provider. JWT
sessions so the edge `proxy.ts` can read auth without a DB call (it imports only
the edge-safe `lib/auth.config.ts`, never Prisma). In production the link is sent
via Resend; in dev it's written to `/tmp/leaf-magic-link.txt` + logged.

## IGC correctness notes

- Tolerant parser: A/H/B records, `HFDTE` (+ two-digit year), UTC midnight
  rollover, sub-metre coord decoding, null-island/range rejection, zero/stuck
  baro treated as absent.
- Vario (`max climb/sink`) is computed over a ~3 s smoothing window and cumulative
  gain uses a noise threshold — raw 1 s GPS deltas would otherwise produce garbage.
- Times are stored UTC; the flight's local timezone + offset (from takeoff coords)
  drive local-time display.

## Deferred (documented, not built in M1)

- Launch-coordinate privacy zones (obfuscation on public flights).
- Community feed / following / kudos.
- Device-push API + device-auth model.
- Fuzzy near-duplicate detection; moving large blobs to object storage if they
  outgrow Postgres.
