# SPRINT-003 — Merge Notes

Consensus: `consensus(opus-4.8, gpt-5.5)` per the weather report. Gemini was
unavailable (CLI `IneligibleTierError`), so this is a two-model consensus +
cross-critique + human interview. Both drafts independently converged on the same
core architecture; the **interview overrode the central relationship decision**.

## Draft strengths carried forward
- **Claude draft:** the fully-worked `repo.ts` resolver code (fail-closed
  `getFlightForViewer`, `visibleVisibilitiesFor`, feed query shape); the
  graph-first → visibility-depends-on-it PR ordering; the deliberate
  **no-denormalized-count** choice (compute via `groupBy`) to avoid drift in a
  security sprint; the pure unit-tested visibility predicate.
- **Codex draft:** DB **CHECK constraints** as a backstop (visibility enum,
  no self-relationship); explicit indexing tuned to access patterns; the crisp
  use-case table; the emphasis that track/replay/photo subresources inherit
  visibility and must authorize through the repo.

## Critiques accepted (folded into the final plan)
1. **Ingest path** must honor a `"friends"` default — today `ingest-flight.ts`
   maps non-`public` → `private`, so a friends default would silently become
   private. → central `lib/flights/visibility.ts` normalizer used by ingest,
   settings, visibility action, onboarding.
2. **Runtime validation** of visibility in write actions (typed params are
   compile-time only). DB CHECK is a backstop, not input validation.
3. **Prisma v6 cannot express CHECK in `schema.prisma`** → hand-written raw SQL in
   the migration; document the expected `migrate diff` drift so it isn't "fixed".
4. **Per-viewer caching:** profile + feed render dynamically / `no-store`, never
   publicly cached (the highest-leverage leak). DoD item.
5. **`getFlightForViewer` must preserve owner-sees-all-statuses** — do not bolt
   `status = ready` onto the single-flight gate (media routes depend on the owner
   seeing non-ready flights).
6. **Engagement metadata is an existence oracle** — kudos read APIs are
   viewer-scoped; hidden and nonexistent flights return the same result.
7. **Subresource privacy tests** for `/api/flights/[id]/{track,replay,photos}`;
   document the short `private` cache TTL stale-window on un-friend (accept it or
   set `no-store` for non-public).
8. **Feed:** composite keyset cursor `(flightDate, takeoffAt, id)`, bounded limit,
   join against the relationship table (no giant `IN`), add
   `Flight(ownerId, status, flightDate)` index.
9. **CI must provision Postgres** so the privacy matrix actually runs (skipping =
   false green; the one thing this sprint can't tolerate).
10. **Direct `prisma.flight` audit** allows owner-scoped writes (photo POST/DELETE)
    and flags only unscoped display reads — not a blunt grep.
11. **DB-level no-self-relationship** guard; **self-kudos disallowed**.

## Critiques noted but de-scoped (with reason)
- **Kudos count denormalization / reconciliation** (Codex): we keep counts
  **computed** (Claude) for v1 — no `kudosCount` column, no drift, no transaction
  ceremony. Denormalize later behind a measured need.
- **Follow/kudos rate-limiting & abuse throttle:** named as an explicit risk/non-goal
  for v1 (notifications deferred reduces impact); structured logging only.

## Interview refinements (override both drafts)
- **Relationship model = explicit Friendship (request → accept), bidirectional**
  — NOT mutual-follow, and **no separate asymmetric follow**. This is the single
  biggest change from both drafts. `"friends only"` = accepted friends; the
  **feed** = accepted friends' flights.
- A minimal **friend-requests inbox** (accept / decline) is in scope — it is
  intrinsic to request/accept, distinct from the deferred general notifications.
- **Comments → SPRINT-004.** **Notifications deferred** (design emit hooks only).
- **Follower/following → friends list + counts are public.**

## Net effect on the plan vs. the drafts
- `Follow`/mutual-follow is replaced by `Friendship { requesterId, addresseeId,
  status }`. `areMutualFollows` → `areFriends` (accepted row in either direction).
- The feed simplifies: friendship is symmetric, so the feed is just "ready
  public+friends flights whose owner ∈ my accepted friends" — no back-edge math.
- Adds a friend-request **inbox** surface (PR1) the drafts didn't have.
- Everything else (repo-only enforcement, kudos gating, no-cache, central
  normalizer, CI matrix) carries over.
