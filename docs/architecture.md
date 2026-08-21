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

## Site + zone privacy seam (SPRINT-004, extended two levels deep by SPRINT-005)

Sites are the app's first shared, user-generated content: a public site is
authored by one pilot and lands in **every** pilot's logbook. That mandates a
second, narrower privacy seam alongside the flight one above — the same "no
RLS, enforcement lives in one repo layer" shape, applied to `Site` and, since
SPRINT-005, to `Zone` (a specific launch/landing spot *within* a site, e.g.
"Mission Ridge — North Launch") one level down.

- `Flight.{takeoff,landing}{Site,Zone}{Id,Name}` (eight columns) are a
  **cache**, not the source of truth. `Site`/`Zone` (`ownerId`, `visibility`)
  are authoritative whenever their id is non-null. The cached **site** name
  is the historical fallback when the site id is null (e.g. a deleted site);
  the cached **zone** name has no such fallback — `deleteZone` explicitly
  nulls it, because a deleted spot has nothing to remember, unlike a deleted
  place.
- `resolveLocationFields()` in `lib/flights/repo.ts` re-verifies **every**
  non-null site id AND zone id on a page against the live rows for the
  current viewer — not just rows whose cached name happens to be null —
  before either reaches any caller. **Stripping the parent always strips the
  child**, applied as a single early return rather than a condition repeated
  per surface: a readable zone with an unreadable parent is impossible by
  construction. This is what lets a public flight bound to a private site
  (or a private zone under a public site) render "Unknown site" / the
  bare site name to everyone but the row's owner.
- **Zone visibility is independent of its parent's; effective visibility is
  the conjunction**: `canSeeSite(site, viewer) AND canSeeSite(zone, viewer)`
  (`lib/sites/visibility.ts`'s `canSeeZone`). This is deliberate, not an
  oversight — it's what lets a private spot exist under an otherwise-public
  site ("everyone knows Mission Ridge; my own launch spot is mine"). The
  inverse (a public zone under a private site) is incoherent, since the
  roll-up label renders the parent's name — refused at the point a pilot
  tries to create it, and independently neutralized by the read-time
  conjunction if such a row is ever reached anyway.
- `lib/sites/associate.ts`'s `locationCachePatch` is the **only** thing
  allowed to write those eight columns (an automated audit,
  `lib/sites/write-audit.test.ts`, fails the build if any other file both
  writes `Flight` and assigns a `*SiteName`/`*ZoneName` value — including
  via raw SQL, which the site-visibility-transition writer uses to
  recompute every zone cache under a promoted/demoted site in one
  correlated statement). Ingest re-reads a matched site *and* zone **inside**
  its create transaction and re-verifies both are still visible to the
  owner; a zone that's since been demoted or deleted degrades the cache to
  site-only, never to nothing.
- Site AND zone read scoping (`siteVisibleWhere`/`zoneVisibleWhere`,
  `lib/sites/repo.ts` and `lib/sites/visibility.ts`) is fail-closed: unknown
  visibility ⇒ private; no viewer ⇒ public only; an orphaned private row (a
  null owner) is visible to **nobody**, owner-shaped viewer included.
- Write-time and read-time scoping are deliberately separate. Ingest and the
  "name this site" flow bind within `public ∪ the owner's own private`
  rows, at both levels; display always re-scopes to whoever is actually
  looking.
- Matching is zone-first at a tighter radius (300 m takeoff / 400 m landing,
  vs. the site radius's 600 m / 900 m) with the site pass **always** running
  as a fallback — whether or not the winning site has zones. A bare site (no
  zones at all) matches and displays exactly as SPRINT-004 produces, with
  zero behavioural change; naming a zone only ever adds precision, never
  removes a match a pilot already had.
- A site's own owner may also rename/unpublish/delete a zone a *different*
  pilot contributed under their site (`lib/sites/associate.ts`'s
  `findZoneEditableBy`) — a deliberately scoped exception to the
  no-pilot-moderation stance SPRINT-004 held, justified because it grants no
  capability the site owner didn't already have in aggregate (they can
  already demote/delete the whole site, taking every zone with it); this
  just makes that existing power targetable at one zone. `deleteSite`/
  `unpublishOwnSite` are additionally guarded against orphaning a zone
  another pilot owns, independent of whether a flight currently references
  it — protecting the *contribution*, not just live references.

Proven by `test/sites.integration.test.ts`: an owner/friend/stranger/anonymous
× (site visibility × zone visibility, all four combinations including the
incoherent one) × flight-visibility matrix (asserted on the flight gate,
logbook, profile list, feed, and every other list function), an extended
leak sweep, stale-row defence tests at both levels (including a
mismatched-parent zone id), and transition tests proving a site
demote/re-promote cycle never has to touch a zone's own `visibility` column.

A genuine Postgres limitation surfaced building this: deleting a site whose
flight is bound to both the site directly and a zone under it hits two FK
cascade paths (`Flight.takeoffSiteId` SET NULL, and `Zone`'s CASCADE
indirectly triggering `Flight.takeoffZoneId` SET NULL) converging on the
same row — empirically an FK violation rather than a resolved order.
`deleteSite` works around it by explicitly nulling the zone id/name for
affected flights *before* the site delete, so the native zone cascade has
nothing left to touch.

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
