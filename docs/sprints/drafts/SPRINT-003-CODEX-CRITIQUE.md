# Critique — SPRINT-003 (Codex draft)

Reviewed against `SPRINT-003-INTENT.md`, `CLAUDE.md`/`AGENTS.md`, `lib/flights/repo.ts`, and
the current read/route call sites (`app/[handle]/page.tsx`, `app/flights/[id]/page.tsx`,
`app/api/flights/[id]/{track,replay,photos}/route.ts`, `lib/photos/repo.ts`,
`app/flights/[id]/visibility-action.ts`, `app/settings/actions.ts`, `prisma/schema.prisma`).

Verdict: **strong, well-scoped, security-aware plan that is safe to start, but it under-specifies
the two genuinely hard parts (the `getFlightForViewer` rewrite and the feed query), and its
Definition of Done has real holes around per-viewer caching, count integrity, and CI coverage of
the privacy matrix.** Fix those before execution; the rest is polish.

---

## 1. Strengths

- **Correct core security call.** "Friends = mutual follow, resolved in the repo" is the right,
  conservative model and matches the intent's recommendation. Stating both required `Follow` rows
  explicitly (§Overview lines 7–8) removes ambiguity that would otherwise leak access.
- **Scope discipline.** The explicit out-of-scope list (comments, notifications, block/mute/report,
  fly-together) and the standing instruction not to add `FlightGroup`/`FlightParticipant`/overlap
  tables (line 97) directly answer the intent's biggest stated risk (Scope: High).
- **Tests co-located with the dangerous change.** PR 2 ships the visibility matrix tests with the
  repo rewrite, not later. That is the correct sequencing for the single most security-sensitive
  change in the sprint.
- **Schema hygiene.** Cascades, `@@unique([followerId, followingId])`, the `followerId <> followingId`
  check, and the composite kudo PK are all correct and idempotent-friendly.
- **Risk section already names the top three real risks** (direct `prisma.flight` bypass, kudos
  count drift, cache leakage). That is more than most drafts surface.

---

## 2. Weaknesses & under-specification

### 2.1 The `getFlightForViewer` rewrite is asserted, not designed (PR 2)
The draft mandates replacing the current fetch-then-check (`repo.ts:26–35`) with "a single scoped
query" (lines 102–105) but never says **how**. This matters because:

- **Owner-sees-all-statuses must be preserved.** Today `getFlightForViewer` returns the flight to the
  owner regardless of `status` (used by the detail page and as the authz gate for track/replay/photo
  on `uploaded`/`processing`/`failed` flights). `listProfileFlightsForViewer` correctly filters
  `status = "ready"`, but the single-flight gate must **not** inherit that filter. A naïve unified
  predicate that bolts `status = ready` onto `getFlightForViewer` would break owner access to
  in-flight uploads. Call this out explicitly.
- **Prisma can't cleanly express "two reciprocal Follow rows exist" in one `findUnique`.** This will
  become either two relation `some` filters, two `count` lookups, or `$queryRaw`. The draft's "single
  scoped query" framing hides a real implementation decision. A defensible and arguably simpler
  alternative is to keep `findUnique` and add one indexed `areMutualFriends(viewerId, ownerId)` lookup
  (which PR 1 builds anyway) — equally safe, easier to read, and avoids a complex WHERE on the
  **media hot path** (every track/replay/photo request now pays the mutual-follow check). The draft
  should weigh this trade-off instead of asserting the rewrite is strictly better.

### 2.2 The feed query is described in prose only (PR 5)
`listFollowingFeed` is the second-hardest query and gets one sentence (line 109). Missing:

- **Cursor definition.** `flightDate` is not unique; a `cursor?` keyed on it will drop or duplicate
  rows at page boundaries. The cursor must be a composite `(flightDate, takeoffAt, id)` (matching the
  existing `orderBy` in `repo.ts:41`) with a stable tiebreaker, and `limit` must be bounded.
- **The visibility predicate inside the feed differs from the profile predicate.** It must encode:
  `owner ∈ {viewer follows}` AND (`visibility='public'` OR (`visibility='friends'` AND
  `owner ∈ {follows viewer back}`)), `status='ready'`, `visibility≠'private'`. That is a different
  shape from the single-flight gate and deserves its own SQL/Prisma sketch and its own test.
- **Index mismatch.** The feed orders by flight date, but the only `Follow` indexes proposed
  (`[followerId, createdAt]`, `[followingId, createdAt]`) are keyed on **follow** `createdAt`, which
  the feed never orders by. The feed will lean on a `Flight(ownerId, status, flightDate)` index that
  the draft does not add. Add it, or the feed degrades as the logbook grows.
- **Fan-out.** A pilot following thousands of people must not produce a giant `IN (...)`. Specify a
  join against `Follow`, not an id list.
- **Self-inclusion is undefined.** Strava's feed includes your own activities; this feed silently
  won't (you don't follow yourself). Decide and state it.

### 2.3 Server-action input validation is unaddressed
`visibility-action.ts:11–21` is typed `"private" | "public"` but performs **no runtime allowlist
check** — the typed param is a compile-time fiction; a server action receives arbitrary client input.
Today the DB has no CHECK constraint, so a crafted call could persist garbage. Widening to include
`"friends"` widens this surface. The plan must require a **runtime allowlist** (a shared
`FLIGHT_VISIBILITIES` constant + validation) in the action **and** the settings action
(`app/settings/actions.ts:32`, which currently hard-codes `=== "public"` binary coercion), not only
the DB CHECK constraint. The check constraint is a backstop, not input validation.

### 2.4 Prisma v6 + CHECK constraints: a known drift trap
Lines 91–94 say "add check constraints" but don't note that **Prisma v6 cannot represent CHECK
constraints in `schema.prisma`** — they must be hand-written raw SQL appended to the generated
`migration.sql`, and they will surface as schema drift on future `prisma migrate dev`/`migrate diff`.
Given `CLAUDE.md`'s hard-won Prisma-v6 pinning notes, this gotcha belongs in the plan with a one-line
mitigation (document the manual SQL block; expect/accept the diff warning) so the next agent doesn't
"fix" the drift by deleting the constraints.

---

## 3. Security / privacy holes in friends-only enforcement

### 3.1 The viewer-aware profile page becomes per-viewer but caching is never addressed (HIGH)
PR 3 switches `app/[handle]/page.tsx` from `listPublicFlights` (anonymous, line 29) to
`listProfileFlightsForViewer(ownerId, viewerId)`. The page's **content and stats now vary by viewer**
(a mutual friend sees friends-only flights and their totals; an anonymous visitor must not). Nothing
in the plan forces this page to render **dynamically per session** and to be excluded from any shared/
CDN cache. If it is ever statically cached or cached without `Vary` on the session, a friend's view
(or their friends-only totals via `statsFrom`) can be served to an anonymous visitor. This is a
concrete friends-only leak and must be a DoD item: profile and feed are `dynamic`/no-store, never
publicly cacheable.

### 3.2 Stale media access after unfriend (cache TTL) (MEDIUM)
`track/route.ts:34` sets `cache-control: private, max-age=60` and `replay/route.ts:50` sets
`private, max-age=300`. These are per-browser (good), but after an unfollow that revokes friendship,
a former friend's browser keeps replaying a friends-only track for up to 5 minutes. The draft's
"cache leakage" risk (line 188) only worries about *public* caching; it misses that even `private`
caches grant a stale window on revocation. Decide whether that window is acceptable for friends-only
assets (it likely is, but say so) or drop the TTL to 0 for non-public flights.

### 3.3 Follower/following *lists* vs. counts (MEDIUM)
DoD and §Security only cover follower/following **counts** and kudos lists. Who can view the **list**
of a pilot's followers/following is never decided. That list reveals the social graph (and, combined
with friends-only inference, who can see whose private flights). State the policy — counts public,
lists public-or-restricted — and, if lists ship, route them through a defined function rather than an
ad-hoc `prisma.follow.findMany` in page code (same bypass risk as flights).

### 3.4 No rate limiting / abuse surface acknowledged
Follow and kudos toggles have no rate limit and no debounce. Kudos toggle spam and follow/unfollow
churn are cheap write-amplification and (later) notification-farming vectors. Out of scope to *build*,
but it should be an explicit named non-goal/risk, not silently absent — the intent explicitly raised
abuse/safety as open question #4.

### 3.5 Photo POST/DELETE bypass is fine — but say so
For completeness: `photos/route.ts:34` and `photos/[photoId]/route.ts:43` query `prisma.flight`
directly. That is **acceptable** because they are owner-only mutations scoped by `ownerId === viewerId`
(not display reads). The privacy-bypass test/grep the plan relies on (Risk line 183) should be written
to **allow owner-scoped writes** and flag only unscoped *reads*, or it will produce false positives and
get disabled.

---

## 4. Data-model concerns

- **`kudosCount` integrity has no enforcement plan.** Drift is named as a risk (line 186) but no DoD
  item requires the toggle to be transactional (insert/delete + conditional `increment`/`decrement`
  derived from the actual row mutation, not a blind ±1), nor a reconciliation/repair path, nor a
  concurrency test. Add: toggle in a `prisma.$transaction`, count derived from the create/delete
  result, count clamped ≥ 0, and a test that double-toggle and concurrent toggles converge.
- **Kudos on your own flight is undefined.** `getFlightForViewer` returns the owner's flight, so the
  gate permits self-kudos. Strava forbids it. Decide and test.
- **`FlightKudo` has no `id`** (composite PK) — fine, but confirm no UI/code assumes a scalar id.
- **`listProfileFlightsForViewer` makes `statsFrom` viewer-variant.** The same `statsFrom` helper now
  yields different totals per viewer. That is intended, but the plan should note the existing
  "never their private totals" comment (`page.tsx:28`) must be rewritten and that public callers must
  keep passing the anonymous list.
- **Fate of `listPublicFlights` is left ambiguous** (lines 107: "keep … or make it a thin call").
  Pick one. Leaving both a real and a thin implementation invites a future caller to use the wrong one.

---

## 5. PR-sequencing issues

- **PR 2 is overloaded and is the dangerous one.** It bundles the repo rewrite, the new feed query,
  the visibility action, the settings action, ingestion, *and* the full matrix tests (lines 120–124).
  That is the highest-risk change with the widest blast radius in one PR. Recommend splitting:
  (2a) repo rewrite + `getFlightForViewer`/`listProfileFlightsForViewer` + matrix tests;
  (2b) write-side enablement (visibility action + settings + ingest + validation). The feed query
  (`listFollowingFeed`) is currently *defined* in PR 2 but only *used* in PR 5 — move its
  implementation and tests to PR 5 so it ships with its consumer.
- **No `friends` value can be written between PR 1 and PR 2b.** PR 1 adds the CHECK that *permits*
  `friends`, but the actions that *set* it land in PR 2. That's fine (no orphan data), but note it so
  no one tests "set friends" against PR 1 and reports a false failure.
- **Profile page lag is acceptable but undocumented.** Between PR 2 (friends-only readable) and PR 3
  (profile becomes viewer-aware), friends-only flights are reachable by direct URL but invisible on
  profiles. State this is intended interim behavior.

---

## 6. Missing edge cases

- Owner viewing **own non-ready** friends-only flight (status `uploaded`/`processing`/`failed`) — must
  remain visible to owner (see §2.1).
- **Mutual → unfollow mid-session**: friends-only access must drop on next read (modulo §3.2 cache).
- **Account deletion cascade**: verify `Follow`/`FlightKudo`/`Flight` all cascade off `Profile`
  deletion and that `kudosCount` on surviving flights isn't left stale when a kudo-er deletes.
- **Handle casing** in the follow target: profile lookup lowercases (`page.tsx:23`); the follow action
  must resolve the same way or follows silently target nothing.
- **Self-follow via direct action call** — guarded at DB and must also be rejected app-side (line 199 ✓,
  but add the test).
- **Empty/zero states**: no follows, no feed items, kudos count 0, your own profile shows no follow
  button (mentioned in impl line 129 but absent from DoD).
- **Feed pagination boundary** with identical `flightDate` (see §2.2).
- **Kudos list pagination/size** — open question #4 in the draft (line 217) is left unresolved; pick
  "recent N + count" so the endpoint can't be used to enumerate an entire friends-only audience.

---

## 7. Definition-of-Done completeness

The DoD (lines 170–179) is good on the happy path but is missing:

1. **Profile + feed render dynamically per viewer and are never publicly cached** (§3.1) — the single
   most important missing item.
2. **`kudosCount` is transactional, clamped ≥ 0, and reconcilable**, with a concurrency test (§4).
3. **Runtime visibility-value validation** in both write actions, independent of the DB CHECK (§2.3).
4. **CI actually runs the privacy matrix.** Integration tests auto-skip without `DATABASE_URL`
   (CLAUDE.md). If CI lacks Postgres, the entire friends-only matrix skips and the build is a false
   green — the one outcome this sprint cannot tolerate. DoD must assert the privacy suite **runs**
   (provisions Postgres) in CI, not merely that the tests exist.
5. **Feed cursor correctness / bounded limit** test (§2.2).
6. **Policy for follower/following list visibility** stated and enforced (§3.3).
7. **No unscoped flight *read* anywhere** — make the grep/lint a DoD gate, scoped to reads so it
   doesn't false-positive on owner writes (§3.5).
8. **Stale-access window on unfollow** documented and accepted (or TTL dropped) (§3.2).
9. **Self-kudos behavior** decided and tested (§4).

Items already well-covered: repo-only enforcement (line 174), the core read matrix (177), the two-
mutual-friends + denied-stranger e2e (178), and the explicit no-comments/no-fly-together guard (179).

---

## 8. Top fixes before execution (ranked)

1. **Add the per-viewer no-cache requirement** for profile + feed to DoD (§3.1). Highest-leverage leak.
2. **Specify `getFlightForViewer` rewrite** so owner-sees-all-statuses is preserved and the Prisma
   expression of "two reciprocal follows" is chosen deliberately (§2.1).
3. **Specify `listFollowingFeed`**: composite cursor, bounded limit, the exact friends-vs-public
   predicate, the `Flight(ownerId,status,flightDate)` index, join-not-IN (§2.2).
4. **Require runtime visibility validation** in both write actions; treat the DB CHECK as a backstop,
   and document the Prisma-v6 raw-SQL/drift caveat (§2.3, §2.4).
5. **Make `kudosCount` transactional + tested**, and decide self-kudos (§4).
6. **Guarantee the privacy matrix runs in CI** (Postgres provisioned), or the security work is unverified
   (§7.4).
7. **Split the overloaded PR 2** and move `listFollowingFeed` to ship with PR 5 (§5).
