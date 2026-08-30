
# Merge Notes — SPRINT-009

## The core call: decouple sequencing from schema design

The two drafts actually disagreed on two *independent* questions, and each critique landed a
decisive blow on a different one of them:

1. **Sequencing** (does the auto-calc page ship before or after the instructor/signoff model is
   built?) — ship-first was right here. The critique-of-model-first's Gap #1 is airtight and
   fact-backed: per the given codebase facts, `statsFrom`'s dedupe idiom has zero dependency on
   `instructorId`/`InstructorNote`/`RatingSignoff`, so gating 70% of the visible ladder behind
   85% of the sprint's authz effort (model-first's PR1, 45% of the sprint, zero user-visible
   output) is an unforced sequencing choice, not something the data dependencies require. It also
   collides with this project's own memory note on iterative, live-verified UI work, and with the
   ship-first critique's sharp observation that model-first's PR2 (instructor/flight-type
   pickers) would otherwise be a dead-end control with no page to show its effect for two more PR
   cycles.

2. **Schema correctness for the instructor/signoff model** — model-first was right here, and
   decisively. The critique-of-ship-first's Gap #1 walks through a concrete, reproducible bug:
   ship-first's `InstructorNote` (`flightId @unique`, read guard against the flight's *current*
   `instructorId`) means reassigning a flight's instructor hands the new instructor read access
   to the old instructor's private note, while the actual author loses access to their own note.
   That's not a hypothetical of moving fast — it's baked into ship-first's committed v1 schema.
   Model-first's decision 4 (immutable author columns, frozen at write time, independent of the
   mutable `Flight.instructorId`) is the correct fix, and it costs nothing to adopt regardless of
   sequencing.

The merged doc takes ship-first's PR ordering and model-first's data model. This isn't
splitting the difference — the two questions are genuinely separable, and each critique's
strongest point maps onto exactly one of them. Nothing here is a 50/50 average; each side won
outright on the question it was actually right about.

## What was kept from ship-first

- PR1 as a zero-schema-change, complete, demoable auto-calc page — its central thesis and its
  entire "what PR1 can/cannot show" table (re-derived against the brief) survive unchanged, since
  it was independently correct.
- The overall PR-per-slice sequencing shape (page → flightType → instructor assignment →
  notes → signoffs), including its Anchoring-decision framing style and its honest
  "locked/greyed row with a specific reason" UX approach.
- The `soloAirtimeIsExact` flag mechanism for the solo-airtime approximation, and the reasoning
  that it's already exactly correct for the overwhelming majority of non-tandem users.
- Use cases 1–3 and 9 (near-verbatim), since they describe the PR1 experience the merged plan
  keeps intact.

## What was kept from model-first

- The corrected `InstructorNote`/`RatingSignoff` data model in full: immutable
  `instructorId`/`signedByProfileId` author columns, frozen-at-reassignment semantics, denormalized
  `pilotId` on `RatingSignoff` for targeted queries.
- The named, independently-testable authorization-predicate discipline
  (`canAssignInstructor`/`canWriteInstructorNote`/etc. in `lib/ratings/authz.ts`) — kept as a
  pattern, but explicitly *not* kept as one upfront PR; each predicate now lands with the PR that
  needs it (see the sequencing call above).
- The Authorization matrix table format and its granularity (per-action, per-actor).
- Use cases 5, 6, and 8 (Alex/Sam/reassignment/unfriending), since they demonstrate exactly the
  corrected schema behavior and are more concrete than ship-first's equivalents.
- The framing of instructor-consent asymmetry as a *named* decision rather than an implied
  default — promoted from model-first's Open Question 1 into an explicit Anchoring Decision (5)
  in the merged doc, directly answering the ship-first critique's Gap #4 ("nobody signed off on
  this as intentional").
- The reasoning for keeping `RatingSignoff.flightId` required (ground-school hours stays a
  separate, unresolved future question rather than being begged by the schema).

## What was corrected or cut relative to both drafts

- **`lib/ratings/criteria.ts`'s `kind` taxonomy**: neither draft's version survives unchanged.
  Ship-first's two-way `auto | locked` needed a documented retrofit at PR5 (critique Gap #3);
  model-first's `auto | instructor` never accounted for criteria that are out of scope for the
  *whole sprint*, not just "not yet instructor-wired" (lift-type classification, coastal/inland
  tagging, ground-school hours). The merged doc uses a three-way `auto | instructor | future`
  from PR1, cleanly separating "this sprint's PR5 will wire this up" from "no PR this sprint
  touches this."
- **`RatingSignoff` revocation fields**: cut from v1 entirely, following the ship-first critique's
  Question 5 — model-first's `revokedAt`/`revokedByProfileId` are real, well-reasoned fields, but
  nothing in either draft's Use Cases or research brief establishes an actual v1 need for
  correcting a signoff. Adding them later is a one-line additive migration; carrying the full
  authz-matrix/test surface for revocation now (a currently-assigned instructor cannot revoke a
  different instructor's signoff, only the original signer can, etc.) is scope the sprint doesn't
  need yet. Flagged explicitly as an Open Question and a cut Explicitly-Out-Of-Scope item, not
  silently dropped.
- **Model-first's read allowance for `RatingSignoff`** (current instructor can read even if not
  the original signer, for continuity) was kept — it's cheap and well-motivated (decision 5 in the
  original draft) — but the equivalent broadening was deliberately *not* extended to
  `InstructorNote` (author-only, ever), matching model-first's own distinction that notes are
  higher-sensitivity freeform commentary while signoffs are structured, low-sensitivity facts.
- **Effort percentages** were rebalanced from scratch (30/10/15/20/25) rather than reusing either
  draft's numbers: PR1 is lighter than ship-first's 35% estimate now that its criteria-catalog
  typing is simpler to get right the first time (three-way from the start, no retrofit); PR4 and
  PR5 are weighted heavier than ship-first's 15%/15% to reflect that they now carry the
  reassignment-safety design and its required named test explicitly (per the ship-first critique's
  Gap #5 concern that schedule pressure lands hardest exactly where the authz needs the most
  care) — the merged doc answers that concern by budgeting real effort there rather than
  compressing it, while still keeping every PR independently shippable.
- **Migration-naming and Prisma conventions**: both drafts had these right and consistent with the
  given facts (timestamp-prefixed, snake_case, matching the `add_flight_notes` precedent); no
  correction needed, carried through unchanged.

## Facts-of-record incorporated directly (no drafting error found here)

- `glider` exists on `Flight` but not in `LIST_SELECT` — both drafts correctly treated adding it
  as a `select` change, not a migration; kept as-is.
- P4's ≥75h total-airtime threshold is on *total* airtime, not solo-restricted, so it has no PR2
  dependency — both drafts got this right; kept.
- `Site` has no coastal/inland attribute — both drafts correctly tagged the "3 of 5 sites inland"
  sub-criterion as out of reach this sprint; the merged doc's three-way taxonomy just gives it a
  more precise label (`future` vs. the ambiguous `locked`).
- The instructor-facing guard needing to differ from the owner-only edit-page guard
  (`viewer.id === flight.instructorId`, not `ownerId`) is exactly the "analogous but different
  guard" the research brief calls out — both drafts named this correctly; the merged doc keeps
  the framing but fixes which column the guard actually reads (the note's own author, not the
  flight's current `instructorId`).
