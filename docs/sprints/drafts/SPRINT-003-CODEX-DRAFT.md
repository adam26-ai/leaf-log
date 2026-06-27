# Overview

Sprint 003 starts Leaf Log's social foundation with a deliberately narrow first slice: asymmetric follows, reciprocal-friend visibility, kudos, and a following feed. Comments, notifications, blocking/reporting, and combined "fly together" timelines stay out of Sprint 003 unless explicitly pulled forward.

The core security decision is that `friends only` is resolved by mutual follows, not by one-way following. A pilot can follow another pilot without approval, but that alone only affects the follower's feed. A flight with `visibility = "friends"` is visible only to the owner and to viewers where both follow rows exist:

- viewer follows owner: `Follow(followerId = viewerId, followingId = ownerId)`
- owner follows viewer: `Follow(followerId = ownerId, followingId = viewerId)`

This gives Leaf Log Strava-like lightweight follows while keeping the privacy tier conservative. The UI may call these "friends", but the data model remains an asymmetric follow graph.

Combined "fly together" timelines are a future design sketch only. Sprint 003 should not add flight grouping tables, matching jobs, or shared timeline rendering.

# Use Cases

- As a signed-in pilot, I can follow and unfollow another pilot from their `@handle` page.
- As any visitor, I can see a pilot's public ready flights on their profile.
- As a signed-in mutual friend, I can see that pilot's public and friends-only ready flights on their profile and flight detail pages.
- As a one-way follower, I can see the other pilot's public ready flights in my feed, but not their friends-only flights unless they also follow me.
- As a pilot, I can mark an uploaded flight `private`, `friends`, or `public`, and I can set the same three-way default for future uploads.
- As a viewer who can see a flight, I can toggle a single kudos/thumbs-up on that flight and see the count and recent kudos list.
- As a signed-in pilot, I can view a following feed of recent ready flights from people I follow, filtered through the same viewer-scoped flight rules.
- Out of scope for this sprint: flight comments, email/in-app notifications, block/mute/report workflows, and fly-together combined timelines.

# Architecture

Prisma data model:

Keep visibility stored as strings for the smallest migration from the current schema, but make the allowed values explicit in TypeScript helpers and database check constraints.

```prisma
model Profile {
  id              String       @id // == User.id (1:1)
  user            User         @relation(fields: [id], references: [id], onDelete: Cascade)
  handle          String       @unique
  displayName     String
  bio             String?
  defaultVisibility String     @default("private") // private | friends | public
  avatarUpdatedAt DateTime?
  avatar          Avatar?
  homeSiteId      String?
  homeSite        Site?        @relation("HomeSite", fields: [homeSiteId], references: [id], onDelete: SetNull)
  flights         Flight[]
  following       Follow[]     @relation("ProfileFollowing")
  followers       Follow[]     @relation("ProfileFollowers")
  flightKudos     FlightKudo[]
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
}

model Flight {
  id          String       @id @default(cuid())
  ownerId     String
  owner       Profile      @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  visibility  String       @default("private") // private | friends | public
  kudosCount  Int          @default(0)
  kudos       FlightKudo[]
  // existing fields remain unchanged
}

model Follow {
  id          String   @id @default(cuid())
  followerId  String
  followingId String
  follower    Profile  @relation("ProfileFollowing", fields: [followerId], references: [id], onDelete: Cascade)
  following   Profile  @relation("ProfileFollowers", fields: [followingId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())

  @@unique([followerId, followingId])
  @@index([followerId, createdAt])
  @@index([followingId, createdAt])
}

model FlightKudo {
  flightId  String
  profileId String
  flight    Flight   @relation(fields: [flightId], references: [id], onDelete: Cascade)
  profile   Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([flightId, profileId])
  @@index([flightId, createdAt])
  @@index([profileId, createdAt])
}
```

Migrations:

- Add `Follow` and `FlightKudo` tables with cascading deletes.
- Add `Flight.kudosCount Int NOT NULL DEFAULT 0`.
- Add check constraints:
  - `Flight.visibility IN ('private', 'friends', 'public')`
  - `Profile.defaultVisibility IN ('private', 'friends', 'public')`
  - `Follow.followerId <> Follow.followingId`
- Add the unique/indexes shown above.
- Backfill is limited to `kudosCount = 0`; existing `private` and `public` values remain valid.
- Do not add `FlightGroup`, `FlightParticipant`, or track-overlap tables in this sprint.

Viewer-scoping changes to `lib/flights/repo.ts`:

- Add a shared `type FlightVisibility = "private" | "friends" | "public"` and constants used by settings/actions/forms.
- Replace the current fetch-then-check `getFlightForViewer` implementation with a single scoped query:
  - visible if `visibility = "public"`
  - visible if `viewerId != null AND ownerId = viewerId`
  - visible if `viewerId != null AND visibility = "friends" AND viewer and owner are mutual followers`
- Add `listProfileFlightsForViewer(ownerId, viewerId)` for profile pages. It returns only `status = "ready"` flights visible to that viewer.
- Keep `listPublicFlights(ownerId)` only for explicitly anonymous/public-only contexts, or make it a thin call to `listProfileFlightsForViewer(ownerId, null)`.
- Keep `listOwnFlights(ownerId)` owner-only and unchanged in visibility breadth.
- Add `listFollowingFeed(viewerId, limit, cursor?)` in this repo, not in page code. The query selects ready flights whose owner is followed by the viewer and then applies the same visible-flight predicate. This means public flights from followed pilots appear for one-way follows, while friends-only flights appear only for mutual follows.
- Pages and route handlers must not reimplement visibility predicates. `app/[handle]/page.tsx`, flight detail, track/replay/photo routes, and feed routes should call repo functions that already enforce visibility.

# Implementation

1. PR 1 - Social schema and relationship repo
   - Update `prisma/schema.prisma`.
   - Add the migration for follows, kudos, `kudosCount`, and check constraints.
   - Add `lib/social/follows.ts` with `followProfile`, `unfollowProfile`, `getFollowState`, `countFollowersFollowing`, and `areMutualFriends`.
   - Add integration tests for follow/unfollow uniqueness, no self-follow, cascade cleanup, counts, and mutual-friend detection.

2. PR 2 - Friends visibility in the flight repo
   - Update `lib/flights/repo.ts` with the shared visibility predicate, `getFlightForViewer`, `listProfileFlightsForViewer`, and `listFollowingFeed`.
   - Update flight visibility actions and settings default visibility handling to accept `private | friends | public`.
   - Update ingestion so `defaultVisibility = "friends"` is preserved for new flights.
   - Add integration tests proving anonymous, one-way follower, mutual friend, owner, and unrelated signed-in viewer behavior for public/private/friends flights.

3. PR 3 - Profile follow UI and viewer-aware profile flights
   - Update `app/[handle]/page.tsx` to resolve the optional viewer session and call `listProfileFlightsForViewer`.
   - Add a server action for follow/unfollow.
   - Show follower/following counts and a follow/unfollow button for signed-in non-self viewers.
   - Keep public profile stats based only on the visible ready flights returned by the repo.

4. PR 4 - Kudos on visible flights
   - Add `lib/social/kudos.ts` with `toggleKudo`, `listFlightKudos`, and count reconciliation helpers.
   - Gate all kudos mutations by `getFlightForViewer(flightId, viewerId)`.
   - Add a compact kudos control on the flight detail page.
   - Add integration tests for auth required, invisible flight denied, duplicate toggle behavior, count updates, and owner-visible/private behavior.

5. PR 5 - Following feed
   - Add a protected `/feed` route that calls `listFollowingFeed(viewerId, ...)`.
   - Add a feed link in the authenticated app header.
   - Reuse existing `FlightRow`-style presentation and include owner/avatar context.
   - Add tests proving the feed excludes private flights, excludes one-way friends-only flights, includes mutual friends-only flights, and includes public flights from followed pilots.

6. PR 6 - End-to-end hardening and release pass
   - Add a Playwright happy path: A follows B, B follows A, B posts friends-only flight, A can open it, A kudos it, unrelated C cannot open it.
   - Run required gates: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm e2e`.
   - Update seed data only if needed for deterministic local QA.

# Files Summary

- `prisma/schema.prisma` - add social relations, `Follow`, `FlightKudo`, `Flight.kudosCount`, and document `friends` visibility.
- `prisma/migrations/*/migration.sql` - add tables, indexes, defaults, and check constraints.
- `lib/flights/repo.ts` - the only place where friends-only flight visibility is resolved for reads.
- `lib/social/follows.ts` - follow/unfollow/count/state/mutual-friend operations.
- `lib/social/kudos.ts` - kudos toggle/list/count operations.
- `app/[handle]/page.tsx` - viewer-aware profile display and follow controls, with no local visibility filtering.
- `app/[handle]/follow-action.ts` or colocated action module - follow/unfollow server action.
- `app/flights/[id]/page.tsx` and small `components/flight/*` additions - kudos UI on already-authorized flight detail.
- `app/flights/[id]/visibility-action.ts` - accept `friends` as an owner-only visibility value.
- `app/settings/*` - allow `friends` as the default upload visibility.
- `lib/ingest/ingest-flight.ts` - preserve `friends` default visibility.
- `app/feed/page.tsx` - protected following feed.
- `components/app-header.tsx` - authenticated feed navigation.
- `test/privacy.integration.test.ts` - friends visibility matrix.
- `test/social.integration.test.ts` - follows and kudos behavior.
- `tests/e2e/*` or existing Playwright suite - one social happy path.

# Definition of Done

- A pilot can follow and unfollow another pilot without approval.
- Follower/following counts and follow state are visible on profile pages.
- `friends` is available as a flight visibility and profile default visibility.
- Friends-only flights are visible only to the owner and mutual followers.
- Friends-only visibility is enforced inside `lib/flights/repo.ts`; no page, route, or component owns that rule.
- Kudos can be toggled by signed-in viewers who can see the flight, with correct count behavior.
- The following feed shows only ready flights from followed pilots that are visible to the current viewer.
- Integration tests cover the full visibility matrix and feed/kudos authorization.
- Playwright covers the social happy path with at least two mutual friends and one unrelated denied viewer.
- No comments, notifications, block/mute/report, or fly-together implementation ships in this sprint.

# Risks

- Privacy regression: the biggest risk is a page or route querying `prisma.flight` directly and bypassing mutual-friend visibility.
- Semantic mismatch: users may assume "following" means "friend"; the UI must distinguish one-way follow state from mutual friendship where needed.
- Query complexity: mutual-follow checks can make profile/feed queries slower without the `Follow` unique/index pairs.
- Count drift: `Flight.kudosCount` can drift from `FlightKudo` rows if toggles are not transactional.
- Scope creep: comments and fly-together both introduce moderation, rate limits, and timeline semantics that can easily dominate the sprint.
- Cache leakage: track/replay/photo responses must continue to authorize through `getFlightForViewer`; friends-only assets should not be cached as public.

# Security

- Privacy/authz rule: `friends only` MUST be enforced in `lib/flights/repo.ts`, never in pages.
- A friends-only flight is readable when `viewerId === ownerId` or when the viewer and owner have reciprocal active `Follow` rows. One-way follows do not grant access.
- Anonymous viewers can read only public ready flights.
- Signed-in unrelated viewers can read public flights only.
- A viewer who follows an owner can see that owner's public flights in the feed, but cannot see friends-only flights unless the owner follows them back.
- `getFlightForViewer`, `listProfileFlightsForViewer`, and `listFollowingFeed` are the supported display-read entry points. Track, replay, photo, kudos, and future comment reads must authorize the parent flight through these functions.
- Kudos mutations must first prove the viewer can see the flight through `getFlightForViewer`; direct `FlightKudo` writes by flight id are not acceptable.
- Follow mutations require an authenticated session and must reject self-follow.
- Profile metadata remains public, but private/friends-only flight totals must not leak through public stats. Stats must be computed from the repo-filtered visible flight list.
- Return not-found style failures for invisible flights where existing app behavior does so; do not reveal that a private or friends-only flight id exists.

# Dependencies

- Existing NextAuth v5 session plumbing for identifying `viewerId`.
- Existing Prisma v6 setup and Railway `migrate deploy` flow.
- Existing viewer-scoped flight repo and photo/track/replay routes that already depend on `getFlightForViewer`.
- Existing settings, ingestion, and flight visibility action surfaces.
- Existing app header/navigation patterns.
- Local Postgres for integration tests and Playwright social scenarios.

# Open Questions

- Should the UI label reciprocal follows as "friends" explicitly, or only expose "follow/following" while using mutual follows silently for privacy?
- Should profile pages show friends-only flights to mutual friends by default, or should there be a visible filter/tab between public and friends-visible flights?
- Should a pilot receive any in-app signal when someone follows them, or is that deferred with notifications?
- Should kudos lists show all pilots who kudosed or only a small recent subset plus count?
- Should comments move into Sprint 004 as the next social slice, with owner moderation and rate limits from the start?
- Future design sketch only: fly-together can later be modeled as detected overlap between separate `Flight` rows using time-window and track-proximity heuristics, probably with an explicit `FlightGroup`/participant table after the matching rules are validated. No schema or UI for that should be added in Sprint 003.
