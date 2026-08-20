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

## Site privacy seam (SPRINT-004)

Sites are the app's first shared, user-generated content: a public site is
authored by one pilot and lands in **every** pilot's logbook. That mandates a
second, narrower privacy seam alongside the flight one above — the same "no
RLS, enforcement lives in one repo layer" shape, applied to `Site`.

- `Flight.{takeoff,landing}SiteId/SiteName` are a **cache**, not the source of
  truth. `Site` (`ownerId`, `visibility`) is authoritative whenever the id is
  non-null; the cached name is used only as the historical fallback when the
  id is null (e.g. a deleted site).
- `resolveSiteFields()` in `lib/flights/repo.ts` re-verifies **every**
  non-null site id on a page against the live `Site` row for the current
  viewer — not just rows whose cached name happens to be null — before it
  reaches any caller. The `Site` row wins when visible; both the id and the
  name are stripped when it isn't. This is what lets a public flight bound
  to a private site render "Unknown site" to everyone but its owner.
- `lib/sites/associate.ts`'s `siteCachePatch` is the **only** thing allowed
  to write those four columns (an automated audit, `lib/sites/write-audit.test.ts`,
  fails the build if any other file both writes `Flight` and assigns a
  site-name value). Ingest re-reads a matched site **inside** its create
  transaction and re-verifies it's still visible to the owner, so a
  concurrent demotion between match and write can never cache a name the
  owner no longer has any claim to.
- Site read scoping (`siteVisibleWhere` / `canSeeSite`, `lib/sites/repo.ts`
  and `lib/sites/visibility.ts`) is fail-closed: unknown visibility ⇒
  private; no viewer ⇒ public only; a private site with a null owner (an
  orphan) is visible to **nobody**, owner-shaped viewer included.
- Write-time and read-time scoping are deliberately separate. Ingest and the
  "name this site" flow bind within `public ∪ the owner's own private
  sites`; display always re-scopes to whoever is actually looking.

Proven by `test/sites.integration.test.ts`: an owner/friend/stranger/anonymous
× private/public site × flight-visibility matrix (asserted on the flight
gate, logbook, profile list, and feed), a leak sweep (no flight carries a
cached name whose site isn't public), and a stale-row defence test — a
hand-written row with a poisoned cached name is still stripped by the read
path, which is the property that actually matters here.

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
