## Strengths

- PR1's zero-schema-change bet is real and well-argued: every row in the table (P2 flights, P3 flying days/total flights, P4 flights/days/total-airtime/site-diversity/glider-diversity) genuinely comes from columns that exist today, and the `glider`-into-`LIST_SELECT` change is correctly identified as a `select` addition, not a migration.
- The "locked rows on the same page" decision (Anchoring #2) is a good answer to a real UX problem the model-first draft doesn't address at all — showing the whole P2–P4 ladder from day one, with specific `lockedReason`s, avoids a v2 "surprise, the ladder is bigger than you thought" moment.
- The solo-airtime approximation (Anchoring #3) is honestly labeled and reasoned about correctly for the actual user base (mostly non-tandem pilots), and the `soloAirtimeIsExact` flag is a clean way to gate the caveat text.
- Reuses the `statsFrom` fallback-key idiom and DB-backed integration-test convention faithfully, and correctly identifies `getInstructorNoteForViewer` as needing an owner-id-vs-instructor-id guard distinct from the edit page's ownership check — it names the right problem even where (see below) it solves it incompletely.

## Gaps and Risks

**1. `InstructorNote`'s schema conflates "who wrote this" with "who is currently assigned" — the exact failure mode the model-first draft's decision 4 is built to prevent.**

PR4's schema (Data model section) is:

```prisma
model InstructorNote {
  id           String   @id @default(cuid())
  flightId     String   @unique
  ...
  instructorId String
  note         String
  ...
}
```

`flightId String @unique` means at most one note ever, per flight, full stop — there is no way to represent "Alex wrote a note, then Dana reassigned to Sam" without either overwriting Alex's note or blocking Sam from ever writing one. The prose compounds this: "one private note per flight, **owned by whoever is `instructorId` at write time**." That phrasing treats ownership as tracking the mutable `Flight.instructorId`, not a frozen author. Then PR4's Architecture section defines the read guard as `getInstructorNoteForViewer(flightId, viewerId)` returning the note "only when `viewerId` equals the flight's **current** `ownerId` *or* **current** `instructorId`" — explicitly re-reading `Flight.instructorId`, not `InstructorNote.instructorId`. Concretely: Dana reassigns from Alex to Sam. Sam is now `flight.instructorId`. Sam did not write the note, but the read guard as specified hands Sam read access to Alex's private commentary about Dana — and simultaneously Alex, the actual author, loses read access to their own note, since the guard checks *current* instructorId, not the note's own author column. This is precisely the "former instructor retaining/losing access incorrectly" scenario the model-first draft calls out by name as a live security mistake, and it's baked into SHIP-FIRST's committed v1 schema, not a hypothetical risk of rushing.

The write-side guard (`updateMany({ where: { flightId, instructorId: viewerId } })`) is ambiguous about which table's `instructorId` it's matching against, but even in the best case where it checks `InstructorNote.instructorId` (frozen author), that's now inconsistent with the read guard checking `Flight.instructorId` (current) — meaning the read and write authorization rules disagree about what "the instructor" even means for the same row. That inconsistency alone should block merge as written.

**2. PR4's `@unique` note-per-flight is a real migration liability, not just a v1 simplification.**

Once real `InstructorNote` rows exist in production (post-PR4), fixing the schema to be author-list-shaped (what model-first ships from PR1 as `InstructorNote[]` with an immutable `instructorId` author column) requires a backfill/reshape of live data — exactly the "painful data migration" risk the model-first overview names as a reason to get this right before any UI ships. SHIP-FIRST's own sequencing (PR3 assignment ships and accumulates real `instructorId` reassignments for weeks before PR4's notes model exists) makes this worse: by the time the flawed note schema is discovered, there may already be multiple rounds of instructor reassignment on real flights, with pilots' expectation already set that reassignment is a free, no-consequence action (nothing in PR3 documents or tests what reassignment does to *future* PR4/PR5 data, because that data doesn't exist yet).

**3. PR5's criteria catalog needs retroactive surgery that PR1 didn't anticipate.**

PR1's `criteria.ts` shape is `kind: "auto" | "locked"`. PR5 says the instructor-gated rows "gain a `kind: 'instructor'`" — but PR1 tagged *every* non-auto P2–P4 row (witnessed-skill criteria, lift-type classification, coastal/inland site tagging) as the same generic `"locked"`, with only `lockedReason` distinguishing them informally. PR5 has to go back and pick out, from among all the `locked` rows, which ones actually mean "instructor-witnessable, arriving this sprint" versus "genuinely out of scope, no PR unlocks this." That's a config-only fix, but it's still evidence that PR1's own catalog design wasn't actually ready to receive PR5 without rework — contrast with the model-first PR1 catalog, which types every row `auto | instructor` from day one specifically so this doesn't happen.

**4. The "silently nominate a friend as instructor" trust question is never surfaced.**

PR3's instructor picker lets an owner assign any accepted friend as `instructorId` with no acceptance step, but SHIP-FIRST never mentions this as a decision at all — it's just implied by "the dropdown is populated from `listFriends`." The model-first draft treats this as Anchoring Decision 2 *and* Open Question 1 — an explicit, named tradeoff to revisit with real usage data. SHIP-FIRST ships the same asymmetric behavior without ever deciding it's a tradeoff, which means nobody signed off on "a friend can be made someone's flight instructor of record without being told" as intentional product behavior — it just falls out of not having designed the interaction.

**5. Schedule pressure lands exactly on the highest-risk PRs.**

Because PR1 ships a visibly "half-done" page with greyed rows ("needs an instructor's sign-off"), real pilots will be asking when PR4/PR5 land the moment PR1 ships — Use Case 7 even frames this as "a built-in incentive." That's real product pressure arriving precisely when PR4/PR5 need the most careful authz design (per Gap #1, a design SHIP-FIRST hasn't actually gotten right yet). The model-first draft's core thesis — do the hard authz design before there's a visible page creating demand for it — is a direct answer to this risk, and SHIP-FIRST's sequencing recreates the exact pressure it warns about.

## Questions for the merge

1. Does `InstructorNote` need to be redesigned (list-shaped, immutable author column, read/write guards keyed to the note's own author rather than `Flight.instructorId`) **before** PR4 merges, even if that means PR4 costs more than its stated ~15%? Merging the schema as currently drafted risks shipping the reassignment bug in Gap #1 to production.
2. Should PR1's `criteria.ts` ship with a three-way `kind` (`auto | instructor | future-locked`) from the start, so PR5 doesn't need to reclassify existing rows — cheap to decide now, more friction to retrofit once `RatingSignoff.criterionKey` references have started accumulating?
3. Is silent, unilateral instructor nomination (no acceptance step) an explicitly accepted product decision for this sprint, or does it need its own line in Anchoring Decisions / Open Questions before PR3 ships real assignments that PR4/PR5 will later attach notes and signoffs to?
4. Given Gap #5, should PR4/PR5's effort estimates and review bar be raised (or should PR1's "coming soon" framing be softened) specifically to relieve the schedule pressure that would otherwise push the trickiest authz work through review fastest?
5. Should PR3 be re-scoped to land alongside a minimal version of the frozen-authorship guard (even without notes/signoffs UI), so no production `instructorId` reassignment ever happens against a codebase that hasn't yet decided how reassignment interacts with future note/signoff ownership?
