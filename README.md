# Leaf Log

The friendly, private-first flight logbook for the free-flight community — the
official companion to the **Leaf vario**. Upload an IGC file, see your flight
come to life (track map, barograph, metrics, named site), and share only what you
choose. See [`VISION.md`](./VISION.md) and [`DESIGN.md`](./DESIGN.md).

Milestone 1 is built per [`docs/sprints/SPRINT-001.md`](./docs/sprints/SPRINT-001.md).

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind v4** + shadcn-style primitives
- **Supabase** — Postgres + PostGIS, Auth (email magic-link), private Storage
- **MapLibre GL JS** (keyless OpenFreeMap basemap) + **Recharts** barograph
- In-house tolerant IGC parser behind a source-agnostic `ingestFlight()` core
- Privacy enforced at the data layer with **Row-Level Security**

## Prerequisites

- Node 20+ and `pnpm`
- Docker (for local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

## Local development

```bash
pnpm install

# 1. Start the local Supabase stack (Postgres+PostGIS+Auth+Storage+Mailpit).
#    This project runs on ports 5532x to avoid clashing with other projects.
supabase start

# 2. Apply migrations + seed sites into a fresh local DB.
supabase db reset

# 3. Write .env.local from the local stack's values.
cp .env.example .env.local
supabase status -o env   # copy ANON_KEY / API_URL / SERVICE_ROLE_KEY in

# 4. Run the app.
pnpm dev                 # http://localhost:3000
```

Magic-link emails are captured by **Mailpit** (the URL is printed by
`supabase status`) — no real email is sent locally.

## Testing

```bash
pnpm test        # unit (IGC parser/derive/artifact) + privacy & site integration
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm e2e         # Playwright happy-path (needs the local stack running)
```

Integration tests (`*.integration.test.ts`, `lib/sites/lookup.test.ts`) auto-skip
when no local Supabase env is present.

## Sites data

Named-site reverse lookup uses a PostGIS KNN function (`nearest_site`) over the
`sites` table. M1 ships a **curated manual seed** (see
`supabase/migrations/*_sites_seed.sql`) — the documented Plan B while
ParaglidingEarth bulk-redistribution terms are unconfirmed. When a licensed
dataset is cleared, import it with `source`/`source_url`/`license` set and run
`scripts/backfill-sites.ts` to name existing flights.

## Deployment (production)

1. Create a **Supabase** cloud project; push the schema (`supabase db push`) and
   seed sites.
2. Deploy the web app to **Vercel**.
3. Set env vars in Vercel: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only),
   `NEXT_PUBLIC_SITE_URL`, and optionally `NEXT_PUBLIC_MAPTILER_KEY` (otherwise
   the keyless OpenFreeMap basemap is used).
4. In Supabase Auth settings, set the Site URL + redirect allow-list to your
   production domain (`https://your-domain/**`).

## Project structure

```
app/                     routes (auth, onboarding, logbook, flights, profile, api)
components/              UI: brand primitives, flight viz, logbook, upload
lib/igc/                 tolerant parser, derivation, detection, track artifact
lib/ingest/              ingestFlight() — the shared, source-agnostic ingestion core
lib/sites/               PostGIS KNN named-site lookup
lib/supabase/            RLS-respecting clients + service-role admin + proxy session
supabase/migrations/     schema, RLS, storage buckets, sites + KNN function
docs/sprints/            the sprint plan this milestone was built from
```

## Architecture

See [`docs/architecture.md`](./docs/architecture.md) for the ingestion seam, the
privacy model, and the data flow.
