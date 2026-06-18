# Leaf Log

The friendly, private-first flight logbook for the free-flight community — the
official companion to the **Leaf vario**. Upload an IGC file, see your flight
come to life (track map, barograph, metrics, named site), and share only what you
choose. See [`VISION.md`](./VISION.md) and [`DESIGN.md`](./DESIGN.md).

Milestone 1 was built per [`docs/sprints/SPRINT-001.md`](./docs/sprints/SPRINT-001.md).

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind v4** + shadcn-style primitives
- **Postgres** via **Prisma** (deployed on **Railway**)
- **NextAuth v5** — email magic-link (via **Resend** in production)
- **MapLibre GL JS** (keyless OpenFreeMap basemap) + **Recharts** barograph
- In-house tolerant IGC parser behind a source-agnostic `ingestFlight()` core
- Raw IGC + derived track stored in Postgres; **privacy enforced at the
  application/query layer** (the viewer-scoped repo in `lib/flights/repo.ts`)

## Prerequisites

- Node 20+ and `pnpm`
- Docker (for local Postgres)

## Local development

```bash
pnpm install

# 1. Start local Postgres (docker-compose, port 5437).
pnpm db:up

# 2. Configure env.
cp .env.example .env.local
#   - set DATABASE_URL to the local Postgres (already correct in the example)
#   - set AUTH_SECRET to any 32+ char string

# 3. Apply migrations + seed sites.
pnpm db:migrate      # prisma migrate dev
pnpm db:seed         # 12 curated sites

# 4. Run the app.
pnpm dev             # http://localhost:3000
```

In dev, **no real email is sent** — the magic-link URL is logged to the server
console and written to `/tmp/leaf-magic-link.txt`.

## Testing

```bash
pnpm test        # unit (IGC parser/derive/artifact) + privacy & site integration
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm e2e         # Playwright happy-path (needs local Postgres running)
```

Integration tests (`*.integration.test.ts`, `lib/sites/lookup.test.ts`) auto-skip
when `DATABASE_URL` is unset.

## Sites data

Named-site reverse lookup is a bounding-box + haversine search over the `Site`
table. M1 ships a **curated manual seed** (`prisma/seed.ts`) — the documented
Plan B while ParaglidingEarth bulk-redistribution terms are unconfirmed. When a
licensed dataset is cleared, import it with `source`/`sourceUrl`/`license` set and
run `scripts/backfill-sites.ts` to name existing flights.

## Deployment (Railway)

Config lives in [`railway.toml`](./railway.toml) (Nixpacks builder,
`prisma migrate deploy` as the pre-deploy step, `/api/health` health check).

1. Create a Railway project; add a **Postgres** plugin (provides `DATABASE_URL`).
2. Add the web service from this repo.
3. Set env vars: `DATABASE_URL` (from the Postgres plugin), `AUTH_SECRET`,
   `AUTH_URL`/`NEXTAUTH_URL` (your Railway URL), `AUTH_EMAIL_FROM`,
   `RESEND_API_KEY`, and optionally `NEXT_PUBLIC_MAPTILER_KEY`.
4. Deploy — `prisma migrate deploy` runs automatically before each release. Seed
   sites once with `pnpm db:seed` against the production `DATABASE_URL`.

## Project structure

```
app/                     routes (auth, onboarding, logbook, flights, profile, api)
components/              UI: brand primitives, flight viz, logbook, upload
lib/igc/                 tolerant parser, derivation, detection, track artifact
lib/ingest/              ingestFlight() — the shared, source-agnostic ingestion core
lib/flights/repo.ts      viewer-scoped reads (app-layer privacy)
lib/sites/               haversine named-site lookup
lib/auth*.ts, lib/email  NextAuth v5 config + magic-link sender
prisma/                  schema, migrations, seed
docs/                    sprint plan + architecture
```

See [`docs/architecture.md`](./docs/architecture.md) for the ingestion seam,
privacy model, and data flow.
