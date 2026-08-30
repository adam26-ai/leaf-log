# Sprint 009 Intent: USHPA Rating Progress & Flight Instructor Sign-offs

## Seed

The user asked to work on "USHPA Rating Progress & Flight Instructor Sign-offs" next off
the open FEATURES.md backlog, then — given the size of the feature (new flight metadata,
a friend-scoped instructor assignment, an auto-calc engine, a new page) — asked to sprint
plan it the way this repo's other big sprints (SPRINT-001 through SPRINT-008) were
planned: independent drafts, cross-critique, then a merge, rather than a single-pass plan.

One difference from prior sprints' `CLAUDE`/`CODEX` draft labels: this session cannot
invoke a second foundation model, so the two drafts were given genuinely different
**strategic angles** instead — `SHIP-FIRST` (ship a working, visible `/ratings` page as
early as possible, using only data Leaf Log already has; instructor plumbing lands in
later PRs) vs. `MODEL-FIRST` (land the complete schema and its permission model as one
dedicated "security PR" first, mirroring how SPRINT-004/005 treated their read-path
firewall as its own PR, before any UI ships) — labeled by that angle rather than a fake
vendor name.

The feature idea itself, as already logged and researched in `FEATURES.md` (verbatim,
this is the brief both drafts were given):

## USHPA Rating Progress & Flight Instructor Sign-offs
- **Area:** Flight metadata / Social (instructor assignment) / new "Ratings Progress" page
- **Description:** Leaf Log License progress functionality. Adds flight notes, flight type, and
  flight-instructor metadata to each flight. A flight instructor can be assigned from your
  accepted friends; that instructor can then add instructor notes and mark the flight against
  various USHPA license-level criteria signoffs (e.g. precision landings). A new "Ratings
  Progress" page shows a pilot's progress toward each available USHPA rating, combining
  auto-calculated criteria (from logged flight data) with instructor-marked signoffs for the
  criteria that require a witnessed skill demonstration.
- **Priority:** High
- **Notes:** Researched against USHPA's official Pilot Proficiency System, **SOP-12-02
  (V.2017-3-4, last amended March 2017)** — this is the most recent published version found;
  re-verify against USHPA's current SOP before implementation in case of a newer revision. The
  paragliding ladder is P0 (Student/tandem) → P1 (Beginner) → P2 (Novice) → P3 (Intermediate) →
  P4 (Advanced) → P5 (Master). P0/P1 are pre-solo, instructor-supervised territory with little
  flight-log data to hang a progress view on, and P5/Master is a separate, much larger
  points-based award (1,450 points across categories like airtime, flights, altitude gain,
  cross-country miles, site/glider diversity, competition results — see SOP-12-02 §12-02.10 for
  hang gliding / §12-02.17 for paragliding) — **P2, P3, and P4 are the practical MVP scope**;
  P1/P5/Special Skill endorsements (Ridge Soaring, Cross Country, High Altitude Launch, etc.) are
  real parts of the same system but a natural v2.

  **Auto-calculable today or with data Leaf Log already has/plans (no instructor needed):**
  - P2: minimum 25 logged flights.
  - P3: minimum 30 flying days, minimum 90 total flights, minimum 20 hours solo airtime.
  - P4: 250 flights; minimum 80 flying days; minimum 75 hours total airtime; flown at least 5
    different sites (using the existing `Site` model for site diversity); flown at least 5
    different canopies (using the already-parsed `Flight.glider` string, with a data-quality
    caveat — pilots may name the same wing inconsistently across uploads).
  - P4's tandem-hour sub-limits (≤25 of the 75 hours tandem, ≤10 of the 25 thermal hours tandem)
    become auto-calculable once this feature's own proposed `flightType` field (solo/tandem)
    exists — a nice example of the new metadata directly unlocking an existing auto-calc gap.

  **Partially auto (needs new track analysis, not just metadata — flag as a stretch goal, treat
  as instructor-tagged for v1):**
  - P4 requires specific flights "in thermal lift without sustaining ridge lift" (three 1-hour
    flights from ≥2 sites) and "in ridge lift without sustaining thermal lift" (one 1-hour
    flight). Duration and site-count are already auto-calculable; classifying a flight's LIFT
    TYPE from its own track shape (sustained circling vs. back-and-forth ridge traversal) is not
    something Leaf Log currently derives, though it's plausible future work.
  - P4's "5 sites... of which at least 3 were inland" needs a coastal/inland attribute on `Site`
    that doesn't exist today.

  **Requires instructor sign-off (witnessed maneuvers/technique — inherently subjective, not
  verifiable from a GPS track alone, and USHPA's own rules require a human witness regardless):**
  - Every "Demonstrated Skills and Knowledge" task at every level: forward/reverse inflations,
    ground handling/kiting, S-turns, 180°/360° turns, asymmetric wing collapses, surge control,
    PLF technique, simulated reserve deployment, verbal flight-plan/conditions analysis, written
    exams, and "convince the Instructor or Observer" the pilot can fly rated sites safely.
  - **Precision/spot landings specifically** (the example named in the request): P2 requires 5
    landings within 25' of a target, P3 within 10', P4 three consecutive within 10' (target moved
    between each, minimum 1 minute and 200' AGL). USHPA requires a human witness for these
    regardless of GPS accuracy. A nice hybrid: Leaf Log could auto-detect a flight's actual
    touchdown point and, if a landing target/zone were tagged, surface a "candidate precision
    landing" (measured distance-to-target) for the instructor to confirm or reject — but the
    signoff itself must stay instructor-gated, matching USHPA's rule.
  - P2's 8-hour ground-school theory requirement isn't flight data at all and would need separate
    manual logging (by the pilot or instructor) rather than any kind of auto-calculation.

  **Shape of the build** (for future planning, not decided here): new `Flight` fields — `notes`
  (free text), `flightType` (solo/tandem/tow), `instructorId` (a `Profile` relation, constrained
  to accepted friends via the existing `lib/social/friends.ts` model). A new `InstructorNote`
  model, separate from the pilot's own flight notes, editable only by the assigned instructor and
  visible only to instructor + pilot (never public). A new rating-criterion/signoff model
  tracking per-pilot progress per task — auto-computed criteria refreshed from flight data,
  instructor-marked criteria stored as an explicit signoff record (which instructor, when). A new
  page (e.g. `/ratings`) aggregating both into a per-rating-level progress view.

## Codebase facts seeded to every drafting/critique agent (verified this session, not re-derived)

- `lib/social/friends.ts`'s `listFriends(profileId)` is the ready-made accepted-friends list
  for an instructor picker; `areFriends()` also exists (duplicated once more inline in
  `lib/flights/repo.ts`).
- `Flight.notes` (free-text, owner-only) was just added this session — the direct precedent
  for how a new nullable column + owner-scoped edit action + edit-page card should look.
  No `flightType` or `instructorId`-like field exists yet.
- `lib/flights/repo.ts`'s `statsFrom()` is a pure, in-memory reducer over `FlightListItem[]`
  (not a DB aggregation query) — its site-diversity fallback-key idiom (dedupe on id, falling
  back to a name-keyed string when the row was deleted) is the direct precedent for a ratings
  engine's distinct-flying-days / distinct-gliders reducers. `glider` is not yet in the
  `FlightListItem` projection.
- `Site` already has `countryCode`/`region` but no inland/coastal attribute — confirms P4's
  "≥3 inland of 5 sites" sub-criterion isn't auto-calculable without new data.
- The flight-edit page's field-editing idiom (`app/flights/[id]/edit/{page.tsx,actions.ts,
  notes-editor.tsx}`) — a bound server action shaped `(flightId, prevState, formData) =>
  {error?, ok?}`, paired with a `useActionState` client component, rendered as its own Card —
  is the pattern a new "Flight type" / "Instructor" field should follow.
- `app/logbook/page.tsx` + `components/logbook/stats-bar.tsx` is the closest existing
  precedent for a `/ratings` progress-summary page.
- Aggregation/privacy-sensitive logic like `statsFrom` is tested via DB-backed
  `test/*.integration.test.ts`, not mocked unit tests — the convention a ratings auto-calc
  engine should follow.
