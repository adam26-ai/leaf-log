# Sprint 001 Intent: Leaf Log — Milestone 1 (Logbook Foundation)

## Seed

Plan Milestone 1 of **Leaf Log** — the official social flight-logbook companion for the
**Leaf vario** (an open-source paragliding/hang-gliding flight computer). M1 delivers the
foundation of a hosted, multi-user web platform:

- User accounts + **public pilot profiles**
- Manual **IGC file upload** (drag-drop / file picker)
- **Parse** the IGC + **derive** flight metrics
- **Reverse-lookup** takeoff/landing coordinates to a **named site**
- A **beautiful flight-detail page** (track map + barograph)
- A **personal logbook list**
- Flights are **private by default**; sharing is opt-in per flight

The community feed/following, kudos/comments, and the Leaf device-push ingestion API are
**later milestones — explicitly out of scope for M1** (but the architecture must not paint
us into a corner for them).

## Context

- **Greenfield.** The repo currently contains only `VISION.md`, `DESIGN.md`, and this
  planning doc. No code, no stack chosen yet. One commit on `main`. macOS dev machine.
- **Product identity** (from `VISION.md`): "Strava for the rest of us" — a warm, welcoming,
  **private-first** logbook for **beginner/intermediate** pilots, deliberately NOT the
  competitive XContest/Leonardo crowd. Solo value (progress, personal bests) must stand on
  its own even if a pilot never shares.
- **Design identity** (from `DESIGN.md`): "Same DNA as leafvario.com, warmer room."
  Anchors: **Roboto** (body) + **Roboto Condensed** (headings), monochrome black/white base,
  signature **amber `#ffb459`** 3px accent-bar motif, a provisional **leaf-green** secondary
  (~`#6FAE5E`) for success/milestones, soft corners (~4–6px), subtle shadows, real flight
  photography, encouraging plain-language voice.
- **Official Leaf companion** — the team influences the Leaf firmware, so the future device-
  push path will be co-designed. M1 doesn't build it, but should leave a clean seam for it
  (e.g. an ingestion service that a future device API can also call).

## Recent Sprint Context

None — this is the first sprint. No prior code or conventions to extend.

## Relevant Codebase Areas

- `VISION.md` — product north star (positioning, data spine, privacy model, phasing).
- `DESIGN.md` — visual design tokens and rules (must be honored by the frontend).
- Everything else is to be created by this sprint.

## Domain primer: the IGC file

IGC is the FAI/IGC flight-recorder text format. Key facts the drafts must account for:

- Line-based ASCII. **A records** (manufacturer/recorder id), **H records** (headers:
  pilot, glider type, date `HFDTE`, etc.), **B records** (the fix stream), plus I/J/L/G etc.
- A **B record** is one timestamped fix: `B HHMMSS DDMMmmm[N/S] DDDMMmmm[E/W] A/V
  PPPPP(pressure alt) GGGGG(GPS alt) ...`. Typically 1–2 s cadence → a 3-hour flight is
  ~5k–10k points.
- Altitude comes in **two flavors**: barometric (pressure) and GPS. Baro is generally
  preferred for vertical metrics; handle missing/zero baro gracefully.
- Times are UTC and **wrap past midnight**; dates come from the `HFDTE` header.
- Files are usually small (tens to low-hundreds of KB) but can be malformed, truncated, or
  from non-Leaf recorders. Parser must be tolerant and never crash the request.
- **Derived metrics** wanted for M1: duration (takeoff→landing), takeoff/landing times,
  max altitude, altitude gained (cumulative climb), max climb rate, max sink rate, track
  distance (sum of segments), straight-line distance (takeoff→landing). Takeoff/landing
  detection = first/last sustained movement (simple speed/altitude heuristic is fine for M1).

## Constraints

- **Honor `DESIGN.md`** — the frontend must visibly carry the Leaf brand DNA.
- **Private by default** — visibility (`private` | `public`, and design for a future
  `followers`) enforced at the data layer, not just the UI. Public profile pages must only
  expose flights the owner marked public.
- **Hosted cloud, real backend** — accounts, a database, durable object storage for raw IGC
  files, server-side parsing/derivation.
- **Don't foreclose later milestones** — community (feed/follow/kudos) and device-push
  ingestion. Prefer an ingestion path that both the web upload and a future device API can
  share.
- Solo dev / small team velocity matters — prefer a stack that one person can ship and
  operate without heavy ops burden.
- Cost-conscious early (low/no traffic) — generous free tiers / cheap hosting preferred.

## Success Criteria

A pilot can: sign up → upload an IGC → see it parse server-side → land on a polished flight
page (map of the track + barograph + the derived metric tiles + detected site name) → see
that flight in their personal logbook list → toggle it public → and have a logged-out
visitor view it at a public profile/flight URL (while private flights stay hidden). The UI
is recognizably "Leaf brand." Parsing is robust against malformed/foreign IGC files.

## Verification Strategy

- **Reference/spec:** IGC format spec (FAI). Verify derived metrics against a couple of
  known real Leaf `.igc` files and a second-source tool (e.g. an existing IGC viewer) for
  duration/max-altitude sanity.
- **Edge cases:** malformed/truncated IGC; missing baro altitude; midnight UTC rollover;
  zero-movement "flight"; huge file; non-Leaf recorder; duplicate upload of same flight.
- **Testing:** unit tests for the parser + derivation (fixture IGC files, including
  intentionally broken ones); a thin integration/E2E happy-path (signup → upload → view →
  toggle public → logged-out view). Privacy enforcement must have an explicit test.

## Uncertainty Assessment

- **Correctness uncertainty: Medium** — IGC parsing and metric derivation are
  well-specified but full of small edge cases; site reverse-lookup quality depends on the
  dataset.
- **Scope uncertainty: Medium** — M1 is bounded, but "beautiful flight page" and
  "site lookup" can balloon; drafts should propose a crisp MVP line and what to defer.
- **Architecture uncertainty: High** — no stack chosen; hosting, DB, storage, auth, map
  rendering, and the parse-service boundary are all open and consequential.

## Open Questions (drafts should each take a position)

1. **Stack.** Full-stack framework + language? (e.g. Next.js/TS, Remix, SvelteKit,
   Rails, Django, Phoenix, Go + React…). Justify for a solo dev optimizing for velocity,
   great UI, and a clean parse-service seam.
2. **Hosting / DB / storage / auth.** Concrete picks (e.g. Vercel/Fly/Render; Postgres via
   Supabase/Neon/RDS; S3/R2/Supabase Storage; Auth.js/Clerk/Supabase Auth). Cost & ops
   tradeoffs for an early-stage solo project.
3. **IGC parsing.** Build a small parser vs. use an existing library? Where does parsing run
   (request path, background job, edge)? How to keep a future device-push path sharing the
   same ingestion/derivation core?
4. **Map & barograph rendering.** Map library (MapLibre/Mapbox/Leaflet) + tiles; how to draw
   the track; barograph charting approach. Honor the Leaf aesthetic.
5. **Site reverse-lookup.** Dataset/source for takeoff/landing → named site
   (ParaglidingEarth, DHV, a seeded table, nearest-neighbor search). How to store & query
   (e.g. PostGIS vs. simple bounding-box/haversine). What's the M1-acceptable quality bar?
6. **Data model.** Core entities (User/Pilot, Flight, raw IGC blob, derived metrics, Site,
   visibility) and where raw vs. derived data live.
7. **Phasing & cut lines.** How to sequence M1 so there's a runnable vertical slice early;
   what to cut first if time-constrained.
