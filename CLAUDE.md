@AGENTS.md

# Leaf Log — working agreement

The friendly, private-first flight logbook for the Leaf vario. Product north star:
[`VISION.md`](./VISION.md); visual language: [`DESIGN.md`](./DESIGN.md); architecture:
[`docs/architecture.md`](./docs/architecture.md); the M1 plan: [`docs/sprints/SPRINT-001.md`](./docs/sprints/SPRINT-001.md).

## Git workflow

- **Never commit directly to `main`.** All changes go through a `feature/<description>`
  or `fix/<description>` branch and a PR.
- **Always ask before committing or merging.** No autonomous commits or merges.
- Open a PR with a summary and test plan before merging.
- Merge with `gh pr merge --squash --delete-branch`.
- End commit messages with the Co-Authored-By trailer for the active model.

## Validation gates (must pass before any commit / PR)

- `pnpm build` — production build (`prisma generate && next build`).
- `pnpm test` — Vitest: IGC unit tests + privacy/site integration tests (the integration
  tests auto-skip without `DATABASE_URL`).
- `pnpm typecheck` and `pnpm lint`.
- `pnpm e2e` — Playwright happy-path (needs local Postgres + a dev server).

## Dev loop

- **After any code change**: kill Next.js processes, `rm -rf .next`, restart `pnpm dev`.
  Stale cache causes "Cannot find module" / "Failed to find Server Action" / missing styles.
- Local stack: `pnpm db:up` (docker-compose Postgres, port 5437) → `pnpm db:migrate` →
  `pnpm db:seed` → `pnpm dev` (http://localhost:3000).
- **Magic link in dev**: no email is sent — the link is written to
  `/tmp/leaf-magic-link.txt` and logged to the server console.

## Stack & gotchas (hard-won)

- **Prisma is pinned to v6**, not 7 — v7 removed `url` from the schema datasource (needs a
  driver adapter). Keep v6 to match avionics-planner.
- **NextAuth v5**: `pages.verifyRequest` must be a **query-less path** (`/check-email`) — a
  value with `?` gets mangled. The edge-safe `lib/auth.config.ts` is split from `lib/auth.ts`
  so `proxy.ts` (middleware) reads the JWT **without importing Prisma**.
- **Next 16**: the middleware file is `proxy.ts` (not `middleware.ts`); `cookies()` is async.
- **Privacy is app-layer (no RLS).** EVERY flight read MUST go through the viewer-scoped repo
  `lib/flights/repo.ts` (`getFlightForViewer` / `listPublicFlights` / `listOwnFlights`).
  Never query `prisma.flight` for display without an explicit viewer/owner scope.
- **Ingestion seam**: `lib/ingest/ingest-flight.ts` `ingestFlight({ source, ownerId, bytes })`
  is the single, source-agnostic path. The web upload route is a thin caller; the future
  Leaf device-push API will reuse it. Don't put parse/derive/persist logic in routes.
- **Files live in Postgres**: raw IGC (`bytea`) + derived track (`jsonb`) on `FlightData`,
  kept off the `Flight` row so list queries stay fast.
- **Pure IGC logic** lives in `lib/igc/` and is unit-tested — keep it free of DB/Next imports.
- Service-role / privileged DB access stays server-side; public pages expose derived data only.

## Deploy

Railway via [`railway.toml`](./railway.toml) (Nixpacks, `prisma migrate deploy` pre-deploy,
`/api/health`). See [`README.md`](./README.md) for env vars and first-deploy steps.

**Every user-facing release MUST add a `/whats-new` entry.** Before deploying a feature,
prepend a friendly, benefit-oriented note to `RELEASE_NOTES` in
[`lib/whats-new.ts`](./lib/whats-new.ts) (newest first) — this is the user-facing
changelog. `FEATURES.md` remains the developer-facing log; the two are separate.
