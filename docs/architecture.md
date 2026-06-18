# Leaf Log — Architecture (Milestone 1)

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
   1. sha256 + dedupe (owner_id, hash)           │
   2. store raw IGC  ──────────────► Storage: igc/{owner}/{hash}.igc   (private)
   3. parseIgc(bytes)        (tolerant; never throws)
   4. deriveMetrics()        (smoothed climb/sink, gain threshold, baro→gps, tz)
   4b. findSite(takeoff/landing)  ── PostGIS KNN ──► sites
   5. buildTrackArtifact() ─────────► Storage: tracks/{flightId}.json  (private)
   6. INSERT flight (+ flight_assets), status ready|failed
   on failure → delete row + remove uploaded objects (no orphans)
```

## Privacy model (data-layer)

- Flights default to `private` **in the schema**, not the app.
- **RLS is the authoritative floor**: a flight is readable iff
  `owner_id = auth.uid() OR visibility = 'public'`; writes require ownership.
- User-facing reads/writes go through the **RLS-respecting Supabase client**
  (forwards the user JWT). The **service-role client is confined to the ingest
  core and the authorizing artifact route** — never used to render user data
  without its own check.
- Storage buckets are private. Raw IGC is **never** served publicly. The derived
  track is served by `GET /api/flights/[id]/track`, which first confirms the
  viewer may read the flight (RLS) and only then reads the private object via the
  service role — so a private→public→private toggle can't leak a stale link.
- Public profile aggregate stats are computed from **public flights only**.

Proven by: SQL role tests, `test/privacy.integration.test.ts` (real client
paths), and the Playwright happy-path.

## Data model

`profiles` (1:1 auth.users) · `flights` (scalars + visibility + status + site
refs) · `flight_assets` (storage metadata) · `sites` (PostGIS geography + GiST).
Heavy point arrays live in the `track.json` artifact in object storage, not in
Postgres — so logbook/profile lists are a single fast indexed query.

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
- Fuzzy near-duplicate detection; background-job ingestion.
