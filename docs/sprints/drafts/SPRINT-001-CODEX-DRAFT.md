# Sprint 001 Plan: Leaf Log Milestone 1

## Overview

Milestone 1 should ship Leaf Log as a real hosted, private-first, multi-user logbook: a pilot can create an account, upload an IGC file, have it parsed on the server, see a polished flight detail page, find the flight in their logbook, and opt into public sharing through a pilot profile URL.

The stack choice is deliberately boring for a solo developer: **Next.js App Router + TypeScript + Tailwind CSS on Vercel, backed by Supabase Auth, Supabase Postgres, and Supabase Storage**. This gives fast UI iteration, one language across the app and parser, real hosted auth/database/storage, low early cost, and a clean service boundary for the future Leaf device-push API.

Key M1 positions:

- **Framework:** Next.js App Router, TypeScript, server actions/route handlers, React server components where they simplify data loading.
- **UI:** Tailwind CSS with Leaf design tokens, Radix UI primitives where needed, lucide icons, Roboto and Roboto Condensed, amber `#ffb459` accent bars, small 4-6px radii, subtle shadows, real flight photography only where it serves the product.
- **Hosting:** Vercel for the web app. Supabase for auth, Postgres, row-level security, and private object storage.
- **IGC parsing:** build a small tolerant in-repo TypeScript parser for the M1 IGC subset. Run it server-side in a Node route/action, not edge. Store raw IGC first, then parse and derive synchronously for M1. Keep all ingestion behind a shared `ingestFlight` service so future device upload calls the same core path.
- **Map:** MapLibre GL JS with MapTiler Cloud vector tiles for M1. Track rendered as GeoJSON, with start/landing markers and bounds fit.
- **Barograph:** Recharts for velocity and responsive React integration. Use barometric altitude when valid, GPS altitude as fallback, with amber/green Leaf styling.
- **Site lookup:** seed a `sites` table from ParaglidingEarth GeoJSON/API data where licensing/permission permits, with source attribution fields. Do not use OpenAIP as the primary source for M1 because its CC BY-NC license is risky for a future commercial official companion. Query by indexed lat/lon bounding box plus haversine distance in application code; defer PostGIS until lookup quality or dataset size demands it.
- **Privacy:** every new flight is `private` by default at the database layer. Public pages query only `visibility = 'public'`; private storage assets are served only through server endpoints that enforce ownership or public visibility.

M1 should avoid feed/follow/kudos/comments, device auth, advanced scoring, competition framing, full site community pages, 3D playback, and heavyweight geospatial infrastructure.

## Use Cases

1. A new pilot signs up with email, chooses a username, and lands in an empty personal logbook.
2. A signed-in pilot uploads an `.igc` file by drag-drop or file picker.
3. The upload stores the raw IGC durably, parses server-side, derives metrics, performs takeoff/landing site lookup, and creates a private flight.
4. The pilot lands on a flight detail page with a track map, barograph, metric tiles, takeoff/landing names, and plain-language parse warnings if needed.
5. The pilot returns to a personal logbook list showing their private and public flights.
6. The pilot toggles a flight from private to public.
7. A logged-out visitor can view the pilot profile and public flight URL, but cannot discover or fetch private flights or private derived assets.
8. A malformed, foreign, truncated, duplicate, or low-quality IGC file never crashes the request; it either produces a flight with warnings or a clear failed-upload state.

## Architecture

```text
          Browser
             |
             | sign up / upload IGC / view flight
             v
     Next.js App on Vercel
             |
             | Supabase Auth session
             v
  Route handlers + server actions
             |
             v
      ingestFlight(input)
       /      |       \
      /       |        \
 raw IGC   parse IGC   duplicate hash
 storage      |        check
              v
        deriveMetrics
              |
              v
        lookupSites
              |
              v
      Postgres metadata
              |
              v
   derived track/chart asset
          storage
              |
              v
 Flight detail API/page enforces:
 owner access OR visibility = public
```

The ingestion seam is the central architectural choice. Web upload calls `ingestFlight({ source: "manual_upload", userId, file })`. A later Leaf device API should call the same service with `source: "leaf_device_push"`, a verified device identity, and either an IGC file or an equivalent fix stream. The parser and metric derivation should not know whether the file came from a browser or a device.

### Data Model

Use Supabase Auth's `auth.users` as the identity source and create application tables in public schema. Enable RLS on all user-owned tables.

**`profiles`**

- `id uuid primary key references auth.users(id)`
- `username citext unique not null`
- `display_name text not null`
- `bio text`
- `avatar_url text`
- `home_site_id uuid null references sites(id)`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

**`flights`**

- `id uuid primary key`
- `owner_id uuid not null references profiles(id)`
- `visibility text not null default 'private' check in ('private', 'public')`
- `source text not null check in ('manual_upload', 'leaf_device_push')`
- `status text not null check in ('uploaded', 'processing', 'ready', 'failed')`
- `title text`
- `igc_sha256 text not null`
- `igc_original_filename text`
- `igc_object_key text not null`
- `derived_object_key text`
- `parser_version text not null`
- `parse_warnings jsonb not null default '[]'`
- `failure_reason text`
- `flight_date date`
- `takeoff_time timestamptz`
- `landing_time timestamptz`
- `duration_seconds integer`
- `takeoff_lat double precision`
- `takeoff_lon double precision`
- `landing_lat double precision`
- `landing_lon double precision`
- `bounds jsonb`
- `takeoff_site_id uuid null references sites(id)`
- `landing_site_id uuid null references sites(id)`
- `takeoff_site_name text`
- `landing_site_name text`
- `max_altitude_m integer`
- `altitude_gain_m integer`
- `max_climb_ms double precision`
- `max_sink_ms double precision`
- `track_distance_m integer`
- `straight_distance_m integer`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Add a unique index on `(owner_id, igc_sha256)` to prevent duplicate uploads for one pilot while allowing another pilot to upload their own copy.

**`flight_assets`**

- `id uuid primary key`
- `flight_id uuid not null references flights(id)`
- `kind text not null check in ('raw_igc', 'derived_track')`
- `bucket text not null`
- `object_key text not null`
- `content_type text not null`
- `byte_size integer not null`
- `created_at timestamptz not null`

This keeps storage metadata explicit and leaves room for future thumbnails, GPX export, or device-origin payloads.

**`sites`**

- `id uuid primary key`
- `name text not null`
- `kind text not null check in ('takeoff', 'landing', 'both', 'unknown')`
- `lat double precision not null`
- `lon double precision not null`
- `country_code text`
- `region text`
- `source text not null`
- `source_id text`
- `source_url text`
- `license text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Indexes: `(lat, lon)`, `(source, source_id)`, and `lower(name)` for later admin tooling. M1 lookup queries sites in a bounding box around the coordinate, computes haversine distance in TypeScript, and accepts a match inside 2 km for takeoff and 3 km for landing. If there is no confident match, display "Unknown site" with coordinates, not a guessed town.

**Derived track asset shape**

Store one JSON object in private storage per ready flight:

- sanitized header fields
- full normalized fixes needed for chart hover and future export
- simplified map polyline for rendering
- downsampled altitude series for the barograph
- metric inputs used for audit/debugging

Do not store the full fix stream as one row per point in M1. It is unnecessary for the initial product, increases table churn, and can be introduced later if advanced analytics need SQL over fixes.

## Implementation

### Phase 0: Scaffold, Design System, and Local Foundations

**Goal:** create a deployable app shell that already looks like Leaf Log, with Supabase wired locally.

**Files**

- `package.json`
- `pnpm-lock.yaml`
- `next.config.ts`
- `tsconfig.json`
- `tailwind.config.ts`
- `postcss.config.mjs`
- `.env.example`
- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/app/page.tsx`
- `src/components/brand/LeafLogo.tsx`
- `src/components/ui/*`
- `src/lib/env.ts`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `supabase/config.toml`

**Checklist**

- [ ] Initialize Next.js App Router with TypeScript, pnpm, ESLint, Prettier, Vitest, and Playwright.
- [ ] Add Tailwind CSS with CSS variables for `--ink`, `--ink-soft`, `--paper`, `--amber`, `--leaf-green`, and neutral grays.
- [ ] Load Roboto and Roboto Condensed; reserve the Leaf wordmark font for the logo only.
- [ ] Build basic buttons, inputs, cards, metric tiles, section headers, and amber 3px accent-bar heading treatment.
- [ ] Create a minimal app shell with high-contrast monochrome base, warm amber accents, small radii, and subtle shadows.
- [ ] Add `.env.example` for Supabase, Vercel, MapTiler, and app URL variables.

### Phase 1: Auth, Profiles, and Database Policies

**Goal:** a pilot can sign up, create a profile, and access authenticated app routes.

**Files**

- `supabase/migrations/001_initial_schema.sql`
- `supabase/seed.sql`
- `src/lib/auth/current-user.ts`
- `src/app/(auth)/sign-in/page.tsx`
- `src/app/(auth)/sign-up/page.tsx`
- `src/app/(auth)/auth/callback/route.ts`
- `src/app/(app)/layout.tsx`
- `src/app/(app)/settings/profile/page.tsx`
- `src/app/(app)/settings/profile/actions.ts`
- `src/app/u/[username]/page.tsx`

**Checklist**

- [ ] Create `profiles`, `flights`, `flight_assets`, and `sites` tables.
- [ ] Enable RLS and write policies so users can read/update their own profile and own flights.
- [ ] Add public profile read policy that exposes profile basics but not private flight data.
- [ ] Configure Supabase Auth email magic-link/sign-in for M1; defer social login.
- [ ] Add username creation with reserved-name validation and case-insensitive uniqueness.
- [ ] Build profile settings and a public profile page that initially shows only public-ready flights.
- [ ] Add tests for private flight invisibility through profile queries.

### Phase 2: Upload-to-Flight Vertical Slice

**Goal:** a signed-in pilot uploads an IGC and reaches a ready private flight detail page, even if the UI is still minimal.

**Files**

- `src/app/(app)/upload/page.tsx`
- `src/app/(app)/upload/actions.ts`
- `src/app/(app)/flights/[flightId]/page.tsx`
- `src/app/(app)/flights/[flightId]/actions.ts`
- `src/lib/ingestion/ingest-flight.ts`
- `src/lib/ingestion/types.ts`
- `src/lib/igc/parse-igc.ts`
- `src/lib/igc/derive-metrics.ts`
- `src/lib/igc/detect-flight-window.ts`
- `src/lib/geo/distance.ts`
- `src/lib/storage/flight-assets.ts`
- `src/lib/validation/upload.ts`
- `tests/fixtures/igc/*.igc`
- `tests/unit/parse-igc.test.ts`
- `tests/unit/derive-metrics.test.ts`

**Checklist**

- [ ] Accept `.igc` files through drag-drop and file picker, capped at 5 MB for M1.
- [ ] Compute SHA-256 before or during upload and block duplicate uploads for the same pilot.
- [ ] Store raw IGC in a private Supabase Storage bucket before parsing.
- [ ] Implement a tolerant line-based parser for A, H, and B records; ignore unsupported record types without failing.
- [ ] Handle UTC date from `HFDTE`, midnight rollover, invalid fixes, missing baro altitude, and zero/placeholder altitude.
- [ ] Detect takeoff and landing as first/last sustained movement using a simple speed threshold over a rolling window, with fallback to first/last valid fix.
- [ ] Derive duration, takeoff/landing times, max altitude, cumulative altitude gain, max climb, max sink, track distance, and straight-line distance.
- [ ] Persist flight metadata and a private derived track JSON asset.
- [ ] Redirect to the private flight detail page with parse warnings visible to the owner.
- [ ] Mark failed parses as `failed` with a human-readable reason; never crash the upload request.

### Phase 3: Map, Barograph, and Flight Detail Polish

**Goal:** make the flight page the M1 showcase while staying faithful to the Leaf brand.

**Files**

- `src/components/flights/FlightMap.tsx`
- `src/components/flights/Barograph.tsx`
- `src/components/flights/MetricTileGrid.tsx`
- `src/components/flights/FlightHeader.tsx`
- `src/components/flights/VisibilityToggle.tsx`
- `src/app/api/flights/[flightId]/track/route.ts`
- `src/lib/flights/get-flight-detail.ts`
- `src/lib/flights/formatters.ts`

**Checklist**

- [ ] Render MapLibre with MapTiler vector tiles, track GeoJSON, start/landing markers, and automatic bounds fitting.
- [ ] Keep maps visually restrained: monochrome-friendly base map, amber track, green success/milestone accents, no competitive heatmap language.
- [ ] Serve derived track data through a Next.js route that enforces owner access or public visibility before reading private storage.
- [ ] Render a responsive Recharts barograph using barometric altitude when valid and GPS altitude as fallback.
- [ ] Add metric tiles with beginner-friendly labels: Airtime, Max altitude, Height gained, Track distance, Straight-line distance, Best climb, Strongest sink.
- [ ] Add owner-only parse warnings in plain language.
- [ ] Add owner-only visibility toggle with private as the default state.
- [ ] Verify mobile layout has no overlapping map/chart controls or overflowing metric text.

### Phase 4: Site Lookup and Logbook/Profile Completion

**Goal:** complete the public/private product loop and named site display.

**Files**

- `src/lib/sites/import-sites.ts`
- `src/lib/sites/lookup-site.ts`
- `supabase/seed/sites.csv`
- `scripts/import-sites.ts`
- `src/app/(app)/logbook/page.tsx`
- `src/components/flights/FlightList.tsx`
- `src/components/flights/FlightListItem.tsx`
- `src/app/u/[username]/flights/[flightId]/page.tsx`
- `src/lib/flights/get-logbook.ts`
- `src/lib/flights/get-public-flight.ts`

**Checklist**

- [ ] Import an attributed M1 seed set from ParaglidingEarth where permission/license is acceptable; include source URL/license fields per row.
- [ ] Add a manual seed path for Leaf-owned corrections and important missing local sites.
- [ ] Implement bounding-box candidate lookup and haversine ranking.
- [ ] Save both `site_id` and denormalized `site_name` on the flight so past flights remain readable if site data changes.
- [ ] Display "Unknown site" when no match is within threshold; do not invent names from geocoder towns.
- [ ] Build personal logbook list with private/public state, date, site names, duration, and key metrics.
- [ ] Build public profile flight list that includes only `ready` and `public` flights.
- [ ] Build logged-out public flight URL and confirm private flights 404 for non-owners.

### Phase 5: Verification, Hardening, and Deploy

**Goal:** prove the M1 happy path, privacy model, and parser edge cases before calling the sprint done.

**Files**

- `tests/e2e/auth-upload-flight.spec.ts`
- `tests/e2e/privacy.spec.ts`
- `tests/unit/site-lookup.test.ts`
- `tests/unit/visibility.test.ts`
- `tests/fixtures/igc/malformed.igc`
- `tests/fixtures/igc/midnight-rollover.igc`
- `tests/fixtures/igc/missing-baro.igc`
- `tests/fixtures/igc/zero-movement.igc`
- `README.md`
- `docs/ops/m1-deploy.md`

**Checklist**

- [ ] Add unit fixtures for valid Leaf IGC, non-Leaf IGC, malformed/truncated IGC, missing baro altitude, midnight rollover, zero movement, and large file near limit.
- [ ] Compare duration and max altitude against at least two known real files in a second-source IGC viewer.
- [ ] Add Playwright happy path: sign up, upload, view private flight, toggle public, verify logged-out public view.
- [ ] Add explicit privacy tests for private profile omission, private flight 404, and track API denial.
- [ ] Add basic rate limits for upload endpoint by user/IP.
- [ ] Deploy to Vercel with Supabase production project and private buckets.
- [ ] Document environment variables, local Supabase setup, seed import, and deployment steps.

## Files Summary

| Area | Files / Paths | Purpose |
|---|---|---|
| App scaffold | `package.json`, `next.config.ts`, `tsconfig.json`, `src/app/*` | Next.js TypeScript application foundation |
| Design system | `tailwind.config.ts`, `src/app/globals.css`, `src/components/ui/*`, `src/components/brand/LeafLogo.tsx` | Leaf-branded UI primitives and global tokens |
| Auth/profile | `src/app/(auth)/*`, `src/app/(app)/settings/profile/*`, `src/lib/auth/*` | Sign-in, profile creation, current-user helpers |
| Database | `supabase/migrations/001_initial_schema.sql`, `supabase/seed.sql` | Tables, indexes, constraints, RLS policies |
| Upload | `src/app/(app)/upload/*`, `src/lib/validation/upload.ts` | IGC upload UI and server action |
| Ingestion seam | `src/lib/ingestion/*` | Shared path for manual upload now and Leaf device push later |
| IGC parser | `src/lib/igc/*`, `tests/fixtures/igc/*` | Parse, tolerate, normalize, and derive flight metrics |
| Storage | `src/lib/storage/flight-assets.ts` | Raw IGC and derived track asset storage |
| Flight detail | `src/app/(app)/flights/[flightId]/*`, `src/components/flights/*`, `src/app/api/flights/[flightId]/track/route.ts` | Owner flight view, map, barograph, metrics, visibility toggle |
| Sites | `src/lib/sites/*`, `scripts/import-sites.ts`, `supabase/seed/sites.csv` | Seeded site data and nearest-site lookup |
| Logbook/public | `src/app/(app)/logbook/page.tsx`, `src/app/u/[username]/*`, `src/lib/flights/*` | Personal logbook and public profile/flight views |
| Tests | `tests/unit/*`, `tests/e2e/*` | Parser, metrics, site lookup, happy path, privacy |
| Ops docs | `README.md`, `docs/ops/m1-deploy.md`, `.env.example` | Local setup and deployment |

## Definition of Done

- A new pilot can sign up, choose a username, and see an authenticated logbook.
- A signed-in pilot can upload a valid IGC file and receive a persisted private flight.
- Raw IGC files are stored durably in private object storage.
- Server-side parsing extracts useful header data and valid B-record fixes without crashing on malformed files.
- Derived metrics include duration, takeoff/landing times, max altitude, altitude gained, max climb, max sink, track distance, and straight-line distance.
- Takeoff and landing coordinates are matched to named sites when a confident seeded-site match exists.
- The flight detail page includes a MapLibre track map, Recharts barograph, metric tiles, site names, and owner-only parse warnings.
- The personal logbook lists the pilot's own private and public flights.
- Flights default to `private`, can be toggled public by the owner, and public pages expose only public ready flights.
- Logged-out visitors can view a public profile and public flight page.
- Logged-out visitors and non-owners cannot query private flights or derived track assets.
- The UI visibly honors `DESIGN.md`: Roboto/Roboto Condensed, monochrome base, amber `#ffb459` accent bars, provisional leaf-green success accents, small corners, subtle shadows, and encouraging plain-language copy.
- Unit tests cover parser and metric edge cases; E2E tests cover signup-upload-view-share and privacy denial.
- The app is deployed to Vercel against production Supabase with documented environment variables and seed process.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| IGC edge cases create incorrect metrics | High | Keep parser small and well-tested with fixtures; store raw IGC for reprocessing; version parser outputs with `parser_version`. |
| Upload request times out during parsing | Medium | M1 files are capped at 5 MB and parsed synchronously in Node; if real files exceed this, move only the orchestration to a background worker while preserving `ingestFlight`. |
| Site dataset licensing is unclear | High | Prefer ParaglidingEarth only with acceptable permission/terms; store source/license fields; keep manual Leaf-owned seed corrections; avoid OpenAIP as primary due CC BY-NC commercial risk. |
| Site lookup quality feels weak outside seeded regions | Medium | Use confidence thresholds, display "Unknown site" honestly, and make seed import repeatable so coverage improves without schema changes. |
| Privacy leak through public pages or track API | High | Enforce RLS, private storage buckets, server-side visibility checks, and explicit E2E denial tests. |
| Map tile vendor cost or token exposure | Medium | Use MapLibre so the renderer is not vendor-locked; keep tile token domain-restricted; abstract tile style URL in env. |
| Supabase lock-in slows future migration | Low | Use ordinary Postgres tables and private object storage concepts; keep provider calls isolated in `src/lib/supabase` and `src/lib/storage`. |
| UI polish balloons scope | Medium | Make the flight detail page the showcase; keep logbook/profile straightforward; defer feed, advanced analysis, and 3D playback. |
| Future device push needs a different ingestion contract | Medium | Make `ingestFlight` source-agnostic from M1 and keep parsing/derivation independent of HTTP and browser upload details. |

## Security Considerations

- Default `flights.visibility` to `private` with a database default and an application-level explicit value on create.
- Enable RLS on `profiles`, `flights`, and `flight_assets`; owners can manage their own rows, public readers can only access public ready flights through constrained queries.
- Keep Supabase Storage buckets private. Never expose raw object keys as authorization. Serve derived track data through server routes that check ownership or public visibility.
- Do not expose raw IGC files publicly in M1, even for public flights. Public pages get sanitized derived track data only.
- Cap uploads at 5 MB, require `.igc` extension plus text-like content, and reject empty or binary-looking files.
- Treat IGC contents as untrusted text. Escape all displayed header fields and filenames.
- Parser must be fail-closed: invalid records are warnings, impossible files become failed flights, and unhandled exceptions become controlled failure states.
- Rate-limit upload attempts by authenticated user and IP to control storage abuse.
- Store only necessary profile data. Avoid collecting precise home location in M1.
- Keep service-role Supabase keys server-only. Browser code uses anon key and RLS.
- Restrict MapTiler token by domain in production.
- Add audit-friendly timestamps and preserve raw IGC so bad parser versions can be corrected later.

## Dependencies

- **Node/pnpm/TypeScript:** single-language app and parser for solo-dev velocity.
- **Next.js App Router:** full-stack React, server actions/route handlers, Vercel-native deploy path.
- **Vercel:** low-ops hosting with strong Next.js support.
- **Supabase Auth:** hosted email auth, sessions, and user IDs integrated with Postgres RLS.
- **Supabase Postgres:** relational source of truth for profiles, flights, metrics, visibility, and sites.
- **Supabase Storage:** private durable storage for raw IGC and derived track JSON.
- **Tailwind CSS:** fast implementation of the Leaf design language through explicit tokens.
- **Radix UI primitives:** accessible dialogs, menus, toggles, and form primitives without inventing interaction behavior.
- **MapLibre GL JS:** open renderer, no Mapbox lock-in, good GeoJSON track rendering.
- **MapTiler Cloud:** pragmatic M1 tile provider with MapLibre-compatible vector styles and manageable early cost.
- **Recharts:** fast React barograph implementation with responsive charts and custom tooltips.
- **ParaglidingEarth API/GeoJSON:** preferred M1 site seed source if terms/permission are acceptable; official source URL and license fields must be stored with imported rows.
- **Vitest and Playwright:** unit coverage for parser/metrics plus E2E coverage for the privacy-sensitive happy path.

## Open Questions

All M1 architecture questions are resolved by this plan:

- **Stack:** Next.js App Router + TypeScript + Tailwind CSS. This is the best velocity/UI/maintainability tradeoff for one developer and keeps parser, ingestion, and UI types in one language.
- **Hosting/DB/storage/auth:** Vercel + Supabase Auth + Supabase Postgres + Supabase Storage. This minimizes ops and cost while still giving a real backend, private object storage, and RLS.
- **IGC parsing:** build a small tolerant parser in the repo. Run it server-side in the Node request path for M1, behind `ingestFlight`, with raw-file-first storage and parser-versioned outputs. Do not parse at the edge.
- **Future device-push seam:** later device endpoints call the same `ingestFlight` service. Device auth and firmware pairing are out of M1, but the core ingestion contract is source-agnostic now.
- **Map rendering:** MapLibre GL JS with MapTiler vector tiles. Render the track from sanitized derived GeoJSON, not directly from raw IGC.
- **Barograph rendering:** Recharts, using barometric altitude first and GPS altitude fallback. Keep styling Leaf-branded and readable rather than instrument-panel dense.
- **Site lookup:** seed `sites` from ParaglidingEarth where allowed, with Leaf-owned manual corrections. Use bounding-box plus haversine lookup in TypeScript for M1. Defer PostGIS.
- **Data model:** Supabase Auth users, `profiles`, `flights`, `flight_assets`, and `sites`; raw IGC and derived track JSON live in private storage, while searchable metadata and metrics live in Postgres.
- **Cut line if time-constrained:** keep auth, upload, parser, private flight detail, and privacy tests. Cut public profile polish before parser correctness. Cut site dataset breadth before site lookup structure. Cut chart flourishes before map readability. Never cut private-by-default enforcement.

Remaining non-blocking future decisions:

- Exact Leaf device-push authentication and pairing model.
- Whether advanced analytics justify storing every fix as relational rows.
- Whether site coverage should move to PostGIS and a licensed commercial dataset after M1 usage proves the need.
- Whether public shared flights should later expose downloadable IGC files; M1 says no.
