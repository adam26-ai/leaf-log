# Sprint 001 — Leaf Log Milestone 1 (Logbook Foundation) — Claude Draft

> Independent plan for M1. Opinionated, end-to-end positions on every Open Question.
> North star: a solo dev ships a **beautiful, private-first, multi-user flight logbook**
> with a **clean shared-ingestion seam** for the future Leaf device-push API.

---

## Overview

Milestone 1 stands up the foundation of Leaf Log as a real hosted multi-user platform:
accounts, public pilot profiles, manual IGC upload, server-side parse + derive, named-site
reverse lookup, a polished flight-detail page (track map + barograph + metric tiles), and a
personal logbook list. Flights are **private by default**; sharing is opt-in per flight and
enforced at the data layer.

**Headline decisions (the short version):**

| Concern | Position |
|---|---|
| Stack | **Next.js 15 (App Router) + TypeScript**, React Server Components + Server Actions, Node runtime |
| UI | **Tailwind CSS + shadcn/ui**, design tokens from `DESIGN.md`, Roboto / Roboto Condensed |
| Hosting | **Vercel** (web) |
| DB | **Supabase Postgres + PostGIS** |
| Storage | **Supabase Storage** (S3-compatible) for raw `.igc` + derived track artifacts |
| Auth | **Supabase Auth** (email magic-link + Google OAuth) |
| ORM / access | **Drizzle ORM** + a centralized visibility-scoped repository layer; **RLS** as second enforcement layer |
| IGC parsing | **In-house TS parser** inside a shared `ingest()` core (same core a future device API calls), runs server-side, synchronously on the upload route for M1 |
| Map | **MapLibre GL JS** + MapTiler free-tier vector tiles, custom monochrome style, amber track polyline |
| Barograph | **uPlot** (canvas, fast at 10k points), amber series |
| Site lookup | Seed **ParaglidingEarth** sites into a PostGIS `sites` table; **KNN nearest-neighbor within a radius threshold** |
| Data spine | Raw IGC + simplified track artifact in **object storage**; scalar derived metrics in **Postgres columns**; heavy point arrays stay out of the DB |

**The single most important architectural idea:** there is exactly one ingestion path —
`ingest(rawBytes, source, ownerId)` — and the web upload is just its first caller. The future
Leaf device-push API is its second caller. Everything downstream (parse, derive, locate,
persist, store artifacts) is source-agnostic.

**Explicitly out of scope for M1** (but un-foreclosed): community feed, following,
kudos/comments, site communities, the device-push API itself, 3D replay, deep climb/glide
analytics.

---

## Use Cases

1. **Sign up / sign in.** A pilot creates an account (magic-link or Google), picks a public
   handle and display name, lands on an empty logbook with a friendly "upload your first
   flight" prompt.
2. **Upload a flight.** Drag-drop or file-pick one or more `.igc` files. The server stores
   the raw file, parses it, derives metrics, locates the site, and persists a flight — all
   private by default. The pilot is redirected to the flight page.
3. **View a flight.** A polished detail page: track on a monochrome map (amber line),
   barograph (baro altitude over time), metric tiles (duration, max alt, gain, max climb/sink,
   track + straight-line distance), detected takeoff/landing site names, glider/date header.
4. **Browse my logbook.** A reverse-chronological list of the pilot's flights with site,
   date, duration, max altitude, and a public/private badge. Running totals (hours, flights,
   sites) up top — solo value that stands alone.
5. **Share a flight.** Toggle a flight `private → public` with a low-pressure, encouraging
   control. Visibility change takes effect immediately.
6. **View a public profile (logged out).** A visitor opens `/@handle` and sees only the
   pilot's **public** flights and public stats; private flights are invisible and their URLs
   are not viewable by anyone but the owner.
7. **Robust failure.** A malformed / truncated / non-Leaf / empty / duplicate IGC produces a
   clear, friendly error (or a deduped no-op) — never a crashed request or a half-written
   flight.

---

## Architecture

### Stack rationale (Open Question 1 & 2)

**Next.js 15 + TypeScript on Vercel.** One language across UI, server, and the parser. Server
Components + Server Actions collapse the API tier for a solo dev: data-loading and mutations
live next to the components without a hand-written REST layer, while a few **Route Handlers**
give us explicit HTTP endpoints exactly where we need a stable contract — the upload endpoint,
which is the seam the future device API mirrors. Vercel's preview deploys + zero-config Next
hosting is the fastest path to a deployed, demoable product, and the free tier covers low
early traffic. The React ecosystem (Tailwind, shadcn, MapLibre, uPlot) is where "great UI"
ships fastest.

**Why not Rails/Django/Phoenix/Remix/SvelteKit:** all viable, but a TS-everywhere Next stack
gives the best combination of (a) world-class UI tooling, (b) a single mental model, and (c)
trivial managed hosting — the three things a solo dev burns the most time on. Remix/SvelteKit
are close seconds but have thinner managed-hosting + component-library ecosystems than Next.

**Supabase as the backend platform.** Postgres (relational, the right shape for
pilots/flights/sites) **plus PostGIS** (site lookup) **plus S3-compatible Storage** (durable
raw IGC) **plus Auth** (magic-link + OAuth) **plus Row-Level Security** — one provider, one
free tier, almost no ops. RLS is the decisive factor: the intent demands privacy "enforced at
the data layer, not just the UI," and RLS lets the database itself refuse to return a private
flight to the wrong viewer. Hosting the web app on Vercel and the data plane on Supabase is a
well-trodden, cheap, solo-friendly split.

**Why not Neon + Auth.js + R2 separately:** that à-la-carte stack is fine and slightly less
lock-in, but it's three vendors and three integration surfaces to wire and secure. For M1
velocity, Supabase's batteries-included integration (Auth ↔ RLS ↔ Storage policies) wins. The
ingestion core stays vendor-neutral so a later migration off Supabase is contained.

**Drizzle ORM + a scoped repository, with RLS as belt-and-suspenders.** Drizzle gives typed
schema and SQL-first migrations (great DX, no heavy runtime). All flight reads go through a
`flights` repository whose functions *require* a viewer context and always apply the
visibility predicate — the application can't accidentally leak a private flight. RLS policies
on `flights` enforce the same rule one layer deeper for any path that reaches Postgres. Trusted
server ingestion uses the service role; user-facing public/profile queries are visibility-scoped.

### Data-flow diagram

```
                          ┌──────────────────────── M1 client ────────────────────────┐
                          │  drag-drop / file-picker (.igc)                            │
                          └───────────────────────────┬───────────────────────────────┘
                                                       │ multipart upload
                                                       ▼
   (future)  Leaf device ──push──►  POST /api/ingest  ┌──────────────────────────────────┐
             (device-auth, M2+)     POST /api/upload ─►│  Route Handler (Node runtime)    │
                                                       │  authn + size/type guard         │
                                                       └───────────────┬──────────────────┘
                                                                       │ rawBytes, source, ownerId
                                                                       ▼
   ┌───────────────────────────────  SHARED INGESTION CORE  (ingest()) ───────────────────────────────┐
   │                                                                                                   │
   │   1. store raw ──► Supabase Storage  (igc/{ownerId}/{hash}.igc)   [source of truth, durable]      │
   │   2. parse    ──► parseIgc(bytes)  → { headers, fixes[] }         [tolerant, never throws]        │
   │   3. derive   ──► deriveMetrics(parsed) → { duration, maxAlt, gain, climb, sink, dist, ... }      │
   │   4. locate   ──► findSite(takeoff), findSite(landing)  ── PostGIS KNN ──► sites table            │
   │   5. artifact ──► build track.json (simplified line + baro series) ──► Storage (tracks/{id}.json) │
   │   6. persist  ──► INSERT flight row (scalars + storage keys + site refs + content hash)           │
   │                                                                                                   │
   └───────────────────────────────────────────────┬───────────────────────────────────────────────-─┘
                                                    │ flightId
                                                    ▼
        ┌──────────────────────── Supabase Postgres + PostGIS ────────────────────────┐
        │  profiles · flights (scalars, visibility, storage keys) · sites (geography)  │
        │  RLS: a flight is readable iff owner OR visibility='public'                   │
        └───────────────────────────────┬─────────────────────────────────────────────┘
                                         │
            ┌────────────────────────────┴───────────────────────────────┐
            ▼                                                             ▼
   Flight page (RSC)                                            Public profile /@handle (RSC)
   ├─ metric tiles  ◄── flights row                             ├─ public flights only (RLS-scoped)
   ├─ MapLibre track ◄── tracks/{id}.json (Storage)             └─ public stats
   └─ uPlot barograph ◄── tracks/{id}.json (Storage)
```

### Data model (Open Question 6)

Source of truth split: **raw IGC + heavy point arrays live in object storage**; **scalar
derived metrics live in Postgres** (so logbook/profile lists are one fast indexed query with
no blob reads). The flight page lazy-loads the `track.json` artifact for map + chart.

```
auth.users            (managed by Supabase Auth)
  id (uuid, pk)

profiles                                  -- 1:1 with auth.users; the public pilot identity
  id            uuid pk  -> auth.users.id
  handle        citext unique             -- /@handle ; immutable-ish, slug-safe
  display_name  text
  bio           text null
  avatar_url    text null
  home_site_id  bigint null -> sites.id
  created_at    timestamptz

flights
  id              uuid pk
  owner_id        uuid    -> profiles.id           (indexed)
  visibility      visibility_enum not null default 'private'   -- ('private','public'); 'followers' reserved
  content_hash    text    not null                 -- sha256(raw bytes); UNIQUE(owner_id, content_hash) => dedupe
  raw_igc_key     text    not null                 -- Storage path to original .igc
  track_key       text    null                     -- Storage path to derived track.json artifact
  -- parsed header facts
  flight_date     date    not null                 -- from HFDTE (+ rollover-corrected)
  takeoff_at      timestamptz null
  landing_at      timestamptz null
  glider          text    null
  recorder        text    null                     -- A-record manufacturer/id (e.g. Leaf vs other)
  -- derived scalar metrics
  duration_s          int     null
  max_alt_m           int     null                 -- baro preferred, GPS fallback
  alt_gain_m          int     null                 -- cumulative climb
  max_climb_ms        numeric null
  max_sink_ms         numeric null
  track_dist_m        int     null
  straight_dist_m     int     null
  alt_source          text    null                 -- 'baro' | 'gps' (which flavor metrics used)
  -- located sites
  takeoff_site_id bigint null -> sites.id
  landing_site_id bigint null -> sites.id
  -- bookkeeping
  ingest_source   text    not null default 'web_upload'   -- 'web_upload' | future 'device_push'
  parse_status    text    not null default 'ok'           -- 'ok' | 'partial' | 'failed'
  created_at      timestamptz default now()
  INDEX (owner_id, flight_date desc)                       -- logbook ordering
  UNIQUE (owner_id, content_hash)                          -- duplicate-upload guard

sites
  id           bigint pk
  name         text not null
  type         text null               -- 'takeoff' | 'landing' | 'both'
  country      text null
  geom         geography(Point,4326) not null
  source       text not null           -- 'paraglidingearth'
  external_id  text null
  GIST INDEX (geom)                     -- KNN nearest-neighbor + ST_DWithin

-- derived track.json artifact (NOT a table — stored in object storage):
--   { line: [[lon,lat], ...downsampled],
--     baro: [[t_offset_s, alt_m], ...downsampled],
--     bounds: [w,s,e,n] }
```

**RLS policy (the data-layer privacy guarantee):**

```sql
-- flights: SELECT allowed iff requester owns it OR it is public
USING ( owner_id = auth.uid() OR visibility = 'public' )
-- INSERT/UPDATE/DELETE allowed iff owner_id = auth.uid()
```

The application repository applies the identical predicate; RLS is the floor that catches any
bug above it. The `sites` table is world-readable; `profiles` are world-readable (public
identity by design).

---

## Implementation

Sequenced so a **runnable vertical slice** (upload → parse → flight page) appears at Phase 3.
Site lookup, full polish, and OAuth come after the slice and degrade gracefully if cut.

### Phase 0 — Scaffold, design system, deploy (foundation)

Goal: a deployed, branded "hello Leaf" with tokens wired, so every later screen inherits the
look for free.

Files:
- `package.json`, `next.config.ts`, `tsconfig.json`, `.env.example`
- `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- `tailwind.config.ts` — design tokens (`--ink`, `--ink-soft`, `--paper`, `--amber`, `--leaf-green`, gray scale, 4–6px radius, soft shadow)
- `lib/fonts.ts` — Roboto + Roboto Condensed (next/font), mono stack, `leaf` wordmark face
- `components/ui/accent-bar.tsx` — the signature **amber 3px** under-heading bar
- `components/ui/section-heading.tsx`, `components/ui/card.tsx`, `components/ui/button.tsx` (shadcn-derived, re-skinned)
- `README.md`, `docs/architecture.md`

Tasks:
- [ ] `create-next-app` (TS, App Router, Tailwind); add shadcn/ui
- [ ] Encode `DESIGN.md` tokens in `tailwind.config.ts` + CSS vars; verify amber `#ffb459`, leaf-green `~#6FAE5E`
- [ ] Wire Roboto / Roboto Condensed via next/font; mono stack for data/coords
- [ ] Build `AccentBar` + `SectionHeading` primitives (the recognizable Leaf cue)
- [ ] Deploy to Vercel; confirm branded landing renders
- [ ] Commit `.env.example` documenting all required keys

### Phase 1 — Auth + profiles (accounts)

Goal: real accounts and a public profile shell.

Files:
- `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/middleware.ts`
- `middleware.ts` — session refresh + route protection
- `db/schema.ts` (Drizzle: `profiles`, enums), `db/migrate.ts`, `drizzle.config.ts`
- `db/migrations/0001_init.sql` — `profiles` table + RLS policies
- `app/(auth)/sign-in/page.tsx`, `app/(auth)/sign-in/actions.ts`
- `app/onboarding/page.tsx` (pick handle + display name), `app/onboarding/actions.ts`
- `app/@[handle]/page.tsx` — public profile shell (empty state)
- `lib/repos/profiles.ts`

Tasks:
- [ ] Provision Supabase project; enable PostGIS; capture keys
- [ ] Drizzle schema + first migration for `profiles`; enable RLS on `profiles`
- [ ] Magic-link + Google OAuth via Supabase Auth; session middleware
- [ ] First-login onboarding: claim unique `citext` handle, set display name; trigger to create `profiles` row
- [ ] Public profile route `/@handle` renders identity + empty logbook state
- [ ] Sign-out; protect authed routes

### Phase 2 — Ingestion core: parser + derivation (the heart, testable headless)

Goal: `ingest()` and its parser/deriver fully unit-tested against fixtures — **no UI needed
to prove correctness.** This is where correctness risk lives, so it's isolated and tested
first.

Files:
- `lib/igc/parse.ts` — `parseIgc(bytes) -> { headers, fixes[] }`, tolerant, never throws
- `lib/igc/derive.ts` — `deriveMetrics(parsed) -> DerivedMetrics`
- `lib/igc/detect.ts` — takeoff/landing detection (sustained-movement heuristic)
- `lib/igc/track-artifact.ts` — build simplified `track.json` (Douglas–Peucker line + downsampled baro)
- `lib/igc/types.ts`
- `lib/ingest/ingest.ts` — `ingest(rawBytes, { source, ownerId })` orchestration core (the shared seam)
- `lib/ingest/dedupe.ts` — sha256 content hash
- `scripts/ingest-cli.ts` — run `ingest`/parse on a local file for manual verification
- `test/fixtures/*.igc` — real Leaf flight, non-Leaf, truncated, no-baro, midnight-rollover, zero-movement, huge, empty
- `lib/igc/parse.test.ts`, `lib/igc/derive.test.ts`, `lib/igc/detect.test.ts`

Tasks:
- [ ] Parse A/H/B records; `HFDTE` date; B-record lat/lon (DDMMmmm), baro + GPS alt, A/V validity
- [ ] UTC midnight rollover correction across the fix stream
- [ ] Baro-preferred altitude with graceful GPS fallback when baro missing/zero (`alt_source`)
- [ ] Takeoff/landing detection (first/last sustained movement by speed+alt threshold)
- [ ] Derive: duration, takeoff/landing times, max alt, cumulative gain, max climb, max sink, track dist (haversine sum), straight-line dist
- [ ] Simplify track + downsample baro for the artifact (cap points for fast render)
- [ ] Tolerant parsing: malformed/truncated/foreign/empty → `partial`/`failed` status, never a throw that crashes the caller
- [ ] `ingest()` orchestrates store → parse → derive → (locate stub) → artifact → persist; **source-parameterized**
- [ ] Vitest suite green on all fixtures incl. broken ones; sanity-check duration/max-alt vs a second-source viewer

### Phase 3 — Upload → store → ingest → flight page (VERTICAL SLICE ✅)

Goal: end-to-end demoable. Logged-in pilot drops an IGC and lands on a beautiful flight page.
(Site shows "Unknown site" until Phase 5 — graceful degradation.)

Files:
- `app/api/upload/route.ts` — authed multipart endpoint; calls `ingest()` (mirrors future `/api/ingest`)
- `lib/storage/igc-store.ts`, `lib/storage/track-store.ts` — Supabase Storage put/get
- `db/migrations/0002_flights.sql` — `flights` table + indexes + RLS
- `db/schema.ts` (extend with `flights`), `lib/repos/flights.ts` (visibility-scoped accessors)
- `app/upload/page.tsx`, `components/upload/dropzone.tsx`
- `app/flights/[id]/page.tsx` — flight detail (RSC)
- `components/flight/metric-tiles.tsx`
- `components/flight/track-map.tsx` (MapLibre, client) + `components/flight/map-style.ts` (monochrome)
- `components/flight/barograph.tsx` (uPlot, client)
- `components/flight/flight-header.tsx`

Tasks:
- [ ] Upload endpoint: authn, size cap, MIME/extension guard, multi-file; stream to `ingest()`
- [ ] Persist flight row (scalars + storage keys + content hash); enforce `UNIQUE(owner_id, content_hash)` → friendly dedupe
- [ ] `flights` RLS + repository with mandatory viewer scoping
- [ ] Dropzone UI (drag-drop + picker), progress + per-file result, brand-styled
- [ ] Flight page: metric tiles (Roboto Condensed numbers, mono units), header (date/glider/recorder)
- [ ] MapLibre map, monochrome style, **amber** track polyline, fit-to-bounds, takeoff/landing markers
- [ ] uPlot barograph from `track.json`, amber series, time axis, crosshair
- [ ] Loading/empty/error states on the flight page

### Phase 4 — Logbook + visibility toggle + privacy enforcement (multi-user truth)

Goal: the platform's privacy contract is real and tested.

Files:
- `app/logbook/page.tsx` + `components/logbook/flight-row.tsx` + `components/logbook/stats-bar.tsx`
- `app/flights/[id]/visibility-action.ts` + `components/flight/share-toggle.tsx`
- `app/@[handle]/page.tsx` (fill in: public flights + public stats)
- `lib/repos/flights.ts` (add `listForOwner`, `listPublicForProfile`, `getForViewer`)
- `test/privacy.test.ts`, `test/e2e/happy-path.spec.ts` (Playwright)

Tasks:
- [ ] Logbook list: reverse-chron, site/date/duration/max-alt, public/private badge
- [ ] Stats bar: total hours, flight count, distinct sites (solo value that stands alone)
- [ ] Share toggle (`private ↔ public`) with encouraging copy; immediate effect
- [ ] Public profile shows **only** public flights + public stats
- [ ] **Explicit privacy test:** owner sees private flight; anon/other user gets 404 on its URL and it's absent from `/@handle`; verify RLS *and* repository both block
- [ ] Playwright happy path: signup → upload → view → toggle public → logged-out view

### Phase 5 — Site reverse-lookup (named sites)

Goal: takeoff/landing resolve to real site names. Slots behind the slice; degrades to
"Unknown site" if cut.

Files:
- `db/migrations/0003_sites.sql` — `sites` + GIST index
- `scripts/seed-sites.ts` — import ParaglidingEarth export → `sites`
- `lib/sites/lookup.ts` — `findSite(lat, lon)` PostGIS KNN within threshold
- `lib/ingest/ingest.ts` (wire `findSite` into the locate step)
- `lib/sites/lookup.test.ts`

Tasks:
- [ ] Acquire ParaglidingEarth dataset (API/export); document license + refresh path
- [ ] Seed `sites` with `geography(Point)` + GIST index
- [ ] `findSite`: KNN `<->` nearest within radius (takeoff ~400 m, landing ~700 m); else null → "Unknown site (lat, lon)"
- [ ] Backfill site refs for flights ingested before this phase
- [ ] Wire into `ingest()` locate step; show names on flight page + logbook
- [ ] Tests for hit, near-miss (just outside radius), no-data region

### Phase 6 — Brand polish + edge hardening + DoD close-out

Files:
- `app/page.tsx` (marketing/landing pass), `components/**` polish
- `components/ui/empty-state.tsx`, `components/ui/toast.tsx`, error boundaries
- `test/e2e/*.spec.ts` (edge cases)
- `docs/architecture.md` (final), `README.md` (run/deploy/seed)

Tasks:
- [ ] Brand audit vs `DESIGN.md`: amber accent bars, Roboto Condensed headers, soft 4–6px radius, subtle shadows, mono for data, leaf-green for PBs/success — no over-coloring
- [ ] Friendly errors for every IGC failure mode; duplicate-upload UX
- [ ] Responsive flight page (map + barograph on mobile)
- [ ] Accessibility pass (labels, contrast, keyboard)
- [ ] DoD checklist green; deploy; smoke-test on production

---

## Files Summary

| Path | Purpose | Phase |
|---|---|---|
| `tailwind.config.ts`, `app/globals.css` | Design tokens from `DESIGN.md` | 0 |
| `components/ui/accent-bar.tsx`, `section-heading.tsx` | Signature amber-bar brand primitives | 0 |
| `lib/fonts.ts` | Roboto / Roboto Condensed / mono / `leaf` wordmark | 0 |
| `lib/supabase/*`, `middleware.ts` | Auth, session, route protection | 1 |
| `db/schema.ts`, `drizzle.config.ts`, `db/migrations/*` | Schema + migrations + RLS | 1,3,5 |
| `app/(auth)/*`, `app/onboarding/*` | Sign-in + handle claim | 1 |
| `app/@[handle]/page.tsx` | Public pilot profile | 1,4 |
| `lib/igc/parse.ts` | Tolerant IGC parser | 2 |
| `lib/igc/derive.ts`, `detect.ts` | Metric derivation + takeoff/landing detection | 2 |
| `lib/igc/track-artifact.ts` | Simplified track.json builder | 2 |
| `lib/ingest/ingest.ts` | **Shared ingestion core (the device-API seam)** | 2 |
| `lib/ingest/dedupe.ts` | Content-hash duplicate guard | 2 |
| `scripts/ingest-cli.ts` | Headless verification harness | 2 |
| `test/fixtures/*.igc`, `lib/igc/*.test.ts` | Parser/deriver test suite | 2 |
| `app/api/upload/route.ts` | Authed upload endpoint (mirrors future `/api/ingest`) | 3 |
| `lib/storage/*` | Raw IGC + track artifact storage | 3 |
| `lib/repos/flights.ts` | Visibility-scoped flight access | 3,4 |
| `app/upload/page.tsx`, `components/upload/dropzone.tsx` | Upload UI | 3 |
| `app/flights/[id]/page.tsx` | Flight detail page | 3 |
| `components/flight/track-map.tsx`, `map-style.ts` | MapLibre monochrome map + amber track | 3 |
| `components/flight/barograph.tsx` | uPlot barograph | 3 |
| `components/flight/metric-tiles.tsx`, `flight-header.tsx` | Metric tiles + header | 3 |
| `app/logbook/page.tsx`, `components/logbook/*` | Logbook list + stats | 4 |
| `components/flight/share-toggle.tsx`, `visibility-action.ts` | Opt-in sharing | 4 |
| `test/privacy.test.ts`, `test/e2e/happy-path.spec.ts` | Privacy + E2E proof | 4 |
| `scripts/seed-sites.ts`, `lib/sites/lookup.ts` | Site dataset + KNN lookup | 5 |
| `components/ui/empty-state.tsx`, `toast.tsx` | Polish primitives | 6 |
| `README.md`, `docs/architecture.md` | Run/deploy/seed + architecture | 0,6 |

---

## Definition of Done

- [ ] A new pilot can sign up (magic-link or Google) and claim a public `@handle`.
- [ ] Drag-drop / file-pick upload stores the raw `.igc`, parses + derives server-side, and
      redirects to a flight page — synchronously, robustly.
- [ ] Flight page shows: monochrome map with **amber** track, uPlot barograph, and all M1
      metric tiles (duration, takeoff/landing times, max alt, gain, max climb, max sink,
      track dist, straight-line dist) plus glider/date/recorder header.
- [ ] Detected takeoff/landing **site names** appear when within threshold; else a clean
      "Unknown site" with coordinates.
- [ ] Personal logbook lists all the pilot's flights (reverse-chron) with a stats bar
      (hours, flights, sites) and per-flight public/private badge.
- [ ] Flights are **private by default**; a per-flight toggle makes one public; the change is
      immediate.
- [ ] A logged-out visitor at `/@handle` sees only public flights/stats; private flight URLs
      return 404 to everyone but the owner — **enforced by RLS and verified by an explicit
      test**.
- [ ] Parser survives every fixture (malformed, truncated, non-Leaf, no-baro, midnight
      rollover, zero-movement, huge, empty, duplicate) without crashing the request.
- [ ] Unit tests (parser/deriver) + a Playwright happy-path + the privacy test all pass in CI.
- [ ] The UI is recognizably **Leaf brand** per `DESIGN.md` (amber accent bars, Roboto
      Condensed headers, monochrome base, soft corners, leaf-green for success states).
- [ ] `ingest()` is source-parameterized; the web upload route is a thin caller — a future
      device endpoint can call the same core with `source='device_push'`.
- [ ] Deployed to Vercel + Supabase; README documents run, deploy, and seed.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| IGC edge cases produce wrong/crashing metrics | High | High | Parser isolated in Phase 2 with a broad fixture suite (incl. broken files); tolerant-never-throw contract; second-source sanity check on duration/max-alt |
| Privacy leak (private flight exposed) | Med | Critical | Two-layer enforcement (RLS + scoped repository); explicit privacy test in DoD; default `private` at the DB |
| Serverless function time/size limits during parse | Med | Med | M1 parse is ms for ~10k points; cap upload size; **the `ingest()` seam already lets us move parse to a background job/queue without touching callers** |
| Site lookup quality (sparse/missing data) | Med | Low | Threshold KNN; graceful "Unknown site" fallback; site lookup is post-slice and cuttable |
| Map tile vendor cost/limits (MapTiler free tier) | Low | Low | Custom style on free tier for M1; documented migration to self-hosted Protomaps/PMTiles if volume grows |
| Drizzle (service role) bypassing RLS by accident | Med | High | All user-facing flight access flows through the scoped repository; service role only inside trusted `ingest()`; RLS as the floor |
| Supabase lock-in | Low | Med | Ingestion core is vendor-neutral; storage/DB access behind thin adapters (`lib/storage/*`, `lib/repos/*`) |
| Scope creep on "beautiful page" / analytics | Med | Med | M1 cut line = map + barograph + scalar tiles only; deeper climb/glide analysis deferred |
| Duplicate uploads | Med | Low | `content_hash` + `UNIQUE(owner_id, content_hash)` → friendly no-op |

---

## Security Considerations

- **Privacy at the data layer.** RLS on `flights` (`owner_id = auth.uid() OR visibility = 'public'`)
  is the enforcement floor; the application repository applies the same predicate. Default
  visibility is `private` in the schema, not the app.
- **Upload abuse.** Authenticated-only uploads; strict size cap and extension/MIME guard;
  reject non-text/oversized payloads before parsing; the parser is sandboxed to pure
  computation (no eval, no shell, bounded loops).
- **Storage scoping.** Raw IGC stored under `igc/{ownerId}/{hash}.igc`; Storage policies bind
  object access to the owner; track artifacts served via signed/short-lived URLs (or owner/public-scoped).
- **Service-role isolation.** The Supabase service-role key lives only in server runtime env
  (never shipped to client); used solely inside trusted ingestion. The browser uses the anon
  key under RLS.
- **Auth.** Supabase Auth handles sessions/tokens; middleware refreshes + protects routes; no
  hand-rolled password storage in M1 (magic-link + OAuth).
- **PII minimization.** IGC headers contain pilot/glider strings; treat the raw file as
  owner-private; never expose raw IGC on public routes (M1 surfaces only derived data + map/baro).
- **Device-push forward-compat.** The `/api/ingest` seam is reserved for a future
  device-auth model (per-device token / signed claim) — *designed for, not built in M1.*
- **Secrets.** All keys via env (`.env.example` documents names only); Vercel/Supabase
  project secrets; no secrets in the repo.

---

## Dependencies

**Runtime / framework**
- `next` (15, App Router), `react`, `react-dom`, `typescript`
- `tailwindcss`, `@radix-ui/*` via `shadcn/ui`, `clsx`/`tailwind-merge`
- `@supabase/supabase-js`, `@supabase/ssr` (Auth + Storage + RLS client)
- `drizzle-orm`, `drizzle-kit`, `postgres` (pg driver)
- `maplibre-gl` (map), `uplot` (barograph)
- `zod` (input validation on upload + actions)

**Tooling / test**
- `vitest` (+ `@vitest/coverage`) for parser/deriver/units
- `@playwright/test` for the E2E happy path + privacy
- `tsx` (run `scripts/*`)

**External services / data**
- **Supabase** project (Postgres + PostGIS + Auth + Storage) — free tier
- **Vercel** project (web hosting + preview deploys) — free tier
- **MapTiler** account (free-tier vector tiles + custom monochrome style key)
- **ParaglidingEarth** dataset (sites seed; verify license + attribution)
- **Google OAuth** credentials (optional secondary sign-in)
- Fonts: Roboto + Roboto Condensed (Google Fonts via next/font); `leaf` wordmark `font.ttf`
  (obtain from Leaf brand assets) — wordmark/lockup only

---

## Open Questions (resolved + remaining)

**Resolved by this draft** (positions taken above): stack (Next.js/TS + Supabase + Vercel),
hosting/DB/storage/auth, IGC parsing (in-house, shared `ingest()` core, synchronous on request
for M1), map (MapLibre + MapTiler monochrome), barograph (uPlot), site lookup (ParaglidingEarth
seed + PostGIS KNN threshold), data model (scalars in Postgres, raw + track artifact in
storage), and phasing (vertical slice at Phase 3).

**Remaining / to confirm during the sprint:**

1. **`leaf` wordmark licensing** — confirm the custom display font can ship in the web app
   (brand-asset permission); fallback to Roboto Condensed lockup if not.
2. **ParaglidingEarth license + freshness** — confirm redistribution terms, attribution, and a
   refresh cadence; pin the radius thresholds against a few real Leaf flights.
3. **`--leaf-green` exact value** — `DESIGN.md` marks `~#6FAE5E` provisional; pin against the
   device LCD green / official logo before locking success-state styling.
4. **Background-job trigger point** — M1 parses on the request path; decide the traffic/size
   threshold at which `ingest()` moves to a queue (the seam exists; the trigger is a judgment call).
5. **Multi-file upload semantics** — confirm per-file success/error UX vs. all-or-nothing for a
   batch drop (draft assumes per-file results).
6. **Email deliverability for magic-link** — Supabase default SMTP vs. a custom sender
   (Resend/Postmark) for reliable onboarding; decide if free-tier sending is adequate for M1.
7. **Device-auth model** — explicitly deferred to M2+, but the `/api/ingest` contract shape
   should be sketched before locking the upload endpoint so the two stay symmetric.
