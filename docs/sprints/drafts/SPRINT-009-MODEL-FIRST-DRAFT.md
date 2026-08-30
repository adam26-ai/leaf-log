# SPRINT-009 — USHPA ratings, model-first (instructor sign-off authority before any ratings UI)

## Overview

Leaf Log wants to show a pilot their progress toward USHPA's P2/P3/P4 paragliding
ratings, blending auto-calculated criteria (flight count, airtime, site/glider
diversity — all derivable from data Leaf Log already has) with criteria that
USHPA's own rules require a human witness for (precision landings, ground
handling, simulated reserve deployment, and the rest of the "Demonstrated
Skills and Knowledge" list). That second category needs something Leaf Log has
never had: a person other than the flight's owner gets a scoped write path
into another pilot's flight record — an instructor assigned from the pilot's
accepted friends, who can leave private notes and mark specific USHPA criteria
as witnessed.

This sprint's job is to get that trust boundary exactly right — schema,
authorization predicates, and every reassignment/unfriend edge case — before a
single form renders. PR1 lands the **complete** domain shape (`flightType`,
`instructorId`, `InstructorNote`, `RatingSignoff`) as one dedicated,
non-user-visible PR, proven entirely by DB-backed integration tests. This
mirrors the repo's own precedent: SPRINT-005/006/007 each shipped their
zone/boundary/community read-path privacy firewall as its own PR before any
feature UI landed on top, and SPRINT-008 leaned on a single centralized,
fail-closed gate rather than scattering feature-flag checks across the app.
The instructor/signoff relationship deserves the same discipline, for a
sharper reason than "consistency with past sprints": every other write path
in this app is owner-writes-own-row. This is the first path where a
*different* profile writes into *your* record, and it's a record other
pilots — friends, or the public, if the flight is public — may also be
looking at. A rushed version of this bolted on after a ratings page already
exists risks three concrete failure modes, not just messy code:

- **A live security mistake**, not a cosmetic bug — e.g. a former instructor
  (unfriended, reassigned, or never actually assigned) retaining write access
  to a pilot's InstructorNote because the write path re-used
  `areFriends()`-at-request-time instead of checking *current* assignment, or
  a signoff writable by anyone in the pilot's friend list instead of only the
  one profile the pilot actually designated.
- **A painful data migration**, once real notes and signoffs exist. If the
  first schema shape gets the relationship between "who signed this" and
  "who is currently assigned" wrong (e.g. one FK doing both jobs), fixing it
  later means a backfill across live instructor/pilot data, not an empty
  additive migration.
- **A broken trust model between pilot and instructor.** A precision-landing
  signoff or a season's worth of coaching notes disappearing (or becoming
  unreadable) the moment a pilot un-friends or reassigns their instructor
  would be exactly the kind of "why did my logbook lose data" trust failure
  this app cannot afford — USHPA card applications may lean on this history.

Getting the authorization shape provably right, under tests, before anyone
can click a button that exercises it, is worth delaying visible progress by
one PR cycle.

### Anchoring decisions

1. **PR1 is schema + authorization only — zero UI, zero user-visible change.**
   `flightType`, `instructorId`, `InstructorNote`, and `RatingSignoff` all
   land in one migration and one set of authorization predicates, proven by
   integration tests that call the server-action-shaped functions directly
   (not through a rendered form). This is the direct analogue of zones'
   dedicated read-firewall PRs: the thing being protected (another person's
   write access into your flight) doesn't exist as a risk until this PR
   merges, so there is no "ship the UI, tighten security later" path — the
   security posture *is* the deliverable, and it needs to be soaked under
   tests for a full review cycle before it's live data anyone depends on.

2. **Instructor assignment is owner-only, friend-graph-constrained, and
   asymmetric (no acceptance handshake in v1).** Only `flight.ownerId` may
   set, change, or clear `flight.instructorId`, and only to a profile
   currently present in `listFriends(ownerId)` — checked fresh at write time,
   the same friend-graph precedent this repo already uses for
   friends-visibility flights. There is deliberately **no** accept/decline
   step for the instructor, unlike a friend request itself: being someone's
   accepted friend is treated as sufficient basis to be *nominated* as their
   instructor of record, symmetric with how a friend's `visibility: friends`
   flights become visible to you the moment you're friends, with no separate
   consent layer. This is a real tradeoff (an instructor can be named without
   affirmatively agreeing to it) and is called out explicitly as an Open
   Question rather than silently assumed away.

3. **All instructor/signoff writes are gated on *current* assignment,
   re-checked per write — never cached, never trusted from the client.**
   Every write (a note, a signoff) uses the owner-matching where-clause idiom
   already established for flight edits — `UPDATE ... WHERE flightId = X AND
   instructorId = viewerId`, zero rows matched ⇒ error — never a
   read-then-check. The check is always against the row's live
   `instructorId` column at the instant of the write, not a value passed in
   from the client or resolved earlier in the request.

4. **Current assignment and historical authorship are two different columns
   with two different jobs — this is the sprint's single most important
   design call.** `flight.instructorId` is mutable and gates *future*
   writes only. Every `InstructorNote` and `RatingSignoff` row separately and
   permanently records `instructorId` / `signedByProfileId` — the profile
   that actually authored it — and that value never changes when
   `flight.instructorId` is later reassigned or cleared. Reassigning or
   unfriending an instructor **freezes** their past notes and signoffs; it
   never deletes or reattributes them, and it never revokes read access for
   the pilot. A pilot progressing through several instructors over a season,
   or unfriending someone after a falling-out, must never lose a hard-won
   precision-landing signoff as a side effect.

5. **Signoffs and notes get different read-privacy defaults, because they
   carry different sensitivity.** A `RatingSignoff` is a structured fact
   ("criterion X, witnessed, on this flight") — low-sensitivity, and useful
   for continuity, so it's readable by the pilot, the original signer, and
   *whoever is currently* `flight.instructorId` (even if that's someone
   else, e.g. after reassignment mid-review). An `InstructorNote` is
   freeform commentary about a pilot's performance — higher-sensitivity — so
   it's readable only by the pilot and its own author, never by a
   *different* instructor even if currently assigned to that same flight.
   Neither is ever visible to a friends/public viewer of the flight,
   regardless of `flight.visibility` — this needs its own authorization
   predicate, since `getFlightForViewer`'s owner/friends/public resolution
   has nothing to do with the instructor relationship.

### Committed v1 scope

- `Flight.flightType` (`solo` | `tandem` | `tow`, plain nullable `String`
  matching the `visibility`/`source`/`status` convention — not a DB enum).
- `Flight.instructorId` + relation, owner-write-gated and friend-graph
  constrained, per decision 2.
- `InstructorNote` model: one flight, one author, frozen once reassigned,
  author + pilot read only.
- `RatingSignoff` model: one flight, one rating level, one criterion key,
  one signing instructor, soft-revocable by the original signer only.
- A static, code-owned USHPA criterion catalog (`lib/ratings/criteria.ts`)
  covering every P2/P3/P4 criterion from the research brief, tagged `auto`
  or `instructor`, so the eventual ratings page has one source of truth to
  read from instead of hardcoded criteria scattered across views.
- Full DB-backed integration test coverage of every authorization predicate
  above, including the negative cases (former instructor, wrong friend,
  non-owner, non-current-instructor, non-signer).
- Owner-facing edit-page cards for flight type and instructor assignment
  (PR2), an instructor-facing note/signoff view (PR3), and the `/ratings`
  progress page itself (PR4) — all built *on* the PR1 model, not
  interleaved with it.

### Explicitly out of scope (with reasons)

- **P0/P1, P5/Master, and Special Skill Endorsements** — per the existing
  product decision; P0/P1 lack flight-log data to hang a progress view on,
  P5/Master is a much larger separate points-based award, and endorsements
  are a natural v2. Not relitigated here.
- **Lift-type classification from track shape and precision-landing
  auto-detection from touchdown point** — legitimate future stretch goals;
  every criterion that would need them stays `instructor`-tagged (manual)
  in the v1 catalog.
- **Coastal/inland Site tagging** for P4's "at least 3 of 5 sites inland" —
  `Site` has no such attribute today; that sub-criterion is tagged
  `instructor` (manual) in v1 rather than half-built against data that
  doesn't exist.
- **Ground-school hour logging (P2's 8-hour theory requirement)** — not
  flight data at all, and `RatingSignoff.flightId` is deliberately
  **required** (not nullable) in this sprint's schema specifically so this
  question isn't begged by the model; a pilot-level-only signoff mechanism
  is a separate future design, tracked as an Open Question.
- **A two-way instructor-acceptance flow** (the instructor confirming they
  accept the role, beyond already being an accepted friend) — deferred per
  decision 2; revisit if v1's asymmetric assignment proves to feel
  invasive in practice.
- **Any export, API, or public surface of `InstructorNote`/`RatingSignoff`
  content** — not built this sprint, and flagged in Security below as a
  standing constraint for whenever an export/API surface is proposed.
- **Cross-flight instructor read access** — a currently-assigned instructor
  can read signoffs on *that* flight only, never a pilot's full
  cross-flight signoff/note history. See Open Questions.

## Use Cases

1. **A pilot assigns their instructor to a flight.** Dana logs a training
   flight, opens the edit page, and picks "Alex" from an instructor dropdown
   sourced from her accepted friends. Alex now has a scoped write path into
   this one flight — nothing else of Dana's changes.

2. **The instructor leaves a private note.** Alex opens the flight (via the
   instructor-facing view gated on `viewer.id === flight.instructorId`, a
   different guard than the owner-only edit-page check) and writes: "Good
   symmetric brake use on final, watch your flare timing." Dana can see it
   on her flight page; a friend Dana shared the flight with cannot, even
   though the flight itself is `visibility: friends`.

3. **The instructor marks a precision-landing signoff.** Alex confirms
   Dana's landing on this flight lands within 25 feet of the target and
   marks the `p2_precision_landing_25ft` criterion. The signoff records
   Alex as `signedByProfileId`, timestamped, tied to this flight.

4. **Dana reassigns her instructor mid-season.** Dana starts training with
   a new instructor, Sam, and changes the flight's (and future flights')
   assigned instructor to Sam. Alex's existing note and signoff on the
   earlier flight are untouched — still visible to Dana, still attributed
   to Alex, still counting toward Dana's P2 progress. Alex, no longer
   `flight.instructorId` on that flight, can still read the note they wrote
   but can no longer edit it or sign off anything new on it.

5. **Dana and Alex later stop being friends.** Nothing about Alex's past
   signoffs or notes disappears or becomes attributed to someone else —
   they were never keyed to the friendship, only to the assignment that
   existed at the time they were written. Alex simply can no longer be
   re-assigned as Dana's instructor on a new flight unless they re-friend.

6. **Dana checks her P3 progress.** On `/ratings`, Dana sees auto-calculated
   criteria (30 flying days: 22/30; 90 flights: 61/90) alongside
   instructor-witnessed criteria, shown explicitly even when unsigned — "3
   consecutive precision landings within 10': 1 of 3, awaiting instructor"
   — never silently hidden, because the page's whole purpose is showing her
   what's left to do.

## Architecture

The new surface lives in `lib/ratings/`, structured the same way
`lib/social/friends.ts` and `lib/flights/repo.ts` already are: small,
composable, DB-aware functions with no framework coupling, each with a name
that states its authorization scope rather than a generic CRUD verb —
`assignInstructor`, `canWriteInstructorNote`, `activeSignoffsFor`. The
criterion catalog (`lib/ratings/criteria.ts`) is plain code, not a DB table,
for the same reason `FEATURES.md`/`RELEASE_NOTES` are separate hand-maintained
files rather than derived: USHPA revises SOP-12-02 periodically, and a
criterion's label, level, or auto/instructor classification should be a
one-file code change, not a migration.

### Data model

```prisma
model Flight {
  // ...existing fields unchanged...

  // v1 values: "solo" | "tandem" | "tow" — plain String (not a DB enum),
  // matching visibility/source/status. Owner-editable, same field idiom as
  // `notes`. Unlocks the P4 tandem-hour sub-limit auto-calc, which today has
  // no way to distinguish tandem airtime from solo airtime.
  flightType   String?

  // The currently assigned flight instructor. Owner-write-gated (only
  // flight.ownerId may set/change/clear this) and constrained to a profile
  // present in listFriends(ownerId) at write time. Mutable — gates FUTURE
  // InstructorNote/RatingSignoff writes only. Reassigning or clearing this
  // does NOT delete, reattribute, or hide any existing note or signoff;
  // see InstructorNote.instructorId / RatingSignoff.signedByProfileId for
  // the immutable authorship record.
  instructorId String?
  instructor   Profile?          @relation("FlightInstructor", fields: [instructorId], references: [id], onDelete: SetNull)

  instructorNotes InstructorNote[]
  ratingSignoffs  RatingSignoff[]

  @@index([instructorId])
}

// A flight instructor's private note about one specific flight. Distinct
// from Flight.notes (the pilot's own free-text notes, owner-only, already
// shipped). Never shown to a friends/public viewer regardless of
// Flight.visibility.
//
// Write/edit: only `instructorId` (the author), and only while that same
// profile still equals the flight's CURRENT `instructorId` — once
// reassigned, the note freezes permanently, even for its own author.
// Read: the flight's owner (always) and the note's author (always, even
// after reassignment) — never a different instructor, current or past,
// and never a friends/public viewer.
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

// One instructor's witnessed sign-off of one USHPA criterion, evidenced by
// one specific flight (e.g. "this flight's landing counts as a P2
// precision landing"). criterionKey is a stable string id into the static
// catalog in lib/ratings/criteria.ts, not a DB enum — see Architecture.
// flightId is required (not nullable): v1 only supports flight-evidenced
// criteria; see "Explicitly out of scope" re: ground-school hours.
//
// signedByProfileId is captured at signing time and never changes even if
// Flight.instructorId is later reassigned — provenance is immutable,
// current assignment is not (decision 4). Soft-revocable rather than
// deleted, by the original signer ONLY, regardless of whether they are
// still the flight's assigned instructor — the same "undo my own claim"
// right an owner already has over their own notes.
//
// pilotId denormalizes flight.ownerId at signing time so per-pilot
// progress aggregation (PR4) queries this table directly by
// (pilotId, ratingLevel, criterionKey) without joining Flight, mirroring
// statsFrom's in-memory-reduction pattern but pushed into a targeted query
// since signoffs, unlike flight stats, are sparse.
model RatingSignoff {
  id                  String    @id @default(cuid())
  flightId            String
  flight              Flight    @relation(fields: [flightId], references: [id], onDelete: Cascade)
  pilotId             String
  pilot               Profile   @relation("RatingSignoffPilot", fields: [pilotId], references: [id], onDelete: Cascade)
  ratingLevel         String    // "P2" | "P3" | "P4"
  criterionKey        String    // e.g. "p2_precision_landing_25ft"
  signedByProfileId   String
  signedBy            Profile   @relation("RatingSignoffAuthor", fields: [signedByProfileId], references: [id], onDelete: Cascade)
  signedAt            DateTime  @default(now())
  note                String?
  revokedAt           DateTime?
  revokedByProfileId  String?

  @@index([pilotId, ratingLevel, criterionKey])
  @@index([flightId])
  @@index([signedByProfileId])
}
```

`Profile` gains the four corresponding back-relations
(`instructorFlights`, `instructorNotesAuthored`, `ratingSignoffsAsPilot`,
`ratingSignoffsAsAuthor`). Migration is purely additive — new nullable
columns, two new tables, no backfill, no change to any existing query's
result shape.

### Authorization matrix

| Action | Who |
|---|---|
| Assign / reassign / clear `flight.instructorId` | `flight.ownerId` only, and only to a profile currently in `listFriends(ownerId)` |
| Create/edit an `InstructorNote` on a flight | the profile that is **currently** `flight.instructorId`, and only while still assigned |
| Read an `InstructorNote` | the flight owner (always) **or** the note's author (always, even after reassignment) — never a friends/public viewer, never a different instructor |
| Create a `RatingSignoff` on a flight | the profile that is **currently** `flight.instructorId` |
| Revoke a `RatingSignoff` | only `signedByProfileId` (the original signer), regardless of current assignment |
| Read a `RatingSignoff` | the pilot (always), the original signer (always), and whoever is **currently** `flight.instructorId` on that flight |
| Read `flightType` | anyone who can already read the flight (it's an ordinary header fact, no new sensitivity) |

Every predicate above is implemented as a named, independently testable
function in `lib/ratings/authz.ts` (`canAssignInstructor`,
`canWriteInstructorNote`, `canReadInstructorNote`, `canWriteSignoff`,
`canRevokeSignoff`, `canReadSignoff`), each re-reading the relevant row's
live `instructorId`/`signedByProfileId` rather than trusting a caller-passed
value — no predicate is ever satisfied by data the client supplied.

### Test strategy

Following the `statsFrom` precedent (DB-backed integration tests against a
real Prisma client and seeded/ingested flights, not mocks — this is
privacy/aggregation-sensitive, exactly the category that convention exists
for):

- **Assignment**: owner can assign a current friend; non-owner rejected;
  non-friend rejected; owner can clear or reassign; assignment survives
  unrelated flight edits.
- **InstructorNote**: current instructor can create; non-current-instructor
  (including a former instructor, and any other friend) cannot; after
  reassignment, the original author can still read but not edit their own
  note; the new instructor cannot read the old instructor's note; the
  pilot can always read every note on their own flight; a friends/public
  viewer of the flight can never read any note, regardless of
  `flight.visibility`.
- **RatingSignoff**: current instructor can create; non-current-instructor
  cannot; original signer can revoke even after reassignment; a
  *different*, even currently-assigned, instructor cannot revoke someone
  else's signoff; the pilot, the original signer, and the current
  instructor can each read it; a friends/public viewer cannot.
- **`activeSignoffsFor` helper**: excludes revoked rows — tested at the
  query-helper level in PR1 even though its only consumer (PR4's
  aggregation) doesn't exist yet, so the exclusion can't be forgotten at a
  second call site later.
- **Regression**: the existing `statsFrom`/logbook integration suite is
  re-run unchanged and stays green — this sprint touches no existing
  selection or read path.

## Implementation

### PR1 — Schema + authorization core (no UI)

*Effort: ~45%.* What becomes true after this merges: the complete domain
model exists in the database; every authorization rule in the matrix above
is implemented and covered by a passing DB-backed integration test,
including every negative case; nothing in the product looks or behaves
differently to any user. This is the PR the whole sprint is staked on.

- Migration adding `Flight.flightType`, `Flight.instructorId` + relation,
  `InstructorNote`, `RatingSignoff`, and the four `Profile` back-relations.
- `lib/ratings/criteria.ts` — static P2/P3/P4 catalog (id, label, level,
  `kind: 'auto' | 'instructor'`), covering every criterion enumerated in
  the USHPA research brief.
- `lib/ratings/assign-instructor.ts` — `assignInstructor(flightId, ownerId,
  instructorProfileId | null)`, owner-matching where-clause idiom, friend
  check against `listFriends`.
- `lib/ratings/notes.ts` — create/edit `InstructorNote`, instructor-matching
  where-clause, frozen-after-reassignment behavior.
- `lib/ratings/signoffs.ts` — create/revoke `RatingSignoff`,
  `activeSignoffsFor(pilotId, ratingLevel)` query helper.
- `lib/ratings/authz.ts` — the six named predicate functions from the
  matrix, each independently unit/integration-tested.
- Full integration test suite per Test strategy above.

### PR2 — Flight-type and instructor pickers on the edit page

*Effort: ~15%.* What becomes true after this merges: a pilot can set a
flight's type and assign/reassign/clear its instructor from the flight-edit
page. First user-visible change of the sprint.

- Two new cards on the edit page, each following the established field
  idiom: a server action bound to `flightId`, driven by a client component
  via `useActionState`, an uncontrolled field, inline success/error text.
- Flight-type card: solo/tandem/tow choice.
- Instructor card: a picker sourced from `listFriends(ownerId)`, calling
  `assignInstructor`.
- `RELEASE_NOTES` entry in `lib/whats-new.ts` (user-facing change).

### PR3 — Instructor-facing note and signoff view

*Effort: ~25%.* What becomes true after this merges: an assigned instructor
can open a flight and leave notes / mark witnessed criteria; the pilot sees
those notes and signoffs on their own flight page; nobody else does.

- A new instructor-facing route/section on the flight page, gated by
  `canWriteInstructorNote`/`canWriteSignoff` — an analogous but distinct
  guard from the owner-only edit-page check (`viewer.id ===
  flight.instructorId`, not `ownerId`).
- `InstructorNote` card: create/edit while assigned, frozen display
  otherwise.
- Signoff checklist scoped to `kind: 'instructor'` criteria from the PR1
  catalog, wired to `signoffs.ts`; a revoke control gated to the original
  signer.
- Pilot-facing read-only rendering of notes/signoffs on their own flight
  view (never rendered for a friends/public viewer).
- `RELEASE_NOTES` entry.

### PR4 — `/ratings` progress page

*Effort: ~15%.* What becomes true after this merges: a pilot has a page
showing progress toward P2/P3/P4, combining auto-calculated criteria with
instructor signoffs, unsigned criteria shown explicitly rather than hidden.

- New `/ratings` page, same page-level shape precedent as the logbook page
  (auth-redirect helper, centered column, plain heading, a stats/progress
  bar under it).
- Extends the `statsFrom`-style reducer set with flying-days dedupe (by
  flight date, same fallback-key idiom as site diversity) and glider-diversity
  dedupe (by the `glider` string, once added to the relevant selection) for
  the P3/P4 auto criteria.
- Queries `activeSignoffsFor` per rating level for the instructor-witnessed
  criteria; renders unsigned criteria with an explicit "awaiting instructor"
  state.
- `RELEASE_NOTES` entry.

## Files Summary

- `prisma/schema.prisma` — `Flight.flightType`, `Flight.instructorId` +
  relation, `InstructorNote`, `RatingSignoff`, four new `Profile`
  back-relations.
- `prisma/migrations/<timestamp>_add_instructor_and_ratings_model/` — new
  additive migration.
- `lib/ratings/criteria.ts`, `lib/ratings/authz.ts`,
  `lib/ratings/assign-instructor.ts`, `lib/ratings/notes.ts`,
  `lib/ratings/signoffs.ts` — new (PR1).
- `lib/ratings/*.test.ts` (or `test/ratings/*`, matching this repo's
  existing integration-test location convention) — new (PR1).
- Flight-edit page + two new client components (flight-type card,
  instructor card) + their server actions — new (PR2).
- Flight page: new instructor-facing section/route, `InstructorNote` card,
  signoff checklist component, pilot-facing read-only note/signoff display
  — new (PR3).
- `app/ratings/` (or equivalent route) page + progress components — new
  (PR4).
- `lib/whats-new.ts` — `RELEASE_NOTES` entries for PR2, PR3, PR4 (not PR1,
  which has no user-facing change).

## Definition of Done

- [ ] `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm e2e`
      all green on every PR.
- [ ] PR1 merges with zero user-visible or user-reachable change — verified
      by manual QA pass finding nothing different, not just by the absence
      of new routes.
- [ ] Every cell of the Authorization matrix has a passing integration
      test, including its negative case.
- [ ] Reassignment/unfriend integration test explicitly proves existing
      `InstructorNote`/`RatingSignoff` rows are neither deleted nor
      reattributed.
- [ ] `activeSignoffsFor` is the only place signoff-revocation filtering
      happens; no second ad hoc `revokedAt IS NULL` check exists elsewhere.
- [ ] `RELEASE_NOTES` updated for PR2, PR3, and PR4 before each deploys.
- [ ] Existing `statsFrom`/logbook integration suite passes unchanged.
- [ ] USHPA criterion catalog re-verified against the current SOP-12-02
      revision before PR3/PR4 ship (the original research brief's own
      caveat — this doc used SOP-12-02 V.2017-3-4).

## Risks

- **A wrong authorization predicate ships unnoticed because PR1 has no UI
  to eyeball.** Mitigation: the DB-backed integration suite is the primary
  and only verification for PR1, covering every matrix cell including
  negative cases, reviewed as carefully as the PR's schema itself before
  merge.
- **Naming a friend as instructor without their consent feels invasive.**
  Mitigation: shipped as designed for v1 (asymmetric, matching
  friends-visibility precedent); flagged as an Open Question and watched
  via manual QA / user feedback before PR3's instructor-facing UI ships to
  real users.
- **The criterion catalog drifts from the actual USHPA SOP text**, since
  it's hand-maintained code rather than sourced live. Mitigation: single
  file (`lib/ratings/criteria.ts`), explicitly re-verified against the
  current SOP before PR3/PR4, per the research brief's own caveat.
- **Schema churn if the per-flight instructor-assignment shape proves
  wrong once real usage exists in PR2/PR3.** Mitigation: PR1's fields are
  additive and nullable with no data yet, so a follow-up field-level
  migration is cheap and acceptable — the expensive-to-unwind part this
  sprint is protecting is the *authorization shape* (who can write what),
  not any individual column name.
- **Forgetting the revocation filter at a future second signoff-reading
  call site** (e.g. a future export or dashboard) silently resurrects
  revoked signoffs. Mitigation: `activeSignoffsFor` is the one and only
  read path for "signoffs that count," enforced by the Definition-of-Done
  check above.

## Security (privacy / authz)

This app has no DB-level RLS; every rule below is enforced app-layer, at the
point of read or write, the same as every existing privacy rule in this
codebase.

- **Instructor assignment**: owner-write only, friend-graph-constrained at
  write time (decision 2). A non-owner or a non-friend target is rejected
  server-side regardless of what a client sends.
- **InstructorNote / RatingSignoff writes**: gated on the row's *current*
  `flight.instructorId` at the instant of the write (decision 3), via the
  owner-matching where-clause idiom — never a cached or client-supplied
  assignment value.
- **InstructorNote reads**: pilot + original author only, never a
  different instructor (current or past), never a friends/public viewer,
  independent of `flight.visibility` (decision 5).
- **RatingSignoff reads**: pilot + original signer + currently-assigned
  instructor, never a friends/public viewer, independent of
  `flight.visibility` (decision 5).
- **Revocation**: original signer only, forever, independent of current
  assignment — the same "undo my own claim" right an owner already has
  over their own flight notes.
- **Standing constraint for future work**: no export, public API, or
  device-push surface may expose `InstructorNote` or `RatingSignoff`
  content without a fresh authorization review — flagged explicitly here so
  a future sprint doesn't assume "flight-adjacent data" is automatically
  safe to include.

## Dependencies

- Depends on `lib/social/friends.ts` (`listFriends`, `areFriends`) —
  unchanged, reused as-is for the friend-graph constraint.
- Depends on the existing flight-edit-page field idiom (server action +
  `useActionState` + owner-matching where-clause) — PR2/PR3 follow it
  exactly rather than inventing a new shape.
- Depends on the existing edit-page ownership guard pattern (viewer id vs.
  flight owner id) as the template for PR3's new, different guard (viewer
  id vs. flight instructor id).
- PR4 depends on `statsFrom`'s reducer/dedupe-key pattern for the new
  flying-days and glider-diversity criteria.
- Blocks: any future instructor-facing dashboard, v2 P1/P5/Special-Skill
  work, and any future export/API surface that would need to reason about
  instructor-note/signoff visibility.

## Open Questions

1. **Should instructor assignment require the instructor's acceptance**
   (a two-way confirmation, like a friend request itself), rather than a
   pilot silently nominating any accepted friend? Decided "no" for v1
   (decision 2); revisit if it proves to feel invasive once PR3 ships to
   real users.
2. **Should a currently-assigned instructor be able to read a pilot's
   InstructorNote/RatingSignoff history from the pilot's *other* flights**
   (cross-flight continuity when picking up a new student), rather than
   strictly per-flight as designed here? v1 deliberately keeps the narrower
   scope; this is a genuine usability-vs-privacy tension worth revisiting
   with real usage data rather than guessing now.
3. **What should a pilot-level (not flight-evidenced) criterion — like
   P2's 8-hour ground-school requirement — actually be modeled as?**
   `RatingSignoff.flightId` is required in this sprint specifically to
   avoid answering this prematurely; a future sprint needs to decide
   whether it's a variant of the same model with a nullable `flightId`, or
   a wholly separate mechanism.
4. **Should `Site` eventually gain a coastal/inland attribute** to make
   P4's "3 of 5 sites inland" auto-calculable, or does that stay
   instructor-tagged indefinitely? No decision needed this sprint — the
   catalog entry is simply tagged `instructor` until someone proposes it.
