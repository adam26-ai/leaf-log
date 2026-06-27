# SPRINT-003 — Intent: Social (Strava-esque) foundation

## Seed prompt
Start the social side of Leaf Log, Strava-esque: follow friends, share flights,
thumbs-up (kudos) and comment on each other's flights, and *eventually* show
combined "fly together" flights on the same timeline. This also unblocks the
deferred **"friends only"** flight-visibility tier.

## Orientation summary
- **Privacy is app-layer, no RLS.** Every flight read for display MUST go through
  the viewer-scoped repo `lib/flights/repo.ts` (`getFlightForViewer` /
  `listPublicFlights` / `listOwnFlights`). `Flight.visibility` is `"private" | "public"`
  today; `"friends"` was intentionally deferred pending a social model (noted in
  `prisma/schema.prisma` on `Profile.defaultVisibility` and in FEATURES.md).
- **Identity model:** `Profile` (id == `User.id`, 1:1) holds `handle` (unique),
  `displayName`, `bio`, `defaultVisibility`, `avatarUpdatedAt`, `homeSiteId`.
  Public profile page is `app/[handle]/page.tsx` (`/@handle`); auth is NextAuth v5
  with JWT sessions (edge-split config: `lib/auth.config.ts` read by `proxy.ts`
  without Prisma; full config in `lib/auth.ts`).
- **Data/UI patterns:** Next 16 App Router, Prisma v6 (pinned), Postgres. Server
  Components + Server Actions for mutations; route handlers for media/JSON. Files
  live in Postgres. Derived data is denormalized onto rows for fast lists. Custom
  UI primitives (`components/ui/*`), no heavy component libs.
- **Recent direction:** shipped profile settings + avatar + default privacy (#14),
  "keep me signed in" + `/` → `/logbook` redirect (#17), `/whats-new` + account
  dropdown (#19); deployed to Railway at https://leaflog.norcalflight.com.
- **Existing backlog hooks (FEATURES.md):** "Friends Only Visibility + Leaf-Device
  API token" (the deferred follow-ons), and the broader social vision is new.

## Relevant codebase areas
- `prisma/schema.prisma` — new social models (follows, kudos, comments,
  eventually flight-grouping for "fly together"); add `"friends"` to visibility.
- `lib/flights/repo.ts` — extend viewer scoping so a friend can see "friends"
  (and the friends-feed query). **The single most security-sensitive change.**
- New `lib/social/` repos (follows / kudos / comments), mirroring the repo pattern.
- UI: `app/[handle]/page.tsx` (follow button, counts), the flight detail page
  (`app/flights/[id]` + `components/flight/*`) for kudos + comments, a new
  **following feed** surface, the `/logbook` and header nav.
- `proxy.ts` protected routes; `components/app-header.tsx` / nav for a feed link.
- `lib/ingest/ingest-flight.ts` already honors `defaultVisibility`.

## Constraints / patterns to respect
- **No flight read bypasses the viewer-scoped repo.** Friends-only must be enforced
  in `repo.ts`, not in pages. Add tests to `test/*.integration.test.ts`.
- Prisma v6 pinned; NextAuth edge-split must stay Prisma-free in `auth.config.ts`.
- Pure logic unit-tested (`lib/`), DB-touching paths via integration tests
  (auto-skip without `DATABASE_URL`). Gates: build, test, typecheck, lint, e2e.
- Notifications/email: Resend is wired but keep new email surfaces minimal/opt-in.
- Migrations via `prisma migrate`; Railway runs `migrate deploy` pre-release.

## Success criteria (this milestone, to be sliced)
1. A pilot can **follow / unfollow** another pilot; profiles show follower/following
   counts and a follow state.
2. **"Friends only" visibility** works end-to-end and is enforced in the repo
   (with integration tests proving a non-friend cannot read a friends-only flight).
3. **Kudos** (thumbs-up) on a flight: toggle, count, who-kudosed.
4. **Comments** on a flight: post, list, delete own; basic moderation (owner can
   remove). Length/rate limits.
5. A **following feed** of recent visible flights from people you follow.
6. "Fly together" combined timeline is **explicitly scoped as a later sprint** with
   a design sketch, not built now.

## Verification strategy
- Integration tests for every visibility/permission path (friends-only read
  allowed/denied; kudos/comment authz; feed only shows visible flights).
- Unit tests for pure helpers (e.g., relationship/visibility predicates).
- E2E happy-path: follow → friends-only flight becomes visible → kudos → comment.
- Manual: two seeded pilots; verify counts, feed, and privacy.

## Uncertainty assessment
- **Correctness: Medium-High.** Privacy semantics for friends-only are
  security-sensitive; the follow graph defines who sees what. Must be exact.
- **Scope: High.** The vision spans several features + a hard "fly together"
  feature. First sprint must be sliced; sequencing matters.
- **Architecture: Medium.** Extends the established viewer-scoped repo + Profile
  model with a new social graph; mostly additive but touches the core read path.

## Open questions (for drafts + interview)
1. **Follow semantics:** asymmetric follow (Strava: follow without approval) vs.
   mutual-friends (request/accept)? Does **"friends only"** mean *my followers*,
   *people I follow*, *mutual follows*, or an explicit accepted friendship? (Strava:
   public/followers/only-me, with follow-approval for private athletes.)
   Recommendation to validate: **mutual-follow = "friends"** for the visibility tier,
   asymmetric follow for the feed.
2. **First-sprint scope:** follow + friends-only + kudos as the core; are **comments**
   and the **feed** in this sprint or the next?
3. **Notifications:** in scope (in-app and/or email on kudos/comment/follow), or
   defer? Default recommendation: defer to a follow-up, design the hook now.
4. **Abuse/safety:** block/mute, comment rate-limits, report — minimum viable now
   vs. later?
5. **"Fly together":** confirm it's a later sprint; what defines flying together
   (time + proximity overlap of tracks)? Design sketch only this sprint.
6. **Feed surface:** new `/feed` route vs. a tab on `/logbook`?
