# Sprint 001 — Leaf Log Milestone 1: Logbook Foundation

> Synthesized from three independent drafts (Claude/Codex/Gemini) + cross-critiques +
> interview. See `drafts/SPRINT-001-MERGE-NOTES.md` for how decisions were reached.

## Overview

Milestone 1 stands up Leaf Log as a real, hosted, **private-first multi-user** flight
logbook — the official companion to the Leaf vario. A pilot can sign up, upload an `.igc`
file, have it parsed and analyzed server-side, land on a polished flight-detail page (track
map + barograph + metric tiles + named site), see it in a personal logbook, and opt into
sharing it on a public profile. Flights are **private by default**, enforced at the database
layer.

The guiding architectural idea is a **single, source-agnostic ingestion core**,
`ingestFlight({ source, ownerId, bytes })`. The M1 web upload is its first caller; the
future Leaf device-push API will be its second. Parsing, derivation, site lookup, artifact
building, and persistence never know whether bytes came from a browser or a device.

Per the interview, M1 is scoped as a **tight vertical slice**: the core
upload→parse→beautiful-page→logbook→privacy loop is the sprint; **named-site lookup and deep
polish are the trailing, cuttable phase**.

**Headline decisions**

| Concern | Decision |
|---|---|
| Framework | **Next.js (App Router) + TypeScript**, Node runtime for ingestion |
| UI | **Tailwind + design tokens + shadcn/ui** (re-skinned to `DESIGN.md`); Roboto / Roboto Condensed |
| Hosting | **Vercel** (web) + **Supabase** (data plane) |
| DB | **Supabase Postgres + PostGIS** |
| Storage | **Supabase Storage** (private buckets) for raw `.igc` + derived `track.json` |
| Auth | **Supabase Auth — email magic-link only** for M1 (OAuth deferred) |
| Data access | **Supabase client (RLS-respecting)** for user paths; **service-role only inside the ingest core**. No ORM with a privileged connection (avoids RLS bypass). |
| IGC parsing | **In-house tolerant TS parser**, server-side, synchronous, behind `ingestFlight()` |
| Map | **MapLibre GL JS** + MapTiler vector tiles, monochrome style, amber track |
| Barograph | **Recharts** on downsampled series (≤~2000 pts), amber/leaf-green |
| Site lookup | **PostGIS `geography` + GiST KNN**; ParaglidingEarth seed (best-effort) + manual Plan B; `source_url`/`license` stored |
| Track data | Versioned **`track.json` artifact in private storage**; scalar metrics in Postgres |

**Out of scope for M1** (un-foreclosed): community feed, following, kudos/comments, the
device-push API itself, OAuth providers, 3D replay, deep climb/glide analytics,
launch-coordinate privacy zones (deferred + documented), fuzzy near-duplicate detection,
background-job ingestion.

## Use Cases

1. **Sign up / sign in.** Pilot signs in via email magic-link, claims a public `@handle` +
   display name, lands on an empty logbook with a friendly "upload your first flight" prompt.
2. **Upload a flight.** Drag-drop / file-pick one or more `.igc` files. Server stores the raw
   file, parses, derives metrics, builds a track artifact, (locates site), persists a
   **private** flight, redirects to the flight page.
3. **View a flight.** Polished page: monochrome map with amber track, barograph (local time
   axis), metric tiles (airtime, max alt, height gained, best climb, strongest sink, track &
   straight-line distance), takeoff/landing site names, glider/date header, owner-only parse
   warnings.
4. **Browse my logbook.** Reverse-chronological list with site/date/duration/max-alt and a
   public/private badge, plus a stats bar (hours, flights, distinct sites) — solo value that
   stands alone.
5. **Share a flight.** Low-pressure toggle `private → public`; effect is immediate.
6. **View a public profile (logged out).** Visitor at `/@handle` sees only **public** flights
   and **public-derived** stats; private flights are invisible and their URLs 404 for everyone
   but the owner.
7. **Robust failure.** Malformed / truncated / non-Leaf / empty / duplicate IGC yields a clear
   friendly outcome (warning, `failed` state, or deduped no-op) — never a crashed request or a
   half-written flight.

## Architecture

### Data-flow

```
            ┌──────────── M1 client: drag-drop / file-picker (.igc) ────────────┐
            └───────────────────────────────┬───────────────────────────────────┘
                                             │ multipart
  (future) Leaf device ──push──► POST /api/ingest   POST /api/upload
           (device-auth, M2+)                  │  authn + size/MIME guard (≤5 MB)
                                               ▼
 ┌──────────────────── SHARED INGESTION CORE  ingestFlight({source, ownerId, bytes}) ────────────────────┐
 │  1. hash      sha256(bytes); UNIQUE(owner_id, sha256) ⇒ friendly dedupe no-op                          │
 │  2. store raw → Supabase Storage  igc/{ownerId}/{hash}.igc        [durable source of truth]            │
 │  3. parse     → parseIgc(bytes) → {headers, fixes[]}             [tolerant; never throws]              │
 │  4. derive    → deriveMetrics(parsed)  [smoothed climb/sink, gain threshold, baro-preferred]           │
 │  5. locate    → findSite(takeoff), findSite(landing)  ── PostGIS KNN ──► sites   (trailing phase)      │
 │  6. tz        → timezoneFromCoords(takeoff) → local-time fields                                        │
 │  7. artifact  → build track.json (simplified line + downsampled baro + meta) → Storage tracks/{id}.json│
 │  8. persist   → INSERT flight (scalars + storage keys + site refs + status='ready')                   │
 │     on failure after step 2 → mark status='failed' + cleanup orphaned objects (idempotent by hash)    │
 └───────────────────────────────────────────────┬───────────────────────────────────────────────────-──┘
                                                  ▼
      ┌──────────── Supabase Postgres + PostGIS ────────────┐
      │ profiles · flights · flight_assets · sites          │
      │ RLS: flight readable iff owner OR visibility='public'│
      └───────────────────────┬─────────────────────────────┘
            ┌─────────────────┴───────────────────┐
            ▼                                      ▼
   Flight page (RSC)                       Public profile /@handle (RSC)
   ├─ metric tiles ◄─ flights row          ├─ public flights only (RLS-scoped)
   ├─ MapLibre track ◄─ tracks/{id}.json   └─ public-only aggregate stats
   └─ Recharts barograph ◄ (authorized route serving private artifacts)
```

### Privacy enforcement (the platform invariant)

- **Default `private` in the schema**, not the app.
- **RLS is the authoritative floor**: `SELECT` on `flights` allowed iff
  `owner_id = auth.uid() OR visibility = 'public'`; writes iff `owner_id = auth.uid()`.
- **User-facing data access uses the RLS-respecting Supabase client** (forwards the user
  JWT). The **service-role key is used ONLY inside `ingestFlight()`** (trusted server path).
  No ORM on a privileged connection for user paths — this is the explicit fix for the
  RLS-bypass risk.
- **Storage buckets are private.** Raw IGC is **never** public (even for public flights).
  Derived `track.json` is served through an **authorizing route** (owner OR public) using
  **short-lived** signed URLs, so a private→public→private toggle can't leave a live link.
- **Public aggregate stats** are computed from **public flights only** for non-owners.
- **Output-escape** all IGC header strings (pilot/glider/logger are attacker-controlled).

### Data model

```
profiles                              -- 1:1 with auth.users; public pilot identity
  id uuid pk → auth.users.id
  handle citext unique                -- /@handle
  display_name text · bio text? · avatar_url text?
  home_site_id uuid? → sites.id
  created_at / updated_at timestamptz

flights
  id uuid pk
  owner_id uuid → profiles.id                                   (index: owner_id, flight_date desc)
  visibility text not null default 'private'  check in (private, public)   -- 'followers' reserved
  source text not null check in (web_upload, device_push)       default 'web_upload'
  status text not null check in (uploaded, processing, ready, failed)
  igc_sha256 text not null                                      UNIQUE(owner_id, igc_sha256)  -- dedupe
  parser_version text not null
  parse_warnings jsonb not null default '[]'
  failure_reason text?
  flight_date date · takeoff_at timestamptz? · landing_at timestamptz?
  local_tz text? · local_utc_offset_minutes int?               -- for local-time display
  glider text? · recorder text?                                 -- A-record (Leaf vs other)
  duration_s int? · max_alt_m int? · alt_gain_m int?
  max_climb_ms numeric? · max_sink_ms numeric? · alt_source text?   -- 'baro' | 'gps'
  track_dist_m int? · straight_dist_m int?
  takeoff_lat/lon double? · landing_lat/lon double? · bounds jsonb?
  takeoff_site_id uuid? → sites.id · takeoff_site_name text?    -- denormalized for history
  landing_site_id uuid? → sites.id · landing_site_name text?
  created_at / updated_at timestamptz

flight_assets                          -- explicit storage metadata (room for future exports/thumbnails)
  id uuid pk · flight_id uuid → flights.id
  kind text check in (raw_igc, derived_track)
  bucket text · object_key text · content_type text · byte_size int
  created_at timestamptz

sites
  id uuid pk · name text · kind text check in (takeoff, landing, both, unknown)
  geom geography(Point,4326) not null            -- GIST index for KNN
  country_code text? · region text?
  source text · source_id text? · source_url text? · license text?   -- attribution/compliance
  created_at / updated_at timestamptz

-- track.json artifact (private storage, NOT a table):
--   { v:1, alt_source:'baro'|'gps', units:{alt:'m',t:'s'},
--     line:[[lon,lat],…downsampled], baro:[[t_off_s, alt_m],…downsampled],
--     bounds:[w,s,e,n], downsample:{method:'rdp', max_points:2000} }
```

### IGC parsing & derivation (the highest-risk component)

- Parse **A / H / B** records; tolerant of unknown record types; **never throws** — invalid
  input becomes warnings or `status='failed'`, never a crashed request.
- **Date** from `HFDTE` (+ two-digit-year handling); **UTC midnight rollover** corrected
  across the fix stream.
- **Fix validity:** respect the `A/V` 3D/2D flag; drop out-of-range coords / `0000000N` /
  bad hemisphere markers; ignore pre-launch & post-landing ground movement (walking,
  cable-car, retrieve) in takeoff/landing detection (sustained-movement heuristic with
  fallback to first/last valid fix).
- **Altitude:** baro-preferred (ISA-referenced pressure alt), graceful **GPS fallback** when
  baro missing/zero/stuck; record which in `alt_source`.
- **Metric smoothing (the key correctness fix):** compute **max climb/sink over a ~3 s
  smoothing window**, not raw 1 s deltas; apply a **noise threshold to cumulative altitude
  gain** so jitter doesn't inflate "height gained." Derive duration, takeoff/landing times,
  max alt, gain, max climb, max sink, track distance (haversine sum), straight-line distance.
- **Local time:** derive IANA timezone from takeoff coordinates (offline coord→tz lookup);
  store tz + offset; display flight times in local time.
- **Artifact:** simplify the line (Ramer–Douglas–Peucker) + downsample baro to ≤~2000 points
  for fast render; versioned with units + altSource + method metadata.

## Implementation

Ordered so a **runnable vertical slice** appears at Phase 3; the parser (highest risk) is
isolated and fully tested at Phase 2 before any UI depends on it. **Phase 5 (named-site) is
the trailing, cuttable phase** — until it lands, sites show "Unknown site (lat, lon)".

### Phase 0 — Scaffold, design system, deploy
**Goal:** a deployed, branded "hello Leaf" so every later screen inherits the look.
**Files:** `package.json`, `next.config.ts`, `tsconfig.json`, `.env.example`,
`tailwind.config.ts` (DESIGN.md tokens), `app/layout.tsx`, `app/globals.css`, `lib/fonts.ts`,
`components/ui/accent-bar.tsx`, `components/ui/section-heading.tsx`, shadcn primitives, `README.md`.
**Tasks:**
- [ ] `create-next-app` (TS, App Router, Tailwind) + shadcn/ui.
- [ ] Encode tokens: `--ink #000`, `--ink-soft #272727`, `--paper #fff`, `--amber #ffb459`,
      `--leaf-green ~#6FAE5E`, gray scale, 4–6px radius, subtle shadow.
- [ ] Roboto + Roboto Condensed via `next/font`; mono stack for data/coords; `leaf` wordmark (logo only).
- [ ] Build signature **amber 3px accent-bar** + section-heading primitives.
- [ ] Deploy to Vercel; confirm branded landing renders.

### Phase 1 — Auth (magic-link) + profiles + schema + RLS
**Goal:** real accounts, a public profile shell, and the privacy invariant present from the start.
**Files:** `lib/supabase/{server,client,middleware}.ts`, `middleware.ts`,
`supabase/migrations/001_init.sql` (profiles + flights + flight_assets + sites + RLS),
`app/(auth)/sign-in/*`, `app/onboarding/*`, `app/@[handle]/page.tsx`, `lib/db/*` (typed accessors).
**Tasks:**
- [ ] Provision Supabase; enable PostGIS; capture keys.
- [ ] Migration: all tables, indexes, constraints, **default `visibility='private'`**, RLS on
      `profiles`/`flights`/`flight_assets` (+ public profile read policy).
- [ ] Magic-link sign-in; session middleware + route protection.
- [ ] Onboarding: claim unique `citext` handle + display name (reserved-name check); trigger to create `profiles` row.
- [ ] Public `/@handle` shell (identity + empty state); sign-out.
- [ ] Test: private flight invisible through profile queries (schema-level).

### Phase 2 — Ingestion core: parser + derivation (headless, fully tested)
**Goal:** prove correctness with **no UI**. This is where risk lives — isolate and test first.
**Files:** `lib/igc/{parse,derive,detect,track-artifact,types}.ts`, `lib/geo/{distance,timezone}.ts`,
`lib/ingest/{ingest-flight,dedupe,cleanup}.ts`, `scripts/ingest-cli.ts`,
`test/fixtures/igc/*.igc`, `lib/igc/*.test.ts`.
**Tasks:**
- [ ] Parse A/H/B, `HFDTE` (+ rollover, two-digit year), B-record lat/lon/baro/GPS/validity.
- [ ] Fix-validity filtering; drop bad coords/hemisphere; baro-preferred + GPS fallback (`alt_source`).
- [ ] Takeoff/landing detection (sustained movement; ignore ground movement; fallback to first/last valid).
- [ ] **Smoothed** max climb/sink (~3 s window) + cumulative-gain **noise threshold**; duration, times, max alt, distances.
- [ ] Local timezone from takeoff coords → tz + offset.
- [ ] Build simplified+downsampled `track.json` (versioned).
- [ ] `ingestFlight()` orchestration: hash → store → parse → derive → (locate stub) → tz → artifact → persist;
      **source-parameterized**; cleanup-on-failure; `status` lifecycle; idempotent by hash.
- [ ] Vitest green on fixtures: valid Leaf, non-Leaf, malformed, truncated, missing-baro,
      midnight-rollover, zero-movement, ground-movement, huge (~5 MB), empty, duplicate.
- [ ] Sanity-check duration + max-alt against a second-source IGC viewer on ≥2 real files.

### Phase 3 — Upload → ingest → beautiful flight page  (VERTICAL SLICE ✅)
**Goal:** end-to-end demoable. Drop an IGC → land on a polished flight page (site = "Unknown" until Phase 5).
**Files:** `app/api/upload/route.ts` (mirrors future `/api/ingest`), `lib/storage/*`,
`app/upload/page.tsx`, `components/upload/dropzone.tsx`, `app/flights/[id]/page.tsx`,
`components/flight/{metric-tiles,track-map,map-style,barograph,flight-header}.tsx`,
`app/api/flights/[id]/track/route.ts` (authorizing artifact route).
**Tasks:**
- [ ] Authed multipart upload: size cap (5 MB), MIME/extension guard, multi-file; stream to `ingestFlight()`.
- [ ] Persist flight; enforce `UNIQUE(owner_id, igc_sha256)` → friendly dedupe.
- [ ] Authorizing track route (owner OR public) → short-lived signed URL.
- [ ] Dropzone UI (drag-drop + picker), per-file progress/result, brand-styled.
- [ ] Flight page: metric tiles (Roboto Condensed numerals, mono units, beginner-friendly labels),
      header (local date/time, glider, recorder), owner-only parse warnings.
- [ ] MapLibre monochrome style, **amber** track polyline, fit-to-bounds, takeoff/landing markers.
- [ ] Recharts barograph from `track.json` (downsampled), local-time axis, hover crosshair.
- [ ] Loading / empty / error / `failed`-parse states.

### Phase 4 — Logbook + visibility toggle + privacy (multi-user truth)
**Goal:** the privacy contract is real and tested.
**Files:** `app/logbook/page.tsx`, `components/logbook/{flight-row,stats-bar}.tsx`,
`app/flights/[id]/visibility-action.ts`, `components/flight/share-toggle.tsx`,
`app/@[handle]/page.tsx` (fill in), `test/privacy.test.ts`, `test/e2e/happy-path.spec.ts`.
**Tasks:**
- [ ] Logbook: reverse-chron list (site/date/duration/max-alt + public/private badge).
- [ ] Stats bar: total hours, flight count, distinct sites (owner = all flights).
- [ ] Share toggle (`private ↔ public`), encouraging copy, immediate effect.
- [ ] Public profile shows **only** public flights + **public-only** aggregate stats.
- [ ] **Explicit privacy tests:** owner sees private flight; anon AND authenticated-non-owner
      get 404 on its URL and on its track artifact; flight absent from `/@handle`; verify RLS
      *and* the artifact route both block; public→private revokes artifact access.
- [ ] Playwright happy path: sign up → upload → view → toggle public → logged-out view.

### Phase 5 — Named-site lookup (TRAILING / CUTTABLE) + hardening
**Goal:** takeoff/landing resolve to real names; final polish + DoD close-out.
**Files:** `supabase/migrations/002_sites_seed.sql`, `scripts/seed-sites.ts`,
`lib/sites/lookup.ts`, wire into `lib/ingest/ingest-flight.ts`, `lib/sites/lookup.test.ts`,
`components/ui/{empty-state,toast}.tsx`, `docs/architecture.md`.
**Tasks:**
- [ ] Confirm ParaglidingEarth terms; import attributed seed (store `source_url`/`license`);
      manual-seed path for Leaf-owned corrections + key local sites (Plan B if terms disallow).
- [ ] `findSite(lat,lon)`: PostGIS KNN `<->` nearest within radius, **kind-filtered**
      (takeoff ~400 m / landing ~700 m, tuned); else null → "Unknown site (lat, lon)".
- [ ] Store both `site_id` + denormalized `site_name`; backfill flights ingested earlier.
- [ ] Tests: hit, near-miss outside radius, no-data region, takeoff-vs-landing kind, dense-area disambiguation.
- [ ] Brand audit vs `DESIGN.md`; responsive flight page; a11y pass (labels, amber-on-white contrast, keyboard).
- [ ] DoD checklist green; production smoke test.

## Files Summary

| Path | Action | Purpose | Phase |
|---|---|---|---|
| `tailwind.config.ts`, `app/globals.css`, `lib/fonts.ts` | Create | DESIGN.md tokens + fonts | 0 |
| `components/ui/accent-bar.tsx`, `section-heading.tsx` | Create | Signature amber-bar brand primitives | 0 |
| `lib/supabase/*`, `middleware.ts` | Create | RLS-respecting clients, session, route guard | 1 |
| `supabase/migrations/001_init.sql` | Create | Schema + indexes + RLS + default-private | 1 |
| `app/(auth)/*`, `app/onboarding/*` | Create | Magic-link sign-in + handle claim | 1 |
| `app/@[handle]/page.tsx` | Create | Public pilot profile | 1,4 |
| `lib/igc/{parse,derive,detect,track-artifact}.ts` | Create | Tolerant parser + smoothed metrics + artifact | 2 |
| `lib/geo/{distance,timezone}.ts` | Create | Haversine + coord→timezone | 2 |
| `lib/ingest/{ingest-flight,dedupe,cleanup}.ts` | Create | **Shared ingestion core (device-API seam)** | 2 |
| `scripts/ingest-cli.ts`, `test/fixtures/igc/*`, `lib/igc/*.test.ts` | Create | Headless verification + fixtures | 2 |
| `app/api/upload/route.ts` | Create | Authed upload (mirrors future `/api/ingest`) | 3 |
| `lib/storage/*` | Create | Raw IGC + track artifact storage | 3 |
| `app/upload/*`, `components/upload/dropzone.tsx` | Create | Upload UI | 3 |
| `app/flights/[id]/page.tsx`, `components/flight/*` | Create | Flight detail (map, barograph, tiles, header) | 3 |
| `app/api/flights/[id]/track/route.ts` | Create | Authorizing artifact route (signed, short-lived) | 3 |
| `app/logbook/*`, `components/logbook/*` | Create | Logbook list + stats | 4 |
| `components/flight/share-toggle.tsx`, `visibility-action.ts` | Create | Opt-in sharing | 4 |
| `test/privacy.test.ts`, `test/e2e/happy-path.spec.ts` | Create | Privacy + E2E proof | 4 |
| `supabase/migrations/002_sites_seed.sql`, `scripts/seed-sites.ts`, `lib/sites/lookup.ts` | Create | Site data + KNN lookup | 5 |
| `README.md`, `docs/architecture.md`, `.env.example` | Create | Run/deploy/seed + architecture | 0,5 |

## Definition of Done

- [ ] A new pilot signs in via **email magic-link** and claims a public `@handle`.
- [ ] Drag-drop / file-pick upload stores the raw `.igc`, parses + derives server-side via
      `ingestFlight()`, and redirects to a flight page — robustly, never crashing.
- [ ] Flight page shows: monochrome map with **amber** track, Recharts barograph on a
      **local-time** axis, and all M1 metric tiles (airtime, takeoff/landing local times, max
      alt, height gained, **smoothed** best climb / strongest sink, track + straight-line
      distance) plus glider/date/recorder header and owner-only parse warnings.
- [ ] Personal logbook lists the pilot's flights (reverse-chron) with a stats bar (hours,
      flights, distinct sites) and per-flight public/private badge.
- [ ] Flights are **private by default**; a per-flight toggle makes one public immediately.
- [ ] A logged-out visitor at `/@handle` sees only public flights + **public-only** stats;
      private flight URLs **and** their track artifacts return 404 to anon **and**
      authenticated non-owners — enforced by **RLS + the artifact route**, verified by tests.
- [ ] Raw IGC is never publicly accessible (even for public flights).
- [ ] Parser survives every fixture (malformed, truncated, non-Leaf, missing-baro, midnight
      rollover, zero-movement, ground-movement, ~5 MB, empty, duplicate) without crashing.
- [ ] Climb/sink use a smoothing window and gain uses a noise threshold (no raw-delta garbage),
      sanity-checked against a second-source viewer on ≥2 real files.
- [ ] **(Phase 5, cuttable)** Takeoff/landing resolve to **named sites** within threshold for
      ≥3 known test sites; else a clean "Unknown site" with coordinates.
- [ ] Unit tests (parser/deriver) + Playwright happy-path + privacy tests pass in CI.
- [ ] UI is recognizably **Leaf brand** per `DESIGN.md` (amber accent bars, Roboto Condensed
      headers, monochrome base, soft corners, leaf-green success accents).
- [ ] `ingestFlight()` is source-parameterized; the upload route is a thin caller — a future
      device endpoint can call the same core with `source='device_push'`.
- [ ] Deployed to Vercel + Supabase; README documents run, deploy, and seed.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Wrong metrics from raw GPS noise (climb/sink/gain) | High | High | Smoothing window + gain noise threshold; fixture tests; second-source sanity check |
| IGC edge cases crash the request | Med | High | Parser isolated + fixture-tested in Phase 2; tolerant-never-throw; `failed` status |
| Privacy leak (private flight or artifact exposed) | Med | Critical | RLS + private buckets + authorizing artifact route + short-lived URLs; default-private; explicit non-owner tests |
| RLS bypassed via privileged DB connection | Med | Critical | No ORM on service-role for user paths; RLS-respecting Supabase client; service-role confined to ingest core |
| Partial ingestion orphans storage / breaks page | Med | Med | Ordered steps + cleanup-on-failure + `status` lifecycle; idempotent by content hash |
| Local-time confusion (UTC shown to pilot) | Med | Med | coord→timezone lookup; store tz+offset; display local |
| Serverless timeout during parse | Low | Med | ~5 MB cap; parse is ms for ~10k pts; `ingest()` seam lets us move to a worker without touching callers |
| Site-data licensing (ParaglidingEarth) unclear | Med | Med | Best-effort + manual-seed Plan B; `source_url`/`license` columns; Phase 5 is cuttable; "Unknown site" fallback |
| Site mislabeling (dense areas, takeoff vs landing) | Med | Low | kind-filtered KNN; tuned radii; denormalized names; honest "Unknown" |
| Map tile vendor cost/limits | Low | Low | MapLibre (no renderer lock) + free-tier tiles, domain-restricted token; PMTiles migration path |
| Scope overrun for solo dev | Med | Med | Tight vertical slice; named-site + polish are the trailing cuttable phase; concrete cut order |
| Duplicate uploads | Med | Low | sha-256 + `UNIQUE(owner_id, igc_sha256)` → friendly no-op (exact-bytes only; fuzzy dedup deferred) |

## Security Considerations

- **Data-layer privacy:** default-`private` schema; RLS on `flights`/`profiles`/`flight_assets`;
  service-role key server-only and confined to `ingestFlight()`; browser uses anon key under RLS.
- **Artifact access:** private buckets; raw IGC never public; derived `track.json` served via an
  authorizing route with short-lived signed URLs; public→private revokes access.
- **Upload abuse:** authed-only; ≤5 MB; extension + text-like content guard; reject
  empty/binary; rate-limit by user/IP; parser is pure computation (no eval/shell, bounded loops).
- **Untrusted IGC text:** escape all displayed header fields + filenames (stored-XSS vector);
  fail-closed on impossible files.
- **PII minimization:** treat raw IGC as owner-private; public pages expose only derived data;
  no precise home location collected in M1; **launch-coordinate obfuscation deferred + documented**.
- **Third-party tiles:** MapTiler receives viewport coords; domain-restrict the token; accepted for M1.
- **Secrets:** all keys via env; `.env.example` documents names only; no secrets in repo.

## Dependencies

- **Runtime:** `next` (App Router), `react`, `typescript`, `tailwindcss`, `shadcn/ui` (+ Radix),
  `@supabase/supabase-js`, `@supabase/ssr`, `zod`.
- **Flight UI/parse:** `maplibre-gl`, `recharts`, a coord→IANA-timezone lookup
  (e.g. offline `tz-lookup`-style package), an RDP line-simplify util.
- **Tooling/test:** `vitest`, `@playwright/test`, `tsx`, Supabase CLI (migrations/local).
- **Services/data:** Supabase project (Postgres + PostGIS + Auth + Storage, free tier); Vercel
  (free tier); MapTiler (free-tier vector tiles + monochrome style); ParaglidingEarth dataset
  (verify license/attribution); Roboto + Roboto Condensed (Google Fonts via `next/font`);
  `leaf` wordmark `font.ttf` (Leaf brand assets, wordmark only).

## Open Questions (to confirm during the sprint — non-blocking)

1. **`leaf` wordmark licensing** — confirm the custom display font can ship in the web app;
   fallback to a Roboto Condensed lockup if not.
2. **ParaglidingEarth terms + freshness** — confirm redistribution/attribution; pin KNN radii
   against real Leaf flights; finalize the manual-seed Plan B set.
3. **`--leaf-green` exact value** — `DESIGN.md` marks `~#6FAE5E` provisional; pin against the
   device LCD green / official logo before locking success-state styling.
4. **`/api/ingest` device contract shape** — sketch (not build) the future device endpoint so
   the upload route stays symmetric with it; device-auth model deferred to M2+.
5. **Background-job trigger point** — the traffic/size threshold at which `ingestFlight()` moves
   off the request path to a worker (seam exists; trigger is a later judgment call).
6. **Magic-link deliverability** — Supabase default SMTP vs. a custom sender (Resend/Postmark)
   for reliable beginner onboarding.
