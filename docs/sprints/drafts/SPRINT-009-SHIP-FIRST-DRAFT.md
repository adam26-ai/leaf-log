# SPRINT-009 — USHPA Ratings Progress (ship the numbers first)

## Overview

Leaf Log already has, in the `Flight` row that exists today, most of the raw material for a
pilot to watch their own USHPA rating progress: flight count, flight date (→ flying days),
duration (→ airtime), and site linkage (→ site diversity) are all there right now, with zero
schema work. `lib/flights/repo.ts::statsFrom` is proof this data reduces cleanly and cheaply —
it already does a version of this exact computation for the three-stat logbook bar. This
sprint's thesis is that the honest, useful version of "Ratings Progress" is not one feature
that lands complete on merge day — it's a page that goes live showing real numbers computed
from data Leaf Log already has, then gets a new capability added to it every one to two weeks
as instructor-facing plumbing (flight type, instructor assignment, instructor notes, witnessed
signoffs) is built and merged behind it, each one unlocking previously-greyed rows on a page
pilots are already checking.

The alternative — designing `flightType`, `instructorId`, `InstructorNote`, and a signoff model
up front, migrating all four in one PR, and holding the page back until every USHPA criterion in
scope has *some* representation — trades weeks of dark development for a "complete" v1 that is
provably no more correct than shipping the auto-calculable subset today: none of P2/P3/P4's
witnessed-skill criteria can be satisfied without a real instructor relationship existing in the
data, and Leaf Log has zero of those relationships today no matter how good the schema is on day
one. The schema-first version cannot show a single pilot a single instructor-signed-off criterion
any sooner than the incremental version can — it can only delay showing them the ~70% of P2–P4
that needs no instructor at all. Shipping the auto-calc slice first is not a compromise; it is
strictly more feature for less elapsed time, and it front-loads the part of this sprint with the
highest payoff-to-risk ratio (a page, not a migration) to the point where real pilots can react to
it while the rest is still being built.

### Anchoring decisions

1. **PR1 makes zero changes to the `Flight` table.** Every number on the v1 `/ratings` page is
   computed from columns that exist in production today (`flightDate`, `durationS`, `status`,
   `takeoffSiteId`/`takeoffSiteName`, and `glider` — which exists but isn't in the list-item
   projection yet, a `select` addition, not a migration). This is the sprint's central bet: a
   real, correct, visible page is worth more, sooner, than a page that waits for the "proper"
   final schema. It also means PR1 carries none of a migration's risk — it cannot break
   ingestion, cannot need a backfill, and can be reverted by deleting a route.

2. **Uncovered USHPA criteria render as locked rows on the same page, not a smaller page.** A
   pilot sees the whole P2/P3/P4 ladder from day one — auto-calculated rows with live numbers,
   and instructor-gated or track-analysis-gated rows shown greyed with a one-line reason
   ("needs an instructor's sign-off", "coming soon"). This is deliberately different from
   hiding what isn't built yet: it sets the correct expectation (this is the real ladder, not a
   subset), and it makes every later PR in this sprint a visible unlock on an existing page
   instead of a new page pilots have to discover again.

3. **Solo airtime is approximated as total airtime until `flightType` exists (PR2), and the
   approximation is labeled, not hidden.** P3 and P4 both gate on *solo* airtime specifically,
   and Leaf Log cannot distinguish solo from tandem flights until PR2 ships. Rather than block
   the airtime rows on that field, PR1 ships them computed from total logged airtime with a
   visible caveat ("counts all logged airtime; tandem flights will be excluded once flight type
   is added"). For the overwhelming majority of Leaf Log's actual users — solo recreational
   pilots who have never logged a tandem flight — this number is already exactly correct today;
   it only overstates progress for the minority who fly tandem, and only until PR2 lands.

4. **Instructor-facing surface area (assignment, notes, signoffs) is sequenced strictly after
   the auto-calc page is live and validated.** Every instructor-facing PR in this sprint adds a
   *second* authz axis beyond the owner-scoped one this codebase already leans on everywhere
   (viewer-id-equals-instructor-id, not viewer-id-equals-owner-id) — new surface worth getting
   right once, not worth rushing to hit an arbitrary "complete feature" bar in PR1. Shipping the
   zero-risk page first also means real usage data (which criteria pilots actually check, which
   confuse them) is available before the higher-risk instructor plumbing is designed in detail.

5. **`/ratings` is self-only in v1 (like `/logbook`), not a public profile addition.** A pilot
   sees their own progress; no one else's ratings page exists as a route yet. This keeps every
   read in this sprint trivially owner-scoped (no friends/public visibility matrix to reason
   about for a first version), and defers the genuinely open question of whether rating progress
   should ever be a shareable/public badge to a later sprint.

### Committed v1 scope

- A live `/ratings` page (PR1) showing P2, P3, and P4 progress, computed entirely from existing
  `Flight` data plus the pre-existing `glider` column added to the list projection — no schema
  change, ships first, ships alone if needed.
- `flightType` (solo/tandem/tow) on `Flight`, editable from the flight-edit page, and the
  precise solo-airtime recompute it unlocks (PR2).
- `instructorId` on `Flight`, assignable from the pilot's accepted friends via
  `lib/social/friends.ts` (PR3).
- A private `InstructorNote` per flight, writable only by that flight's assigned instructor,
  readable only by the instructor and the pilot (PR4).
- A `RatingSignoff` record type instructors use to mark a specific witnessed criterion complete
  for a pilot, and the wiring that un-greys the corresponding row on `/ratings` (PR5).
- Honest "locked" placeholders on `/ratings` for every criterion this sprint cannot compute or
  witness yet (ground-school hours, lift-type classification, coastal/inland site tagging),
  so the full P2–P4 ladder is visible from PR1 onward even though not every row is live yet.

### Explicitly out of scope (with reasons)

- **P0/P1 and P5/Master** — already decided out of scope for this feature; P0/P1 have no
  flight-log data to show, P5/Master is a separate ~1,450-point award system.
- **Special Skill Endorsements** (Ridge Soaring, Cross Country, High Altitude Launch, etc.) —
  a natural v2 on top of the same signoff model this sprint builds.
- **Lift-type classification from track shape** (thermal vs. ridge, for P4's lift-specific
  flight-time criteria) — shown as a locked row with a "coming soon" reason; no track-analysis
  work happens in this sprint.
- **Coastal/inland tagging on `Site`** (for P4's "3 of 5 sites inland" sub-criterion) — `Site`
  has no such attribute; shown as a locked row, not built here.
- **Auto-detected candidate precision landings** (measuring actual touchdown point against a
  tagged landing target) — a good future hybrid noted in the research brief, but the signoff
  itself must stay instructor-gated regardless, and the auto-detection half adds real scope this
  sprint doesn't need to hit v1.
- **Ground-school theory hours (P2's 8-hour requirement)** — not flight data at all; would need
  a separate manual log, out of scope.
- **Public/shareable ratings pages or badges** — `/ratings` is self-only in v1 (Anchoring
  decision 5); revisit once the page itself has proven out.
- **Multiple instructors per flight, or per-pilot "primary instructor" defaults** — one
  `instructorId` per flight, assigned per-flight, matching how notes/signoffs are scoped in
  this sprint; a convenience default is a v2 nicety, not a blocker.
- **Editing or revoking a signed-off `RatingSignoff` after the fact** — v1 treats a signoff as an
  append-only witnessed record, matching how a real logbook entry behaves; a correction flow is
  deferred (see Open Questions).

## Use Cases

1. **A pilot with 40 logged flights opens `/ratings` for the first time, the day PR1 ships.**
   They see P2 already fully met (25/25 flights), P3 in progress (40/90 flights, 22/30 flying
   days, 14h/20h airtime — all live numbers), and P4 mostly locked, with the flights/days/airtime/
   sites/gliders rows already showing real progress against the 250/80/75h/5/5 thresholds. Every
   witnessed-skill row across all three levels is greyed with "needs an instructor's sign-off."
   Nothing on the page required an instructor, a migration, or new data entry to exist.

2. **The same pilot uploads a new flight the next weekend.** They revisit `/ratings` and the
   flight-count, flying-day, and airtime numbers have already moved — no separate "recompute my
   ratings" step exists; the page reads through the same `listOwnFlights` path the logbook page
   already uses, so any flight visible in the logbook is already reflected here.

3. **A pilot who has flown a single tandem flight with an instructor** notices, before PR2 ships,
   that their P3 airtime row includes that tandem flight's duration, with a small note explaining
   why. After PR2 ships and they tag that flight's flight type as "tandem" from the edit page, the
   number drops by that flight's duration and the caveat disappears from their solo-airtime rows.

4. **After PR3 ships, a pilot opens a flight's edit page** and sees a new "Instructor" card
   listing their accepted friends; they pick their instructor for that flight. The dropdown (and
   the server action behind it) only ever offers people `areFriends` already confirms are their
   accepted friends — there is no way to assign someone who isn't.

5. **After PR4 ships, the assigned instructor opens that same flight** (following a link the
   pilot shares, or from their own feed) and sees a new "Instructor notes" card the pilot does
   not have write access to. They jot a note about the pilot's approach technique. The pilot can
   read it from the flight page; nobody else — not a mutual friend, not the public — ever can.

6. **After PR5 ships, that instructor witnesses the pilot land three consecutive times within
   10 feet of a moved target during a site visit.** From the flight (or a short instructor-side
   form), they mark the P4 "three consecutive precision landings" criterion complete for that
   pilot. The next time the pilot opens `/ratings`, that row is no longer greyed — it shows
   "Signed off by [instructor] on [date]" instead of "needs an instructor's sign-off."

7. **A pilot with no Leaf Log friends who happen to be instructors** still gets full value out of
   PR1 alone: the auto-calculated majority of P2–P4 is fully live for them, and the clearly
   labeled instructor-gated rows make it obvious what connecting with their instructor on Leaf
   Log would unlock — a built-in incentive to use the friend graph, not a wall blocking the page.

## Architecture

The whole sprint follows two patterns this codebase already has strong precedent for, rather
than introducing new ones: **pure reducer functions over already-fetched, viewer-scoped data**
(the `statsFrom` idiom), and **one server-action-per-editable-field cards on the flight-edit
page** (the `notes` idiom built this session). Nothing in this sprint queries `prisma.flight`
outside the existing viewer-scoped repo functions.

### PR1 — auto-calc engine and page

- `lib/flights/repo.ts`: add `glider: true` to `LIST_SELECT`. This is the one repo change PR1
  needs — `glider` already exists as a column on `Flight`; it simply isn't in the list-item
  projection used by `listOwnFlights`/`statsFrom` today. `FlightListItem` (a `Pick<Flight, ...>`
  derived from `LIST_SELECT`) picks it up automatically.
- New `lib/ratings/stats.ts`, a sibling to `statsFrom` rather than an extension of it (ratings
  math is a different shape and a different consumer than the three-stat logbook bar, and
  keeping them separate means the logbook page's stats bar never has to change to support
  ratings). Exports `ratingStatsFrom(flights: FlightListItem[]): RatingStats`, filtering to
  `status === "ready"` exactly like `statsFrom`, then reducing:
  - `flightCount` — `ready.length` (same as today).
  - `flyingDayCount` — size of the distinct-`flightDate` set, using the ISO date string as the
    dedupe key (skip flights with a null `flightDate`), the direct "distinct flying days"
    analogue of `statsFrom`'s site-key dedupe.
  - `totalAirtimeSeconds` — same reduction as `statsFrom.totalSeconds`.
  - `soloAirtimeSeconds` — **PR1: aliased to `totalAirtimeSeconds`**, with a `soloAirtimeIsExact:
    boolean` flag hardcoded `false` until PR2 adds real `flightType`-based filtering and flips
    it `true`. The page reads this flag to decide whether to render the caveat text.
  - `siteCount` — the exact same fallback-key idiom as `statsFrom`'s `siteKey` (dedupe on
    `takeoffSiteId`, falling back to a name-prefixed key when the site row was later deleted).
    `siteKey` is exported from `lib/flights/repo.ts` instead of duplicated, so both reducers
    share one definition of "what counts as a distinct site."
  - `gliderCount` — a new `gliderKey` helper local to `lib/ratings/stats.ts`: trims and
    lowercases the `glider` string, skips null/empty, dedupes on the normalized string. Flagged
    with a code comment (and a user-facing caveat, see below) that this undercounts when a pilot
    names the same wing inconsistently across uploads, and overcounts nothing (two different
    wings never collide) — the safe direction for a "you've flown at least N" threshold.
- New `lib/ratings/criteria.ts`: a static, data-only description of every P2/P3/P4 criterion —
  no logic beyond reading `RatingStats`. Each entry is `{ id, level, label, kind: "auto" |
  "locked", getValue?, required, unit?, lockedReason? }`. `id` is a stable, append-only string
  (e.g. `"p3_solo_airtime_hours"`) — PR5's `RatingSignoff.criterionKey` will reference these same
  ids, so an id is never renamed once shipped (display `label`s can change freely). PR1 populates
  every auto-calculable row from the USHPA research brief (see table below) and every remaining
  P2–P4 row as `kind: "locked"` with a specific `lockedReason`.
- New `app/ratings/page.tsx`, mirroring `app/logbook/page.tsx`'s exact shape: `requireProfile()`
  guard, `listOwnFlights(profile.id)`, `ratingStatsFrom(flights)`, a moderately narrow centered
  `max-w-*` column, a plain `<h1>` (not `SectionHeading` — that's reserved for nested pages per
  existing convention), and a per-level progress summary directly under the heading in place of
  the flat three-stat bar.
- New presentational components under `components/ratings/`: a level card (P2/P3/P4) and a
  criterion row that renders either a live progress bar + count (auto) or a greyed row with a
  lock icon and its `lockedReason` as a tooltip/subtext (locked). Same visual language as
  `StatsBar` (`font-condensed`, `tabular-nums`, `AccentBar`).
- `components/app-header.tsx`: one new nav `<Link href="/ratings">`.
- `lib/whats-new.ts`: new entry.

**What PR1 can and cannot show, precisely** (re-derived against the USHPA brief, not assumed):

| Level | Criterion | PR1 status |
|---|---|---|
| P2 | ≥25 logged flights | **auto** |
| P3 | ≥30 flying days | **auto** |
| P3 | ≥90 total flights | **auto** |
| P3 | ≥20 hours solo airtime | **auto, approximated** as total airtime (caveat shown) until PR2 |
| P4 | 250 flights | **auto** |
| P4 | ≥80 flying days | **auto** |
| P4 | ≥75 hours total airtime | **auto** (this threshold is on *total* airtime per the brief, not solo-restricted, so no PR2 dependency) |
| P4 | ≥5 distinct sites | **auto** (existing `Site` linkage + fallback name key) |
| P4 | ≥5 distinct gliders | **auto** (needs `glider` in `LIST_SELECT` — a select change, not a migration; data-quality caveat shown) |
| P4 | tandem sub-limit: ≤25 of the 75h tandem, ≤10 of 25 thermal h tandem | **locked** — needs `flightType` (PR2) |
| P4 | 3× 1h thermal flights from ≥2 sites, 1× 1h ridge flight, without sustaining the other lift type | **locked** — needs track-shape lift classification (future stretch, not this sprint) |
| P4 | ≥3 of the 5 sites inland | **locked** — needs a coastal/inland `Site` attribute (not this sprint) |
| P2/P3/P4 | every "Demonstrated Skills and Knowledge" task, incl. precision landings | **locked** — needs instructor sign-off (PR3–PR5) |
| P2 | 8 hours ground-school theory | **locked** — not flight data at all, needs separate manual logging (not this sprint) |

### PR2 — flight type

- `prisma/schema.prisma`: `Flight.flightType String?` (`solo | tandem | tow`), no default —
  existing rows read as `null`, which the ratings engine treats as solo (documented, matches the
  fact that Leaf Log's ingestion has never distinguished tandem flights, so a null historically
  *means* "logged the way solo flights always have been").
- Migration: `<timestamp>_add_flight_type`, following the existing naming convention.
- `lib/flights/repo.ts`: add `flightType: true` to `LIST_SELECT`.
- `app/flights/[id]/edit/flight-type-editor.tsx` + an `updateFlightType` action in the edit
  page's `actions.ts`, following the exact `updateNotes` shape: `(flightId, prevState,
  formData) => Promise<FlightTypeState>`, an owner-scoped `updateMany({ where: { id, ownerId
  } })`, zero-rows-matched returns an error, success revalidates `/flights/[id]` and
  `/flights/[id]/edit`. Rendered as its own card on the edit page, radio buttons instead of a
  textarea.
- `lib/ratings/stats.ts`: `soloAirtimeSeconds` now actually filters `flightType !== "tandem"`
  (treating `null`/`"solo"`/`"tow"` as solo-equivalent for airtime purposes, matching how USHPA's
  own solo-airtime criterion is about "not flying tandem," not about tow use); `soloAirtimeIsExact`
  flips to `true`, removing the caveat text from the P3/P4 airtime rows.
- `lib/ratings/criteria.ts`: the P4 tandem sub-limit rows flip from `locked` to `auto`.

### PR3 — instructor assignment

- `prisma/schema.prisma`: `Flight.instructorId String?` + `instructor Profile? @relation(...,
  onDelete: SetNull)`.
- Migration: `<timestamp>_add_flight_instructor`.
- `app/flights/[id]/edit/instructor-editor.tsx` + `updateInstructor` action: the dropdown is
  populated from `listFriends(viewer.id)`, but — because a client can submit any string as
  `instructorId` regardless of what the dropdown offered — the action itself re-verifies
  `areFriends(viewerId, instructorId)` server-side before writing, in addition to the owner-scoped
  `updateMany`. Assigning nobody (clearing the field) is always allowed.
- No new read path yet: `getFlightForViewer` already returns the full `Flight` row, so
  `instructorId` is present with no repo change; nothing outside the edit page reads it yet.

### PR4 — instructor notes

- `prisma/schema.prisma`: new `InstructorNote` model — one per flight (see Data model).
- Migration: `<timestamp>_add_instructor_note`.
- A new, narrow read helper, **not** a path through `getFlightForViewer`:
  `getInstructorNoteForViewer(flightId, viewerId)` in `lib/flights/repo.ts`, returning the note
  only when `viewerId` equals the flight's current `ownerId` *or* current `instructorId` — this
  is the "analogous but different guard" the research brief calls out: instructor-facing checks
  compare against `instructorId`, not `ownerId`, and this is the first place in the codebase that
  does so. Never merged into the generic friends/public visibility resolution — a friend or the
  public seeing a flight must never see this note regardless of the flight's own `visibility`.
- A new card on the flight page (not just the edit page, since the instructor is a different
  person than the owner and has no reason to visit `/flights/[id]/edit`) that renders only when
  `getInstructorNoteForViewer` returns non-null, with a write form shown only when
  `viewer.id === flight.instructorId`.
- `updateInstructorNote` action: scoped by `updateMany({ where: { flightId, instructorId:
  viewerId } })` — the write-side twin of the new read guard.

### PR5 — rating signoffs

- `prisma/schema.prisma`: new `RatingSignoff` model (see Data model).
- Migration: `<timestamp>_add_rating_signoff`.
- A signoff-entry UI reachable from a flight the viewer is the assigned instructor on — a small
  form picking one of that pilot's currently-locked-and-instructor-gated criteria (sourced from
  `lib/ratings/criteria.ts`, filtered to `kind: "instructor"`) and confirming it witnessed. Kept
  scoped to a specific flight for v1, matching how `instructorId` itself is per-flight — a
  detached "sign off a skill not tied to any one flight" flow (relevant for things like
  ground-handling that don't happen mid-flight) is left for v2.
- `lib/ratings/criteria.ts`: the instructor-gated rows gain a `kind: "instructor"` (distinct from
  `"auto"` and `"locked"`) whose displayed value comes from a `RatingSignoff` count query, scoped
  to `pilotId === viewer.id` — the pilot's own `/ratings` page is the only place these are read,
  keeping this sprint's authz surface as small as it can be while still being real.
- `/ratings` page: instructor-gated rows now render "Signed off by X on Y" once a matching
  `RatingSignoff` exists, instead of the generic "needs an instructor's sign-off" placeholder.

### Data model

```prisma
model Flight {
  // ...all existing fields unchanged...

  // PR2 — solo/tandem/tow; null = solo-equivalent (matches all pre-existing rows)
  flightType   String?

  // PR3 — assignable only from the owner's accepted friends (lib/social/friends.ts),
  // re-verified server-side on every write, not just filtered in the picker UI.
  instructorId String?
  instructor   Profile? @relation("FlightInstructor", fields: [instructorId], references: [id], onDelete: SetNull)

  // PR4 — one private note per flight, owned by whoever is instructorId at write time.
  instructorNote InstructorNote?

  // PR5 — zero or more witnessed criteria tied to this flight.
  ratingSignoffs RatingSignoff[]
}

// PR4 — visible only to the flight's owner and its current instructor; never resolved
// through the general friends/public flight-visibility path.
model InstructorNote {
  id           String   @id @default(cuid())
  flightId     String   @unique
  flight       Flight   @relation(fields: [flightId], references: [id], onDelete: Cascade)
  instructorId String
  instructor   Profile  @relation(fields: [instructorId], references: [id], onDelete: Cascade)
  note         String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

// PR5 — one row per witnessed occurrence. criterionKey references a stable, append-only
// id in lib/ratings/criteria.ts — renaming a criterion's id would orphan historical
// signoffs, so ids are treated as permanent once shipped (display labels are free to change).
model RatingSignoff {
  id           String    @id @default(cuid())
  pilotId      String
  pilot        Profile   @relation("RatingSignoffsForPilot", fields: [pilotId], references: [id], onDelete: Cascade)
  instructorId String
  instructor   Profile   @relation("RatingSignoffsByInstructor", fields: [instructorId], references: [id], onDelete: Cascade)
  level        String    // "P2" | "P3" | "P4"
  criterionKey String    // matches an id in lib/ratings/criteria.ts
  flightId     String?
  flight       Flight?   @relation(fields: [flightId], references: [id], onDelete: SetNull)
  note         String?
  signedAt     DateTime  @default(now())

  @@index([pilotId, criterionKey])
}
```

Migration naming, matching the existing convention (`20260829185017_add_flight_notes`):
`<timestamp>_add_flight_type` (PR2), `<timestamp>_add_flight_instructor` (PR3),
`<timestamp>_add_instructor_note` (PR4), `<timestamp>_add_rating_signoff` (PR5).

### Test strategy

- `lib/ratings/stats.ts` gets a **DB-backed integration test**, following the existing
  `statsFrom` convention exactly (a real Prisma client, real seeded/ingested flights, asserting
  an exact `RatingStats` object) rather than a mocked unit test — this function is
  privacy/aggregation-sensitive (it must only ever be handed data that already passed through a
  viewer-scoped read) and the codebase's existing precedent for that class of function is a real
  database, not mocks. Cases: flying-day dedup across two flights on the same calendar date;
  glider-count dedup across case/whitespace variants of the same string; the deleted-site
  fallback-key path (borrowed straight from the existing `statsFrom` test); the pre-/post-PR2
  solo-airtime behavior (a tandem flight included in the total before `flightType` exists,
  excluded after).
- `lib/ratings/criteria.ts` evaluation gets plain unit tests (pure functions over a fixed
  `RatingStats` fixture, no DB needed) — one per threshold boundary (24 vs. 25 flights, etc.).
- PR4 and PR5 each add an integration test for their new guard: `getInstructorNoteForViewer`
  returning null for a friend/public viewer and non-null only for the owner or the current
  `instructorId`; the `RatingSignoff` count query returning nothing for a viewer who isn't the
  pilot the signoff belongs to.
- PR3's `updateInstructor` action gets a test asserting the server-side `areFriends` re-check
  actually rejects a non-friend id, not just that the picker UI doesn't offer one.
- No new Playwright e2e scenario is required to keep the existing happy-path green, but PR1 adds
  one new e2e assertion that `/ratings` renders for a signed-in pilot without erroring, since it's
  a new top-level route.

## Implementation

### PR1 — Auto-calc ratings page (zero schema changes) — ~35%

Ships `/ratings` as a real, live page computing P2/P3/P4 progress entirely from data Leaf Log
already has, with every currently-uncoverable criterion shown as an honest, labeled locked row.
This is the whole value of the sprint's angle: after this PR alone, pilots have a working,
motivating ratings page, and every subsequent PR is purely additive to it.

### PR2 — Flight type + precise solo airtime — ~15%

Adds `flightType` to `Flight` and its edit-page card. Un-approximates the P3/P4 solo-airtime rows
(removes the caveat) and unlocks the P4 tandem-hour sub-limit row. First schema migration of the
sprint; small and isolated because PR1 already proved the page shape it plugs into.

### PR3 — Instructor assignment — ~20%

Adds `instructorId` to `Flight`, constrained to accepted friends both in the picker UI and
server-side on write. No visible change to `/ratings` yet — this PR is pure plumbing that PR4 and
PR5 depend on — but it's independently shippable and reviewable on its own, and pilots can start
assigning instructors to past flights immediately, ahead of notes or signoffs existing.

### PR4 — Instructor notes — ~15%

Adds the `InstructorNote` model, its instructor-only write guard and owner-or-instructor read
guard, and the note card on the flight page. First feature in the sprint with a genuinely new
authz axis (instructor-id-scoped, not owner-id-scoped) — deliberately built after PR1–PR3 are
live and stable rather than in the same PR as the schema-adjacent instructor assignment work.

### PR5 — Rating signoffs — ~15%

Adds the `RatingSignoff` model and the instructor-side "mark this witnessed" flow, and wires it
into `/ratings` so instructor-gated rows stop reading "needs an instructor's sign-off" and start
showing a real signoff once one exists. This is the PR that finally makes the greyed rows from
PR1 go live — closing the loop the whole sprint has been building toward, six weeks (across five
independently-shippable PRs) after pilots got real value from PR1.

## Files Summary

**PR1**
- `lib/flights/repo.ts` — add `glider` to `LIST_SELECT`; export `siteKey` for reuse.
- `lib/ratings/stats.ts` (new) — `ratingStatsFrom`, `gliderKey`.
- `lib/ratings/stats.test.ts` (new, DB-backed integration test).
- `lib/ratings/criteria.ts` (new) — static P2/P3/P4 criterion definitions.
- `lib/ratings/criteria.test.ts` (new, unit tests).
- `app/ratings/page.tsx` (new).
- `components/ratings/rating-level-card.tsx` (new).
- `components/ratings/criterion-row.tsx` (new).
- `components/app-header.tsx` — add `/ratings` nav link.
- `lib/whats-new.ts` — new entry.
- `e2e/` — one new smoke assertion for `/ratings`.

**PR2**
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_flight_type/` (new).
- `lib/flights/repo.ts` — add `flightType` to `LIST_SELECT`.
- `app/flights/[id]/edit/flight-type-editor.tsx` (new), `app/flights/[id]/edit/actions.ts` —
  `updateFlightType`.
- `app/flights/[id]/edit/page.tsx` — new "Flight type" card.
- `lib/ratings/stats.ts`, `lib/ratings/criteria.ts` — exact solo airtime, unlock tandem sub-limit.

**PR3**
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_flight_instructor/` (new).
- `app/flights/[id]/edit/instructor-editor.tsx` (new), `app/flights/[id]/edit/actions.ts` —
  `updateInstructor`.
- `app/flights/[id]/edit/page.tsx` — new "Instructor" card.
- `app/flights/[id]/edit/actions.test.ts` (new) — friend-check rejection test.

**PR4**
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_instructor_note/` (new).
- `lib/flights/repo.ts` — `getInstructorNoteForViewer`.
- `components/flight/instructor-note-card.tsx` (new), wired into the flight page.
- `app/flights/[id]/instructor-note-actions.ts` (new) — `updateInstructorNote`.
- integration test for the new read/write guard.

**PR5**
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_rating_signoff/` (new).
- `lib/ratings/criteria.ts` — `kind: "instructor"` rows, signoff-count lookups.
- `components/flight/signoff-form.tsx` (new).
- `app/ratings/page.tsx` — render real signoffs on instructor-gated rows.
- integration test for signoff-count read scoping.

## Definition of Done

- [ ] `/ratings` is live and reachable from nav, showing P2/P3/P4 progress for the signed-in
      pilot, with every auto-calculable criterion from the table above live in PR1.
- [ ] Every P2–P4 criterion not covered by PR1 renders as a clearly labeled locked row with a
      specific reason, never silently omitted.
- [ ] `flightType`, `instructorId`, `InstructorNote`, and `RatingSignoff` all ship with their own
      migration and are each independently mergeable per the PR breakdown above.
- [ ] Instructor assignment only ever accepts an accepted friend, re-verified server-side.
- [ ] `InstructorNote` is never readable by anyone but the flight's owner or current instructor,
      regardless of the flight's own `visibility`.
- [ ] `RatingSignoff` counts on `/ratings` are only ever computed for the signed-in pilot's own
      id.
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm e2e` all pass on every PR.
- [ ] A `/whats-new` entry accompanies PR1 (the user-visible launch) and PR2/PR3/PR5 (each adds
      pilot-visible capability); PR4's instructor-note card is worth a short entry too, since
      instructors are pilots too and will notice a new card on their friends' flights.

## Risks

- **Total-airtime-as-solo-proxy overstates P3/P4 progress for any pilot who has already logged a
  tandem flight, until PR2 ships.** Mitigation: the caveat is shown inline wherever the number
  appears, not just in a help doc, and PR2 is second in the sequence specifically to keep this
  window short.
- **Glider-string diversity undercounts pilots who typed their wing's name inconsistently across
  uploads** (e.g. "Ozone Rush 5" vs. "Rush 5"). Mitigation: undercounting is the safe failure
  direction for a "you've flown at least N different canopies" threshold (never falsely claims
  the criterion met); a caveat is shown on that row; glider-name normalization is a reasonable
  future backlog item, not blocking this sprint.
- **Locked/greyed rows could read as "broken" or naggy rather than motivating.** Mitigation:
  specific, plain-language reasons per row ("needs an instructor's sign-off" vs. a bare padlock),
  and a design pass on the locked-row treatment before PR1 ships, not after.
- **Mis-assigning the wrong friend as instructor has real downstream consequences once notes and
  signoffs exist (PR4/PR5 read/write access follows `instructorId`).** Mitigation: reassignment
  is always available from the edit page; an existing `InstructorNote`/`RatingSignoff` stays tied
  to whoever was the instructor at the time it was written, not to whoever holds `instructorId`
  later, so an accidental reassignment can't silently reroute access to past instructor content.
- **`RatingSignoff.criterionKey` is a loose string coupling to `lib/ratings/criteria.ts`, not a
  DB foreign key.** A future rename of a criterion's id (not its label) would orphan historical
  signoffs. Mitigation: this doc and a code comment on `criteria.ts` both state ids are
  append-only/permanent once shipped.
- **Sequencing pressure to fold `flightType` or `instructorId` into PR1 "since we're already in
  the file."** Mitigation: the anchoring decisions above are the explicit answer to that
  pressure — PR1's zero-schema-change property is the point, not an accident of scoping.

## Security (privacy / authz)

This app enforces privacy entirely at the application layer (no DB RLS) — every read this sprint
adds follows that existing discipline explicitly, not by inheriting it implicitly:

- **`/ratings` reads only through `listOwnFlights(profile.id)`**, already owner-scoped and
  already the same call `/logbook` makes. There is no cross-pilot read anywhere in PR1 — a pilot
  can only ever compute and see their own ratings progress.
- **`flightType` (PR2) is written through the same owner-matching `updateMany` where-clause as
  every other edit-page field** — no new authz shape.
- **`instructorId` (PR3) writes require both** (a) the flight-owner-matching `updateMany`
  where-clause and (b) a server-side `areFriends(viewerId, instructorId)` check — the friend-list
  picker UI is not treated as sufficient enforcement, since a submitted `instructorId` is
  attacker-controlled input regardless of what the UI offered.
- **`InstructorNote` (PR4) is the sprint's one genuinely new read/write axis**: reads and writes
  both check `viewerId === flight.instructorId` (writes) or `viewerId === flight.ownerId ||
  viewerId === flight.instructorId` (reads) — explicitly *not* resolved through the general
  friends/public flight-visibility predicate in `lib/flights/repo.ts`. A friend or the public
  seeing a `visibility: "public"` flight must never see its instructor note; this is enforced by
  routing the note through its own dedicated helper rather than attaching it to the general
  `getFlightForViewer` payload.
- **`RatingSignoff` (PR5) reads are scoped to `pilotId === viewer.id`** on `/ratings`; writes are
  scoped to `instructorId === viewer.id` and additionally require that viewer currently be the
  `instructorId` on the flight the signoff cites (when one is cited) — an instructor can't sign
  off a criterion for a pilot on a flight they were never assigned to.
- **No new public or friends-visible surface is added anywhere in this sprint.** Ratings,
  instructor notes, and signoffs are all self-or-instructor-only in v1; making any of them
  visible more broadly (a public ratings badge, a friends-visible note) is explicitly deferred
  (see Explicitly out of scope).

## Dependencies

- **Depends on** `lib/social/friends.ts` (`listFriends`, `areFriends`) for PR3's instructor
  picker and PR3's server-side re-check.
- **Depends on** `lib/flights/repo.ts`'s existing `LIST_SELECT`/`FlightListItem`/`statsFrom`
  pattern (PR1 extends it with a sibling reducer rather than replacing it) and
  `getFlightForViewer` (PR3's `instructorId` and PR2's `flightType` need no repo change to be
  readable on the flight page, since that function already returns the full row).
  Depends on the existing `Site` model for site-diversity counting and the pre-existing
  free-text `Flight.glider` column for glider-diversity counting.
- **Blocks/unlocks** (future v2 work, not this sprint): P1/P5 (Master) ladder support once P2–P4
  is validated in production; Special Skill Endorsements, which reuse the same `RatingSignoff`
  shape with a different `level`/`criterionKey` namespace; a future public-facing ratings badge
  on a pilot's profile page; lift-type track classification and coastal/inland site tagging,
  each of which — once built — only needs a `criteria.ts` entry flipped from `locked` to `auto`,
  no ratings-engine rework.

## Open Questions

- **Should `/ratings` ever become visible on a pilot's public profile** (a badge, a shared
  summary), or stay a private, self-only page indefinitely? Not resolved here — Anchoring
  decision 5 deliberately keeps v1 self-only and defers this rather than guessing at an answer
  that would shape the read-authz design prematurely.
- **Should a `RatingSignoff` ever be correctable** (an instructor fixes a mis-recorded date, or
  retracts one entered in error), or does it stay append-only like a logbook entry forever? Left
  for PR5's detailed design — it doesn't affect the shape of PR1–PR4 at all, so resolving it now
  would be speculative.
- **How exactly do multi-occurrence criteria get modeled** — e.g. P4's "three *consecutive*
  precision landings within 10', target moved between each" — as one `RatingSignoff` row
  representing the whole witnessed set, or three rows the UI must present as a consecutive
  group? Left to PR5 implementation; nothing before it depends on the answer.
