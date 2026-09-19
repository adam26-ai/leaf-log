# Leaf Log

The friendly, private-first flight logbook for the free-flight community — the
official companion to the **Leaf vario**. Upload an IGC file, see your flight
come to life (track map, barograph, metrics, named site, geotagged photos), and
share only what you choose. See [`VISION.md`](./VISION.md) and [`DESIGN.md`](./DESIGN.md).

**Live:** <https://log.leafvario.com>

Milestone 1 was built per [`docs/sprints/SPRINT-001.md`](./docs/sprints/SPRINT-001.md).
A running log of shipped features lives in [`FEATURES.md`](./FEATURES.md).

## Stack

- **Next.js 16** (App Router, TypeScript) + **Tailwind v4** + shadcn-style primitives
- **Postgres** via **Prisma** (deployed on **Railway**)
- **NextAuth v5** — email magic-link (via **Resend** in production)
- **MapLibre GL JS** (keyless OpenFreeMap basemap) + **Recharts** barograph
- In-house tolerant IGC parser behind a source-agnostic `ingestFlight()` core
- Raw IGC + derived track stored in Postgres; **privacy enforced at the
  application/query layer** (the viewer-scoped repo in `lib/flights/repo.ts`)

## Prerequisites

- Node 24.14.0 (see `.node-version`) and `pnpm` 10.28.2
- Docker (for local Postgres)

## Local development

### Windows quick start

Run this from the project folder in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-local.ps1
```

The launcher uses installed dependencies, creates `.env.local` if needed with a
random auth secret, starts Docker Desktop and Postgres, applies existing
migrations, and serves the app at the local `AUTH_URL`. Loopback URLs bind only
to `127.0.0.1`; private-LAN URLs bind to all interfaces for phone testing. It
uses Node from PATH or the Node runtime bundled with Codex on this machine. On a
fresh checkout, install dependencies with `pnpm install` first. The launcher
requires the local database settings from `.env.example` and an empty
`RESEND_API_KEY`.

On affected Windows 11 builds, a Docker Desktop shutdown can leave
inaccessible AF_UNIX socket reparse points behind. When Docker fails with that
specific signature, the launcher stops the failed startup, preserves the two
runtime directories with `.stale-<timestamp>` names, and retries once. It never
deletes Docker images, containers, volumes, or project data. Other Docker
startup failures are reported without automatic recovery.

Keep that terminal running; saved code changes appear automatically in the
browser. Press **Ctrl+C** to stop the website; Docker Desktop stays running so
the next launch is fast. Pass `-StopDockerWhenDone` to request Docker Desktop's
supported stop sequence after the website exits. `docker compose stop` stops
the database while keeping its data; running the launcher again resumes it.

The local database starts empty and persists in Docker's `leaf-log-db` volume.
Create a local account from the sign-in page using any test email address. After
requesting a magic link, copy it from the server terminal, or open the latest link
from another PowerShell window:

```powershell
Start-Process (Get-Content (Join-Path $env:TEMP 'leaf-magic-link.txt') -Raw).Trim()
```

No email is sent when `RESEND_API_KEY` is empty. Local accounts and flights are
separate from Railway. `.env.local` is gitignored. If you need a sample IGC file:

```powershell
node --import tsx scripts/gen-fixture.ts test/e2e/.fixture.igc
```

### Manual setup (all platforms)

```bash
pnpm install

# 1. Start local Postgres (docker-compose, port 5437).
pnpm db:up

# 2. Configure env.
cp .env.example .env.local
#   - set DATABASE_URL to the local Postgres (already correct in the example)
#   - set AUTH_SECRET to any 32+ char string

# 3. Apply migrations. (No site seed — sites are fully community-driven.)
pnpm db:migrate      # prisma migrate dev
pnpm db:seed         # currently a no-op; kept as the seed entry point

# 4. Run the app.
pnpm dev             # http://localhost:3000
```

With `RESEND_API_KEY` empty, **no real email is sent** — the magic-link URL is
logged to the server console and written to `leaf-magic-link.txt` in the operating
system's temporary directory (`$env:TEMP` on Windows, usually `/tmp` on Linux).

## Testing

```bash
pnpm check       # required before submitting: typecheck, lint, tests, build AND browsers
pnpm check:linux # reproduce CI in Linux with Docker, pinned runtimes and an isolated database
pnpm test        # unit (IGC parser/derive/artifact) + privacy & site integration
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm e2e         # Playwright browser suite (needs local Postgres running)
```

The test suite requires a local `DATABASE_URL` and running PostgreSQL. Missing
configuration fails immediately instead of skipping integration coverage.
`pnpm check` uses the same pinned Node version and entry points as CI
(`check:gates` and `check:e2e`), and rejects focused tests such as `test.only`.
It requires installed dependencies and Chromium. A passing `pnpm test` alone
does not validate browser workflows. See [the CI audit](docs/testing.md) for the
failure history and the rules for changing shared UI workflows.

With a local database configured, the unit/integration suite applies migrations
to its own temporary schema and removes it afterward. Files run serially because
they exercise the shared XC queue. Existing development flights are not included
in backfill tests, so a growing local logbook cannot slow down those checks.

Playwright builds and starts its own production server at `http://localhost:3100`,
with separate `.next-e2e` output and a fresh temporary PostgreSQL schema for each
run. This avoids development rebuilds and Fast Refresh interrupting browser
interactions. It applies migrations, generates the IGC fixture, and removes the
schema after the run; your normal logbook and phone-testing settings are left alone. Real email is
disabled for this server, and its magic links use a separate temporary file.
Keep port 3100 free. Test traces and screenshots are saved under
`test-results/playwright` on failure. Open the HTML report with
`pnpm exec playwright show-report`; CI retains it and both suites' JUnit results
for seven days, including successful runs.

Install Chromium once with `pnpm exec playwright install chromium` (CI uses
`--with-deps`). Windows falls back to installed Edge if bundled Chromium is
missing; `PLAYWRIGHT_CHANNEL=msedge` can also select it explicitly. The test
browser explicitly uses software WebGL locally and in CI. Shared browser
fixtures cover every pilot's session and replace third-party map data; real app
requests and map rendering remain enabled. Unexpected external requests fail
with diagnostics instead of silently depending on live services.

## Sites data

Named-site reverse lookup is a boundary-aware geographic search over the `Site`
table. Sites are fully community-driven: pilots can create and map one in
**Settings → Sites** without an IGC file, or select/create one from a flight.
Creating, renaming, moving, or redrawing a site never silently changes other
flight assignments. The management screen previews coordinate matches and
requires an explicit selection before updating any historical flight. If
multiple sites contain a new IGC endpoint, Leaf Log leaves it for review rather
than silently choosing the nearest candidate.

## Deployment (Railway)

Config lives in [`railway.toml`](./railway.toml) (Nixpacks builder,
`prisma migrate deploy` as the pre-deploy step, `/api/health` health check).

1. Create a Railway project; add a **Postgres** service (provides `DATABASE_URL`).
2. Add the web service from this repo.
3. Set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the web service to use
   Railway's private network. Do not point it at `DATABASE_PUBLIC_URL`. Set
   `AUTH_SECRET`, `AUTH_URL`/`NEXTAUTH_URL` (`https://log.leafvario.com` in
   production), `AUTH_EMAIL_FROM`, `RESEND_API_KEY`, and optionally
   `NEXT_PUBLIC_MAPTILER_KEY`.
4. Deploy — `prisma migrate deploy` runs automatically before each release. No
   site seeding step — sites are fully community-driven.

The build (`prisma generate && next build`) does not use the database, so no
`DATABASE_BUILD_URL` is needed. Railway's pre-deploy migration runs after the
build with private-network access; the running app uses the same private
`DATABASE_URL`. Keep a public database URL only for clients outside Railway,
not as a web-service variable.

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
