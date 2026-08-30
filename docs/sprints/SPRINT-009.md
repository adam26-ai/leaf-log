# SPRINT-009 — USHPA Ratings Progress & Instructor Sign-offs

## Overview

Leaf Log wants to show a pilot their progress toward USHPA's P2 (Novice), P3 (Intermediate),
and P4 (Advanced) paragliding ratings. Most of what P2–P4 require is already sitting in the
`Flight` table today — flight count, flying days, total airtime, site diversity, and (once
projected) glider diversity all reduce cleanly from data Leaf Log already has, using the exact
pattern `lib/flights/repo.ts::statsFrom` already proves out for the logbook's three-stat bar. A
smaller, genuinely different-shaped slice of USHPA's requirements — every "Demonstrated Skills
and Knowledge" task, precision landings chief among them — cannot be verified from a GPS track
at all; USHPA's own rules require a human witness, which means Leaf Log needs, for the first
time, a write path where a person *other than the flight's owner* (an instructor, assigned from
the pilot's accepted friends) can leave private notes and mark specific criteria witnessed on
somebody else's flight.

Two earlier drafts of this sprint took deliberately opposite stances on how to sequence those
two pieces of work, and each surfaced a real, concrete problem with the other:

- The **ship-first** draft shipped a zero-schema `/ratings` page in PR1 and built the
  instructor/signoff model incrementally behind it — correctly observing that the auto-calc
  majority of the page has no dependency on the instructor work at all, and that a five-PR sprint
  whose first mergeable milestone is invisible to every user is a bad match for how this repo
  actually ships (short, live-verified rounds, not a big upfront spec). But when it got to the
  instructor-notes schema (its PR4), it got the authorization model wrong in a way that matters:
  `InstructorNote` was `flightId @unique` with a read guard keyed to the flight's *current*
  `instructorId`, which means reassigning a flight from one instructor to another hands the new
  instructor read access to the old instructor's private note about the pilot, while the actual
  author loses access to their own note. That's a real bug in committed v1 scope, not a
  hypothetical of moving fast.
- The **model-first** draft got that exact authorization question right — an immutable
  `instructorId`/`signedByProfileId` author column on every note and signoff, frozen at write
  time, completely independent of the mutable `Flight.instructorId` that gates *future* writes —
  and built it with disciplined, individually-tested authorization predicates. But it did so by
  putting the entire instructor/signoff schema and authz surface into one 45%-of-sprint PR with
  zero user-visible output, gating the auto-calc page (70% of the visible ladder, with zero
  actual dependency on any of that schema) behind it as the sprint's *last* PR.

This sprint keeps the part each draft got right and drops the part each got wrong: **ship the
zero-schema auto-calc page first, exactly as ship-first sequenced it, but build the
instructor/signoff schema with model-first's authorization discipline once we get there** — and
build that discipline as small predicates landing alongside each feature slice rather than as one
large, non-demoable PR. This is not splitting the difference; it's resolving two independent
questions (sequencing, and schema correctness) with the answer each critique actually earned.

### Anchoring decisions

1. **PR1 ships a zero-schema-change, fully auto-calculated `/ratings` page, decoupled entirely
   from the instructor/signoff model.** Every P2/P3/P4 auto-calculable criterion — flight count,
   flying days, total airtime, site diversity, glider diversity — reduces from columns that exist
   in production today, via the same `statsFrom` idiom the logbook page already uses, with zero
   dependency on `flightType`, `instructorId`, `InstructorNote`, or `RatingSignoff` existing.
   Tellingly, the one place the ship-first draft's schema design actually went wrong was *inside*
   the instructor-model work (its PR4), not in this zero-schema PR1 — proving that shipping the
   auto-calc slice first requires no extra rigor, only the discipline of not touching `Flight`.
   Gating this sprint's biggest, safest, most immediately useful increment behind its highest-risk
   authorization design (as the model-first sequencing did) is not required by the actual data
   dependencies, and it doesn't match this repo's own track record of shipping in short,
   live-verified rounds rather than one big upfront spec. PR1 ships alone if the sprint stops
   here, and it is complete and demoable on its own.

2. **The instructor/signoff schema adopts the model-first draft's authorship model, not
   ship-first's, because ship-first's version has a live bug.** `InstructorNote.instructorId` and
   `RatingSignoff.signedByProfileId` are immutable author columns, captured once at write time and
   never re-derived from the current, mutable `Flight.instructorId`. Concretely: if a pilot
   reassigns a flight from instructor Alex to instructor Sam, Sam never gains read access to
   Alex's note, and Alex — the actual author — never loses it, because the read guard checks the
   note's own author column, not who currently holds `Flight.instructorId`. This is adopted as a
   schema decision independent of sequencing: getting this right doesn't require model-first's
   PR ordering, only its data model.

3. **Instructor/signoff authorization is still built as small, named, independently-tested
   predicate functions in `lib/ratings/authz.ts`** (`canAssignInstructor`,
   `canWriteInstructorNote`, `canReadInstructorNote`, `canWriteSignoff`, `canReadSignoff`) — but
   each lands in the PR that actually needs it (PR3, PR4, PR5 respectively), not bundled into one
   dedicated no-UI PR up front. The discipline of "never trust a client-supplied assignment value,
   always re-check the live row" is what actually prevents the class of bug in decision 2, and it
   costs nothing to keep while still shipping incrementally — a mid-sprint stop after any PR still
   leaves a working, visibly-improved, safely-scoped product.

4. **`lib/ratings/criteria.ts` ships with a three-way `kind: "auto" | "instructor" | "future"`
   from PR1**, not a two-way `"auto" | "locked"` that has to be manually re-sorted later.
   Ship-first's PR5 had to go back into a page-old, generically-`"locked"` catalog and pick out,
   informally, which locked rows meant "instructor-witnessable, arriving this sprint" (precision
   landings, ground handling, etc.) versus "genuinely out of scope, no PR unlocks this" (lift-type
   classification, coastal/inland site tagging, ground-school hours). Typing this correctly from
   PR1 costs nothing — it's a data-only file with no consumers yet — and removes a reclassification
   step right as `RatingSignoff.criterionKey` values start accumulating against specific ids
   (ids are treated as permanent once shipped; only `future` rows are safe to leave unassigned to
   a PR).

5. **Instructor assignment stays asymmetric in v1 — a pilot can nominate any accepted friend as
   `instructorId` with no acceptance step from that friend — and this is now an explicit, named
   decision, not an implied side effect of "the picker is fed by `listFriends`."** This mirrors an
   existing pattern already in this codebase: a friend's `visibility: friends` flight becomes
   visible the moment two profiles are friends, with no separate consent layer. But nobody had
   actually signed off on "a friend can be made someone's flight instructor of record without
   being told" as intentional product behavior until now. It's called out here, and flagged to
   revisit with real usage once PR3 ships (see Open Questions) — the auto-calc page from PR1
   having already been live for two PRs' worth of iteration gives real signal to weigh that
   revisit against.

### Committed v1 scope

- A live `/ratings` page (PR1) showing P2, P3, and P4 progress, computed entirely from existing
  `Flight`/`Site` data plus the pre-existing `glider` column added to the list projection — no
  schema change, ships first, ships alone if needed.
- A three-way `lib/ratings/criteria.ts` catalog (`auto` | `instructor` | `future`) covering every
  P2/P3/P4 criterion in the USHPA research brief, typed correctly from PR1 onward.
- `Flight.flightType` (solo/tandem/tow), editable from the flight-edit page, and the exact
  solo-airtime recompute it unlocks (PR2).
- `Flight.instructorId`, assignable from the pilot's accepted friends via
  `lib/social/friends.ts`, owner-write-gated and re-verified against the live friend graph at
  write time — asymmetric (no instructor acceptance step) per anchoring decision 5 (PR3).
- An `InstructorNote` model with an immutable author column, writable only while that author is
  the flight's *current* instructor, readable by the flight's owner and the note's own author
  forever — never re-derived from `Flight.instructorId` at read time (PR4).
- A `RatingSignoff` model with an immutable `signedByProfileId`, writable only by the flight's
  current instructor, append-only in v1 (no revocation/correction flow — see Open Questions), and
  the `/ratings` wiring that turns `kind: "instructor"` rows from "needs a sign-off" into live,
  signed progress (PR5).
- Honest, correctly-typed placeholders on `/ratings` for every criterion this sprint cannot
  compute or witness yet (`kind: "future"`: ground-school hours, lift-type classification,
  coastal/inland site tagging), visible from PR1 onward.

### Explicitly out of scope (with reasons)

- **P0/P1 and P5/Master** — already decided out of scope for this feature; P0/P1 have no
  flight-log data to show, P5/Master is a separate ~1,450-point award system.
- **Special Skill Endorsements** — a natural v2 on top of the same `RatingSignoff` shape this
  sprint builds (different `level`/`criterionKey` namespace).
- **Lift-type classification from track shape** and **coastal/inland `Site` tagging** — tagged
  `kind: "future"` in the v1 catalog; no track-analysis or `Site` schema work happens this sprint.
- **Auto-detected candidate precision landings** (measuring touchdown against a tagged landing
  target) — a good future hybrid, but the signoff itself stays instructor-gated regardless, and
  the auto-detection half is real added scope this sprint doesn't need.
- **Ground-school theory hours (P2's 8-hour requirement)** — not flight data at all; tagged
  `kind: "future"`; would need a separate manual log.
- **A two-way instructor-acceptance flow** — deferred per anchoring decision 5; revisit if v1's
  asymmetric nomination proves to feel invasive once PR3 ships to real users.
- **`RatingSignoff` revocation or correction** — v1 is append-only, matching how a real logbook
  entry behaves. Adding a `revokedAt`/`revokedByProfileId` pair later is a cheap, additive
  migration; carrying that schema now with no observed correction need yet is not worth it (see
  Open Questions).
- **Cross-flight instructor read access** — a currently-assigned instructor reads notes/signoffs
  on *that* flight only, never a pilot's full cross-flight history. See Open Questions.
- **Public/shareable ratings pages or badges** — `/ratings` is self-only in v1.
- **Multiple instructors per flight, or a per-pilot "primary instructor" default** — one
  `instructorId` per flight, assigned per-flight; a convenience default is a v2 nicety.

## Use Cases

1. **A pilot with 40 logged flights opens `/ratings` the day PR1 ships.** They see P2 fully met
   (25/25 flights), P3 in progress with live numbers (40/90 flights, 22/30 flying days, 14h/20h
   airtime), and P4 mostly locked with real progress on flights/days/airtime/sites/gliders.
   Every `kind: "instructor"` row is greyed with "needs an instructor's sign-off"; every
   `kind: "future"` row is greyed with its own specific reason. Nothing required an instructor,
   a migration, or new data entry.

2. **The same pilot uploads a new flight the next weekend.** The flight-count, flying-day, and
   airtime numbers on `/ratings` have already moved when they revisit — the page reads through
   the same `listOwnFlights` path the logbook page already uses, no separate recompute step.

3. **A pilot who has flown one tandem flight** sees, before PR2 ships, their P3 airtime row
   include that flight's duration with a small caveat explaining why. After PR2 ships and they
   tag that flight's type as "tandem" from the edit page, the number drops by that flight's
   duration and the caveat disappears.

4. **After PR3 ships, a pilot opens a flight's edit page** and sees a new "Instructor" card
   listing their accepted friends. They pick Alex. The dropdown, and the server action behind it,
   only ever accept someone `areFriends` currently confirms as an accepted friend — re-checked
   server-side, not just filtered in the picker UI.

5. **After PR4 ships, Alex opens that flight** (a different guard than the edit page's
   owner-only check: `viewer.id === flight.instructorId`) and leaves a note: "Good symmetric
   brake use on final, watch your flare timing." The pilot reads it on their flight page. A
   friend the pilot shared the flight with cannot see it, regardless of the flight's own
   `visibility` — the note is never resolved through the general friends/public visibility path.

6. **The pilot later reassigns that flight's instructor from Alex to Sam.** Alex's earlier note
   is untouched: the pilot can still read it, and so can Alex — its own author — but Sam, now
   `flight.instructorId`, does **not** gain access to it, and Alex can no longer edit it (Alex is
   no longer the flight's *current* instructor, and editing requires both authorship and current
   assignment).

7. **After PR5 ships, Alex — while still the assigned instructor — witnesses the pilot land three
   consecutive times within 10 feet of a moved target** and marks the P4 "three consecutive
   precision landings" criterion complete for that flight. The signoff is permanently attributed
   to Alex (`signedByProfileId`) even if the flight's instructor is reassigned later. The next
   time the pilot opens `/ratings`, that row shows "Signed off by Alex on [date]" instead of
   "needs an instructor's sign-off."

8. **The pilot and Alex later stop being friends.** Nothing about Alex's past notes or signoffs
   disappears or gets reattributed — they were never keyed to the friendship, only to the
   assignment that existed when they were written. Alex simply can't be re-assigned as anyone's
   instructor on a new flight unless they re-friend.

9. **A pilot with no instructor-friends on Leaf Log** still gets full value from PR1 alone: the
   auto-calculated majority of P2–P4 is fully live, and the clearly-labeled instructor-gated rows
   make obvious what connecting with their instructor would unlock.

## Architecture

The sprint follows two patterns this codebase already has strong precedent for:
**pure reducer functions over already-fetched, viewer-scoped data** (the `statsFrom` idiom) for
everything auto-calculable, and **owner/instructor-matching where-clauses plus small, named,
independently-tested predicate functions** for everything that needs a second write actor. Nothing
in this sprint queries `prisma.flight` outside the existing viewer-scoped repo functions, and
nothing in the instructor/signoff surface trusts a client-supplied identity — every predicate
re-reads the relevant row's live `instructorId`/authorship column at the instant of the check.

### Auto-calc engine (PR1)

`lib/ratings/stats.ts` is a sibling to `statsFrom`, not an extension of it — ratings math is a
different shape and a different consumer, and keeping them separate means the logbook page's
stats bar never has to change to support ratings. `ratingStatsFrom(flights: FlightListItem[]):
RatingStats` filters to `status === "ready"` exactly like `statsFrom`, then reduces:
`flightCount`; `flyingDayCount` (dedupe on the ISO `flightDate` string, skipping nulls — the
direct "distinct flying days" analogue of `statsFrom`'s site-key dedupe); `totalAirtimeSeconds`
(same reduction as `statsFrom.totalSeconds`); `soloAirtimeSeconds` (PR1: aliased to
`totalAirtimeSeconds`, with a `soloAirtimeIsExact: false` flag until PR2); `siteCount` (the exact
same fallback-key idiom as `statsFrom`'s `siteKey`, exported from `lib/flights/repo.ts` so both
reducers share one definition of "distinct site"); `gliderCount` (a new `gliderKey` helper:
trim + lowercase + dedupe, undercounts inconsistent naming but never overcounts — the safe
direction for a "you've flown at least N" threshold).

### Criteria catalog

`lib/ratings/criteria.ts` is a static, data-only description of every P2/P3/P4 criterion from the
research brief — no logic beyond reading `RatingStats` or a signoff lookup. Each entry is
`{ id, level, label, kind: "auto" | "instructor" | "future", getValue?, required, unit?,
reason? }`. `id` is a stable, append-only string (e.g. `"p3_solo_airtime_hours"`) —
`RatingSignoff.criterionKey` references these ids, so an id is never renamed once shipped (labels
may change freely). Re-derived against the USHPA brief:

| Level | Criterion | v1 `kind` |
|---|---|---|
| P2 | ≥25 logged flights | `auto` |
| P3 | ≥30 flying days | `auto` |
| P3 | ≥90 total flights | `auto` |
| P3 | ≥20 hours solo airtime | `auto` (approximated as total airtime until PR2) |
| P4 | 250 flights | `auto` |
| P4 | ≥80 flying days | `auto` |
| P4 | ≥75 hours total airtime | `auto` (on *total* airtime per the brief, no PR2 dependency) |
| P4 | ≥5 distinct sites | `auto` |
| P4 | ≥5 distinct gliders | `auto` (data-quality caveat shown) |
| P4 | tandem sub-limits (≤25 of 75h, ≤10 of 25 thermal h) | `future` until PR2 ships `flightType`, then flips to `auto` |
| P4 | 3×1h thermal (≥2 sites) + 1×1h ridge, without sustaining the other lift type | `future` — needs track-shape lift classification, not this sprint |
| P4 | ≥3 of 5 sites inland | `future` — needs a coastal/inland `Site` attribute, not this sprint |
| P2/P3/P4 | every Demonstrated Skills and Knowledge task, incl. precision landings | `instructor` — wired live by PR5 |
| P2 | 8 hours ground-school theory | `future` — not flight data, needs separate manual logging |

### Instructor & signoff model (PR3–PR5)

`Flight.instructorId` is mutable and gates only *future* writes (who may currently write a note
or signoff); `InstructorNote.instructorId` and `RatingSignoff.signedByProfileId` are immutable
author columns captured once, at write time, and never re-derived from the current
`Flight.instructorId`. Reassigning or clearing `Flight.instructorId` freezes past notes/signoffs —
never deletes or reattributes them, never revokes the pilot's own read access. This is the
sprint's single most important design call (anchoring decision 2), because it's the exact place
a naive schema goes wrong.

### Authorization matrix

| Action | Who |
|---|---|
| Assign / reassign / clear `flight.instructorId` | `flight.ownerId` only, and only to a profile currently in `listFriends(ownerId)`, re-checked at write time |
| Read `flightType` / `instructorId` | anyone who can already read the flight — ordinary header facts, no new sensitivity |
| Create/edit an `InstructorNote` | the profile that is both the note's own author **and** currently `flight.instructorId` |
| Read an `InstructorNote` | the flight's owner (always) **or** the note's own author (always, even after reassignment) — never a different instructor, never a friends/public viewer, independent of `flight.visibility` |
| Create a `RatingSignoff` | the profile currently `flight.instructorId` |
| Read a `RatingSignoff` | the pilot (always), the original signer (always), and whoever is *currently* `flight.instructorId` on that flight (for continuity) — never a friends/public viewer |

Each row is a named, independently-tested function in `lib/ratings/authz.ts`
(`canAssignInstructor`, `canWriteInstructorNote`, `canReadInstructorNote`, `canWriteSignoff`,
`canReadSignoff`), added in the PR that needs it (PR3/PR4/PR5) rather than all at once — no
predicate is ever satisfied by a value the client supplied.

### Data model

```prisma
model Flight {
  // ...all existing fields unchanged...

  // PR2 — solo/tandem/tow; null = solo-equivalent (matches all pre-existing rows,
  // since ingestion has never distinguished tandem flights until now).
  flightType   String?

  // PR3 — mutable; gates FUTURE InstructorNote/RatingSignoff writes only. Assignable
  // only by flight.ownerId, only to a profile currently in listFriends(ownerId),
  // re-checked server-side at write time (not just filtered in the picker UI).
  // Reassigning or clearing this does NOT delete, reattribute, or hide any existing
  // note or signoff — see InstructorNote.instructorId / RatingSignoff.signedByProfileId.
  instructorId String?
  instructor   Profile?         @relation("FlightInstructor", fields: [instructorId], references: [id], onDelete: SetNull)

  instructorNotes InstructorNote[]
  ratingSignoffs  RatingSignoff[]

  @@index([instructorId])
}

// PR4 — one flight can accumulate notes from more than one instructor over its
// lifetime (e.g. across a reassignment); each row is permanently attributed to
// its author. Never resolved through the general friends/public visibility path —
// visible only to the flight's owner and this note's own author, forever.
//
// Write/edit: only `instructorId` (the author), and only while that same profile
// is STILL the flight's current instructor. Once reassigned, the note freezes —
// still readable by its author, no longer editable by anyone.
model InstructorNote {
  id           String   @id @default(cuid())
  flightId     String
  flight       Flight   @relation(fields: [flightId], references: [id], onDelete: Cascade)
  instructorId String   // author, captured at write time — immutable
  instructor   Profile  @relation("InstructorNoteAuthor", fields: [instructorId], references: [id], onDelete: Cascade)
  body         String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([flightId])
  @@index([instructorId])
}

// PR5 — one witnessed occurrence of one USHPA criterion, evidenced by one flight.
// criterionKey references a stable, append-only id in lib/ratings/criteria.ts.
// signedByProfileId is captured at signing time and never changes even if
// Flight.instructorId is later reassigned. Append-only in v1 — no revocation
// field; a correction flow, if ever needed, is a later additive migration
// (see Open Questions).
//
// pilotId denormalizes flight.ownerId at signing time so /ratings can query
// this table directly by (pilotId, ratingLevel, criterionKey) without joining
// Flight, the same "targeted query over sparse rows" shape statsFrom uses
// in-memory reduction for over dense ones.
model RatingSignoff {
  id                String   @id @default(cuid())
  flightId          String
  flight            Flight   @relation(fields: [flightId], references: [id], onDelete: Cascade)
  pilotId           String
  pilot             Profile  @relation("RatingSignoffPilot", fields: [pilotId], references: [id], onDelete: Cascade)
  ratingLevel       String   // "P2" | "P3" | "P4"
  criterionKey      String   // matches an id in lib/ratings/criteria.ts
  signedByProfileId String   // immutable — the instructor who witnessed it
  signedBy          Profile  @relation("RatingSignoffAuthor", fields: [signedByProfileId], references: [id], onDelete: Cascade)
  signedAt          DateTime @default(now())
  note              String?

  @@index([pilotId, ratingLevel, criterionKey])
  @@index([flightId])
  @@index([signedByProfileId])
}
```

`Profile` gains four back-relations: `instructorFlights`, `instructorNotesAuthored`,
`ratingSignoffsAsPilot`, `ratingSignoffsAsAuthor`. Every migration after PR1 is purely additive —
new nullable columns or new tables, no backfill, no change to any existing query's result shape.
Migration naming follows the existing convention (`20260829185017_add_flight_notes`):
`<timestamp>_add_flight_type` (PR2), `<timestamp>_add_flight_instructor` (PR3),
`<timestamp>_add_instructor_note` (PR4), `<timestamp>_add_rating_signoff` (PR5).

### Test strategy

- `lib/ratings/stats.ts` gets a **DB-backed integration test**, following the existing
  `statsFrom` convention exactly (real Prisma client, real seeded/ingested flights, asserting an
  exact `RatingStats` object), since this is privacy/aggregation-sensitive code operating on data
  that already passed a viewer-scoped read. Cases: flying-day dedup across two flights on the
  same date; glider-count dedup across case/whitespace variants; the deleted-site fallback-key
  path (reusing the existing `statsFrom` test's fixture); solo-airtime behavior before vs. after
  PR2 (a tandem flight included in the total pre-PR2, excluded post-PR2).
- `lib/ratings/criteria.ts` evaluation gets plain unit tests (pure functions over a fixed
  `RatingStats` fixture) — one per threshold boundary.
- PR3 (`canAssignInstructor`): owner can assign a current friend; non-owner rejected; non-friend
  rejected even if submitted directly (not just filtered from the picker); clearing/reassigning
  works.
- PR4 (`canWriteInstructorNote` / `canReadInstructorNote`): the explicit reassignment scenario
  from anchoring decision 2 as its own named test — after reassigning Alex → Sam, Alex can still
  read but not edit his own note, Sam can neither read nor edit Alex's note, the pilot can always
  read every note on their own flight, a friends/public viewer of the flight can never read any
  note regardless of `flight.visibility`.
- PR5 (`canWriteSignoff` / `canReadSignoff`): current instructor can create; a former or
  non-current instructor cannot; the pilot, the original signer, and the current instructor can
  each read a signoff; a friends/public viewer cannot.
- Regression: the existing `statsFrom`/logbook integration suite re-runs unchanged and stays
  green — this sprint touches no existing selection or read path outside adding `glider` to
  `LIST_SELECT`.
- PR1 adds one new Playwright e2e assertion that `/ratings` renders for a signed-in pilot without
  erroring, since it's a new top-level route; no other e2e scenario is required.

## Implementation

### PR1 — Auto-calc ratings page (zero schema changes) — ~30%

Ships `/ratings` as a real, live page computing P2/P3/P4 progress entirely from data Leaf Log
already has. `lib/flights/repo.ts` gains `glider: true` in `LIST_SELECT` (a select addition, not
a migration) and exports `siteKey` for reuse. New `lib/ratings/stats.ts` (`ratingStatsFrom`) and
`lib/ratings/criteria.ts` (the three-way-typed catalog from Architecture) back a new
`app/ratings/page.tsx`, mirroring `app/logbook/page.tsx`'s shape exactly. Every
non-`auto` P2–P4 criterion renders as a clearly labeled row (`instructor`: "needs an instructor's
sign-off"; `future`: its own specific reason). After this PR alone, pilots have a working,
motivating ratings page; every later PR is purely additive to it.

### PR2 — Flight type + precise solo airtime — ~10%

Adds `Flight.flightType` and its edit-page card (following the exact `notes`-field server-action
idiom: owner-scoped `updateMany`, `useActionState`, inline success/error). Un-approximates the
P3/P4 solo-airtime rows and flips the P4 tandem-sub-limit catalog rows from `future` to `auto`.
First schema migration of the sprint; small and isolated because PR1 already proved the page it
plugs into.

### PR3 — Instructor assignment — ~15%

Adds `Flight.instructorId` + relation and an edit-page "Instructor" card sourced from
`listFriends(ownerId)`. `lib/ratings/authz.ts::canAssignInstructor` re-verifies the friend-graph
check server-side on every write — the picker UI is not treated as sufficient enforcement, since
a submitted `instructorId` is attacker-controlled input regardless of what it offered. No visible
`/ratings` change yet (assignment alone completes no criterion), but independently shippable and
useful: pilots can start tagging instructors on past flights immediately.

### PR4 — Instructor notes — ~20%

Adds the `InstructorNote` model (immutable author column, frozen-after-reassignment behavior) and
its guards (`canWriteInstructorNote`, `canReadInstructorNote`), plus a note card on the flight
page — rendered for the owner (read-only) and for the note's own author (editable only while
still the current instructor). This is the sprint's first genuinely new authz axis
(instructor-id-scoped reads/writes, never resolved through the general friends/public visibility
predicate), built with the reassignment scenario as an explicit, named test from day one — the
exact bug class anchoring decision 2 exists to prevent.

### PR5 — Rating signoffs — ~25%

Adds the `RatingSignoff` model (immutable `signedByProfileId`, denormalized `pilotId`,
append-only) and its guards (`canWriteSignoff`, `canReadSignoff`), a signoff form reachable from
a flight the viewer currently instructs, scoped to that flight's `kind: "instructor"` criteria
from the catalog. Wires `/ratings` so those rows stop reading "needs an instructor's sign-off" and
start showing "Signed off by [instructor] on [date]." This is the PR that finally makes the
greyed rows from PR1 go live — closing the loop the sprint has been building toward across five
independently-shippable PRs, each of which left a working product behind it.

## Files Summary

**PR1**
- `lib/flights/repo.ts` — add `glider` to `LIST_SELECT`; export `siteKey` for reuse.
- `lib/ratings/stats.ts` (new) — `ratingStatsFrom`, `gliderKey`.
- `lib/ratings/stats.test.ts` (new, DB-backed integration test).
- `lib/ratings/criteria.ts` (new) — three-way-typed P2/P3/P4 catalog.
- `lib/ratings/criteria.test.ts` (new, unit tests).
- `app/ratings/page.tsx` (new).
- `components/ratings/rating-level-card.tsx`, `components/ratings/criterion-row.tsx` (new).
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
- `lib/ratings/authz.ts` (new) — `canAssignInstructor`.
- `app/flights/[id]/edit/instructor-editor.tsx` (new), `app/flights/[id]/edit/actions.ts` —
  `updateInstructor`.
- `app/flights/[id]/edit/page.tsx` — new "Instructor" card.
- `lib/ratings/authz.test.ts` — friend-check rejection test.

**PR4**
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_instructor_note/` (new).
- `lib/ratings/authz.ts` — `canWriteInstructorNote`, `canReadInstructorNote`.
- `lib/ratings/notes.ts` (new) — create/edit `InstructorNote`.
- `components/flight/instructor-note-card.tsx` (new), wired into the flight page.
- `app/flights/[id]/instructor-note-actions.ts` (new) — `updateInstructorNote`.
- integration test covering the reassignment-freeze scenario explicitly.

**PR5**
- `prisma/schema.prisma`, `prisma/migrations/<timestamp>_add_rating_signoff/` (new).
- `lib/ratings/authz.ts` — `canWriteSignoff`, `canReadSignoff`.
- `lib/ratings/signoffs.ts` (new) — create signoff, `activeSignoffsFor(pilotId, ratingLevel)`.
- `components/flight/signoff-form.tsx` (new).
- `app/ratings/page.tsx` — render real signoffs on `kind: "instructor"` rows.
- integration test for signoff read/write scoping.

## Definition of Done

- [ ] `/ratings` is live and reachable from nav after PR1, showing P2/P3/P4 progress for the
      signed-in pilot, with every `auto` criterion live and every `instructor`/`future` criterion
      rendering a specific, correctly-classified reason — never silently omitted.
- [ ] `flightType`, `instructorId`, `InstructorNote`, and `RatingSignoff` each ship with their own
      migration and are independently mergeable per the PR breakdown above.
- [ ] Instructor assignment only ever accepts a profile currently in the owner's accepted-friends
      list, re-verified server-side, not just filtered in the picker UI.
- [ ] `InstructorNote` reads are scoped to the flight's owner or the note's own immutable author —
      never a different (even currently-assigned) instructor, never a friends/public viewer,
      regardless of `flight.visibility`. Covered by a passing integration test that specifically
      exercises a reassignment (old author still reads, new instructor does not).
- [ ] `RatingSignoff` reads are scoped to the pilot, the original signer, and the current
      instructor only; writes only to the current instructor.
- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm e2e` all pass on every PR.
- [ ] A `/whats-new` entry accompanies every user-visible PR (PR1, PR2, PR3, PR4, PR5).
- [ ] USHPA criterion catalog re-verified against the current SOP-12-02 revision before PR5 ships
      (the research brief's own caveat — it used V.2017-3-4).

## Risks

- **Total-airtime-as-solo-proxy overstates P3/P4 progress for any pilot who has already logged a
  tandem flight, until PR2 ships.** Mitigation: an inline caveat wherever the number appears, and
  PR2 is second in the sequence specifically to keep this window short.
- **Glider-string diversity undercounts pilots who typed their wing's name inconsistently.**
  Mitigation: undercounting is the safe failure direction for a "you've flown at least N"
  threshold; a caveat is shown; normalization is a future backlog item.
- **Locked/greyed rows could read as "broken" or naggy rather than motivating.** Mitigation:
  specific, plain-language reasons per row and a design pass on the locked-row treatment before
  PR1 ships.
- **A wrong authorization predicate for `InstructorNote`/`RatingSignoff` ships unnoticed.**
  Mitigation: the exact reassignment scenario that broke the ship-first draft's original schema
  is a named, required integration test in PR4 (see Definition of Done) — not just general
  coverage, but that specific case.
- **Naming a friend as instructor without their consent feels invasive.** Mitigation: shipped as
  a named v1 decision (anchoring decision 5), explicitly watched via manual QA / usage once PR3
  ships to real users, not silently assumed.
- **The criterion catalog drifts from the actual USHPA SOP text**, being hand-maintained code
  rather than sourced live. Mitigation: one file (`lib/ratings/criteria.ts`), re-verified against
  the current SOP before PR5.
- **Append-only `RatingSignoff` may prove insufficient once a real correction need appears** (an
  instructor fixes a mis-recorded date). Mitigation: deferred deliberately (see Open Questions) —
  adding `revokedAt`/`revokedByProfileId` later is a cheap additive migration; carrying unused
  revocation semantics through the full test/authz buildout now would be premature.
- **Sequencing pressure to fold `flightType` or `instructorId` into PR1 "since we're already in
  the file."** Mitigation: anchoring decision 1 is the explicit answer — PR1's zero-schema-change
  property is the point, not an accident of scoping.

## Security (privacy / authz)

This app enforces privacy entirely at the application layer (no DB RLS) — every read/write this
sprint adds follows that existing discipline explicitly:

- **`/ratings` reads only through `listOwnFlights(profile.id)`**, already owner-scoped and
  already the call `/logbook` makes. No cross-pilot read exists anywhere in PR1.
- **`flightType` (PR2) writes go through the same owner-matching `updateMany` where-clause** as
  every other edit-page field; **reads** ride along on the existing `getFlightForViewer` payload
  with no new sensitivity — it's an ordinary header fact.
- **`instructorId` (PR3) writes require both** the flight-owner-matching `updateMany`
  where-clause and a server-side `canAssignInstructor` check (live `areFriends`) — the picker UI
  is never treated as sufficient enforcement.
- **`InstructorNote` (PR4) is the sprint's one genuinely new read/write axis, and its guards are
  the sprint's central correctness bar**: writes require the actor to be both the note's own
  immutable author *and* the flight's current `instructorId`; reads are scoped to the flight's
  owner or the note's own author — explicitly never re-derived from the flight's current
  `instructorId`, and never resolved through the general friends/public flight-visibility
  predicate in `lib/flights/repo.ts`. A friend or the public viewing a `visibility: "public"`
  flight must never see its instructor notes.
- **`RatingSignoff` (PR5) writes are scoped to the flight's current `instructorId`**; reads are
  scoped to the pilot, the original signer, and the flight's current instructor — never a
  friends/public viewer.
- **No new public or friends-visible surface is added anywhere in this sprint.** Ratings,
  instructor notes, and signoffs are all self-, author-, or instructor-only in v1; broader
  visibility (a public ratings badge, a friends-visible note) is explicitly deferred.
- **Standing constraint for future work**: no export, public API, or device-push surface may
  expose `InstructorNote` or `RatingSignoff` content without a fresh authorization review.

## Dependencies

- **Depends on** `lib/social/friends.ts` (`listFriends`, `areFriends`) for PR3's instructor
  picker and its server-side re-check.
- **Depends on** `lib/flights/repo.ts`'s existing `LIST_SELECT`/`FlightListItem`/`statsFrom`
  pattern (PR1 extends it with a sibling reducer) and `getFlightForViewer` (PR2's `flightType`
  and PR3's `instructorId` need no repo change to be readable on the flight page, since that
  function already returns the full row). Depends on the existing `Site` model for site
  diversity and the pre-existing free-text `Flight.glider` column for glider diversity.
- **Depends on** the existing flight-edit-page field idiom (server action + `useActionState` +
  owner-matching where-clause) for PR2/PR3, and the existing edit-page ownership-guard pattern as
  the template for PR4's new, different guard (viewer id vs. flight/note instructor id, not
  owner id).
- **Blocks/unlocks** (future v2, not this sprint): P1/P5 (Master) ladder support once P2–P4 is
  validated in production; Special Skill Endorsements, reusing `RatingSignoff` with a different
  `level`/`criterionKey` namespace; a future public-facing ratings badge; lift-type track
  classification and coastal/inland site tagging, each of which only needs a `criteria.ts` entry
  flipped from `future` to `auto` once built, no ratings-engine rework; a possible
  `RatingSignoff` correction/revocation flow.

## Open Questions

- **Should instructor nomination require the instructor's acceptance**, rather than a pilot
  silently naming any accepted friend? Decided "no" for v1 (anchoring decision 5); revisit with
  real usage once PR3 ships — the auto-calc page (live since PR1) gives a real audience to gather
  that signal from before the consent question needs re-deciding.
- **Should a `RatingSignoff` ever be correctable** (fixing a mis-recorded date, or retracting one
  entered in error), or does it stay append-only indefinitely? Deliberately left open — v1 ships
  append-only, and adding revocation fields later is a cheap additive migration if a real need
  appears; there's no benefit to guessing now.
- **Should a currently-assigned instructor read a pilot's `InstructorNote`/`RatingSignoff`
  history from the pilot's *other* flights** (continuity when picking up a returning student),
  rather than strictly per-flight as designed here? A genuine usability-vs-privacy tension, best
  revisited with real usage after PR4/PR5 ship, not guessed at now.
- **What should a pilot-level (not flight-evidenced) criterion — like P2's 8-hour ground-school
  requirement — actually be modeled as?** `RatingSignoff.flightId` is required in this sprint
  specifically to avoid answering this prematurely; a future sprint decides whether it's a
  nullable-`flightId` variant of the same model or a separate mechanism entirely.
- **Should `/ratings` ever become visible on a pilot's public profile**, or stay private
  indefinitely? Not resolved here — v1 stays self-only, deferring this rather than guessing at an
  answer that would shape the read-authz design prematurely.
- **Should `Site` eventually gain a coastal/inland attribute** to make P4's "3 of 5 sites inland"
  auto-calculable? No decision needed this sprint — the catalog entry is simply tagged `future`
  until someone proposes it.
