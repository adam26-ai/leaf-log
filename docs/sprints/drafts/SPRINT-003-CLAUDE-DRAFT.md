# SPRINT-003 (Claude draft) — Social foundation: follow, friends-only, kudos, feed

> Independent draft for the competitive drafting workflow. Scope: the first social
> slice of Leaf Log. Built on the intent in `drafts/SPRINT-003-INTENT.md`.

## Overview

This sprint stands up the **social graph** and the engagement primitives that turn
Leaf Log from a private logbook into a Strava-esque companion, and — critically —
**unblocks the deferred `"friends only"` flight-visibility tier**. The headline
architectural commitment is that the new social relationships flow through the same
discipline that already protects flights: **every flight read stays inside the
viewer-scoped repo (`lib/flights/repo.ts`), and "friends only" is resolved there and
nowhere else.** Pages and actions never compute who-can-see-what; they pass a
`viewerId` and trust the repo.

Two semantic decisions anchor the whole sprint and are made up front (see
[Open Questions](#open-questions) for the rationale and the alternatives):

1. **Follow is asymmetric and unapproved** (Strava-style): you follow a pilot and it
   takes effect immediately, no request/accept. This drives the **feed**.
2. **"Friends" = a mutual follow.** A flight set to `"friends"` visibility is visible
   to viewer *V* (other than the owner) **iff *V* follows the owner AND the owner
   follows *V* back.** There is no separate "friend request" object — friendship is
   *derived* from two reciprocal `Follow` rows. This keeps the model to one edge type
   while giving a precise, testable predicate for the security-sensitive tier.

**Committed scope (this sprint):**

1. Follow / unfollow another pilot; follower & following counts and follow-state on
   the profile page.
2. `"friends only"` visibility, enforced in `repo.ts`, with integration tests proving
   a non-mutual viewer is denied.
3. Kudos (thumbs-up) on a flight: toggle, count, who-kudosed — gated by visibility.
4. A following feed of recent **visible** flights from pilots you follow.

**Trailing / cuttable (this sprint, last PR):**

5. Comments on a flight (post, list, delete-own, owner-remove, length + rate limit).
   Self-contained behind its own migration so it can slip to SPRINT-004 without
   disturbing the rest.

**Explicitly out of scope (future sprints):**

- **"Fly together" combined timelines** — design *sketch only*, see
  [Future design sketch](#future-design-sketch-fly-together). Not built.
- Notifications (in-app or email) on follow / kudos / comment. The data hooks exist;
  the surface is deferred.
- Block / mute / report and richer moderation. Minimum viable rate + length limits
  on comments only.
- Quote/reply threads, kudos on comments, rich text, mentions.

**Why this slice, in this order:** the follow graph is the foundation everything else
reads from, and the friends-only resolver is the single most security-sensitive change
in the product. We build the graph first, then make the visibility tier depend on it
(with exhaustive tests), then layer the lower-risk engagement features (kudos, feed)
on top. Comments — which add the only real abuse surface — come last and are cuttable.

## Use Cases

1. **Follow a pilot.** On `/@handle`, an authenticated pilot taps **Follow**; the
   button flips to **Following** and the owner's follower count increments. Tapping
   again unfollows. You cannot follow yourself (no button on your own profile).
2. **See relationship at a glance.** Any profile shows **N followers · M following**
   and, for the viewer, the current follow state.
3. **Share with friends only.** A pilot sets a flight (or their default) to
   **Friends only**. It now appears to mutual-follow pilots on the flight page, the
   owner's profile, and those pilots' feeds — and to no one else.
4. **A mutual sees a friends-only flight; a stranger does not.** Pilot A and B follow
   each other. A's friends-only flight is visible to B. Pilot C, who only follows A
   (not mutual), gets a 404-equivalent. Anonymous visitors get nothing.
5. **Give kudos.** On a flight they can see, a pilot taps the thumbs-up; the count
   increments and they appear in the who-kudosed list. Tapping again removes it. You
   cannot kudos a flight you cannot see.
6. **Browse the feed.** `/feed` shows recent, ready, **visible** flights from pilots
   you follow, newest first, paginated. Friends-only flights appear only from pilots
   who follow you back. Your own flights are excluded.
7. **(Cuttable) Comment.** On a visible flight, a pilot posts a short comment; lists
   existing comments with author + time; can delete their own; the flight owner can
   remove any comment on their flight. Comments are length- and rate-limited.

## Architecture

### Prisma data model

`visibility` is a free-form `String` on `Flight` (`"private" | "public"` today), so
adding `"friends"` requires **no DB migration** — only app-layer validation and the
repo resolver. The three new social relations are additive tables.

```prisma
// ---- Social graph: asymmetric follow ----
model Follow {
  followerId String   // the pilot doing the following
  followeeId String   // the pilot being followed
  follower   Profile  @relation("Following", fields: [followerId], references: [id], onDelete: Cascade)
  followee   Profile  @relation("Followers", fields: [followeeId], references: [id], onDelete: Cascade)
  createdAt  DateTime @default(now())

  @@id([followerId, followeeId]) // one edge per ordered pair; toggling is idempotent
  @@index([followeeId])          // "who follows X" (follower count, mutual lookups)
}

// ---- Kudos (thumbs-up) ----
model Kudos {
  flightId  String
  profileId String
  flight    Flight   @relation(fields: [flightId], references: [id], onDelete: Cascade)
  profile   Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([flightId, profileId]) // at most one kudos per pilot per flight
  @@index([profileId])        // "flights X kudosed" (future)
}

// ---- Comments (trailing / cuttable PR) ----
model Comment {
  id        String   @id @default(cuid())
  flightId  String
  authorId  String
  flight    Flight   @relation(fields: [flightId], references: [id], onDelete: Cascade)
  author    Profile  @relation(fields: [authorId], references: [id], onDelete: Cascade)
  body      String   // validated app-layer: 1..1000 chars, trimmed, non-empty
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([flightId, createdAt])
}
```

Relations added to existing models (back-references only — no column changes on the
rows themselves, so list queries stay light):

```prisma
model Profile {
  // ...existing...
  following Follow[]  @relation("Following") // edges where this profile is the follower
  followers Follow[]  @relation("Followers") // edges where this profile is the followee
  kudos     Kudos[]
  comments  Comment[]
}

model Flight {
  // ...existing... visibility stays `String`; "friends" is now a third legal value
  kudos    Kudos[]
  comments Comment[]
}
```

**Deliberately NOT denormalized:** no `kudosCount` / `commentCount` columns on
`Flight`. Counts are computed with a single `groupBy` over the visible flight ids per
render (feed, profile, detail). This avoids transactional drift bugs in a
security-sensitive sprint; denormalize later behind a measured need.

**Integrity guards (app-layer, matching the no-RLS philosophy):**

- **No self-follow:** `followerId !== followeeId` checked in `follows.ts` before
  insert. (Optional DB `CHECK` constraint via raw migration is noted as a hardening
  follow-up; not required this sprint.)
- **Idempotent toggles:** follow/kudos use the composite PK with `upsert` / delete, so
  double-taps and races converge instead of erroring.

#### Migrations

- **PR1** (`follow_graph`): create `Follow` + indexes.
- **PR3** (`kudos`): create `Kudos` + indexes.
- **PR5** (`comments`, cuttable): create `Comment` + index.
- **PR2** (friends-only): **no migration** — `"friends"` is a string value, enforced in
  validation + repo. (Railway runs `prisma migrate deploy` pre-release; each PR ships
  its own migration so deploys stay forward-only.)

### Viewer-scoping changes to `lib/flights/repo.ts`

This is the security core. All friends resolution lives here.

```ts
/**
 * Friendship is DERIVED, not stored: two pilots are "friends" iff they follow each
 * other. This is the ONLY place "friends only" visibility is resolved.
 */
export async function areMutualFollows(a: string, b: string): Promise<boolean> {
  if (a === b) return true; // an owner is trivially "friends" with themself (not reached on the friends path, but safe)
  const count = await prisma.follow.count({
    where: {
      OR: [
        { followerId: a, followeeId: b },
        { followerId: b, followeeId: a },
      ],
    },
  });
  return count === 2; // both directions present
}

/** Visibility values a viewer is allowed to see for a given owner. */
async function visibleVisibilitiesFor(ownerId: string, viewerId: string | null): Promise<string[]> {
  if (viewerId && viewerId === ownerId) return ["public", "friends", "private"];
  const allowed = ["public"];
  if (viewerId && (await areMutualFollows(viewerId, ownerId))) allowed.push("friends");
  return allowed; // strangers & anon: ["public"] only
}
```

`getFlightForViewer` gains the friends branch (fail-closed — anything not explicitly
allowed returns `null`):

```ts
export async function getFlightForViewer(flightId, viewerId): Promise<Flight | null> {
  const flight = await prisma.flight.findUnique({ where: { id: flightId } });
  if (!flight) return null;
  if (flight.visibility === "public") return flight;
  if (viewerId && flight.ownerId === viewerId) return flight;          // owner sees all
  if (flight.visibility === "friends" && viewerId && (await areMutualFollows(viewerId, flight.ownerId))) {
    return flight;                                                      // mutuals see friends-only
  }
  return null;                                                          // private, or non-mutual friends-only → denied
}
```

New viewer-scoped list to replace the un-scoped `listPublicFlights` on the profile
page (the page must now pass a viewer):

```ts
/** A pilot's profile flights, scoped to what THIS viewer may see. */
export async function listProfileFlightsForViewer(ownerId, viewerId): Promise<FlightListItem[]> {
  const visibilities = await visibleVisibilitiesFor(ownerId, viewerId);
  return prisma.flight.findMany({
    where: { ownerId, status: "ready", visibility: { in: visibilities } },
    orderBy: [{ flightDate: "desc" }, { takeoffAt: "desc" }],
    select: LIST_SELECT,
  });
}
```

`listPublicFlights` is retained for genuinely anonymous/SEO surfaces but the
profile page switches to `listProfileFlightsForViewer(profile.id, viewerId)`.

The **feed** query — friends resolution baked into the WHERE clause, never in the
page:

```ts
/** Recent visible flights from pilots the viewer follows. Friends-only included
 *  only from pilots who follow the viewer back. Excludes the viewer's own flights. */
export async function listFeedForViewer(viewerId, { limit, cursor }): Promise<FlightListItem[]> {
  const following = await prisma.follow.findMany({
    where: { followerId: viewerId }, select: { followeeId: true },
  });
  const followingIds = following.map((f) => f.followeeId);
  if (followingIds.length === 0) return [];

  const backedges = await prisma.follow.findMany({
    where: { followerId: { in: followingIds }, followeeId: viewerId }, // who follows me back
    select: { followerId: true },
  });
  const mutualIds = backedges.map((f) => f.followerId);

  return prisma.flight.findMany({
    where: {
      status: "ready",
      OR: [
        { ownerId: { in: followingIds }, visibility: "public" },
        { ownerId: { in: mutualIds },    visibility: "friends" }, // [] ⇒ matches nothing (fail-closed)
      ],
    },
    orderBy: [{ takeoffAt: "desc" }, { id: "desc" }],
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: LIST_SELECT,
  });
}
```

> Note: `{ in: [] }` in Prisma matches zero rows, so a pilot with no mutuals simply
> never receives friends-only flights — the safe default falls out of the query shape.

### New `lib/social/` repos (mirror the `lib/flights/repo.ts` pattern)

- **`lib/social/follows.ts`** — `follow(followerId, followeeId)` (rejects self-follow,
  upsert), `unfollow(...)` (delete), `isFollowing(viewerId, ownerId)`,
  `countFollowers(profileId)`, `countFollowing(profileId)`. `areMutualFollows` lives in
  `repo.ts` (it's part of the read-authz surface) and is re-exported here for callers.
- **`lib/social/kudos.ts`** — `toggleKudos(flightId, viewerId)` **after** asserting
  `getFlightForViewer(flightId, viewerId)` is non-null; `countKudos(flightId)`,
  `listKudos(flightId)` (profiles), `hasKudosed(flightId, viewerId)`,
  `kudosCountsFor(flightIds)` (groupBy for feed/lists).
- **`lib/social/comments.ts`** (PR5) — `addComment(flightId, authorId, body)` (visibility
  asserted first; body validated + rate-limited), `listComments(flightId, viewerId)`
  (visibility asserted), `deleteComment(commentId, viewerId)` (author **or** flight
  owner).

Pure relationship/visibility predicates (e.g. `canSee(visibility, isOwner, isMutual)`)
are factored into a tiny **`lib/social/visibility.ts`** with **unit tests**, keeping
the DB-touching code thin and the truth table directly testable.

### Server actions & UI

- **Follow:** `app/[handle]/follow-action.ts` (`"use server"`) → `follow`/`unfollow`,
  `revalidatePath('/@'+handle)`. `components/social/follow-button.tsx` (client) with
  optimistic toggle.
- **Profile page** (`app/[handle]/page.tsx`): resolve `viewerId` via
  `getCurrentUserId()`, render counts + follow button, swap to
  `listProfileFlightsForViewer`.
- **Kudos:** `app/flights/[id]/kudos-action.ts`; `components/flight/kudos-button.tsx`
  on the flight detail page; who-kudosed list.
- **Visibility option:** add **Friends only** to the flight visibility toggle
  (`app/flights/[id]/visibility-action.ts` accepts `"friends"`) and to the default in
  `app/settings/` + onboarding; validate the enum centrally.
- **Feed:** `app/feed/page.tsx` (Server Component, auth-gated via `proxy.ts`), "Feed"
  link in `components/app-header.tsx`, reuse `components/logbook/flight-row.tsx`.
- **Comments (PR5):** `app/flights/[id]/comment-action.ts` +
  `components/flight/comments.tsx`.

## Implementation (ordered, small, non-overlapping PRs)

Each PR is independently shippable, ships its own migration (where needed), and passes
all gates (`build`, `test`, `typecheck`, `lint`, `e2e`).

### PR1 — Follow graph
- Migration `follow_graph`: `Follow` model + `Profile` back-relations.
- `lib/social/follows.ts` (follow/unfollow/isFollowing/counts) + self-follow guard.
- `follow-action.ts`, `follow-button.tsx`, follower/following counts on `/@handle`.
- Integration tests: follow → count up; unfollow → count down; double-follow
  idempotent; self-follow rejected; `isFollowing` correctness.
- **No visibility change.** Profile still lists public flights only.

### PR2 — Friends-only visibility (security PR)
- Add `"friends"` to the central visibility enum/validation + types; accept it in
  `visibility-action.ts`, settings default, onboarding.
- `repo.ts`: `areMutualFollows`, `visibleVisibilitiesFor`, friends branch in
  `getFlightForViewer`, new `listProfileFlightsForViewer`.
- `app/[handle]/page.tsx`: pass `viewerId`, use the viewer-scoped list.
- UI: **Friends only** option in the flight toggle + default-visibility selector.
- Integration tests (the heart of the sprint): mutual sees friends-only; one-way
  follower denied; non-follower denied; anonymous denied; owner always sees;
  flipping a follow flips visibility; private still owner-only.
- Depends on PR1.

### PR3 — Kudos
- Migration `kudos`: `Kudos` model + relations.
- `lib/social/kudos.ts` (toggle gated by `getFlightForViewer`; counts; who-kudosed).
- `kudos-action.ts` + `kudos-button.tsx` + who-kudosed list on flight detail.
- Integration tests: toggle on/off idempotent; count correct; **cannot kudos a flight
  you can't see** (private and non-mutual friends-only both rejected); who-kudosed
  lists only actual kudosers.
- Depends on PR2 (uses `getFlightForViewer` for the friends case).

### PR4 — Following feed
- `listFeedForViewer` in `repo.ts` (keyset/cursor pagination, friends resolved in
  WHERE), `kudosCountsFor` batch counts.
- `app/feed/page.tsx` + "Feed" nav link; empty-state ("Follow some pilots…").
- Integration tests: feed shows public flights from followed pilots; shows
  friends-only **only** from mutuals; excludes private; excludes own flights;
  excludes non-ready; pagination is stable & non-overlapping.
- E2E happy-path: follow → friends-only flight appears in feed → kudos.
- Depends on PR1 + PR2.

### PR5 — Comments (trailing, cuttable)
- Migration `comments`: `Comment` model + index.
- `lib/social/comments.ts` (add/list/delete; visibility asserted; body 1..1000 chars;
  simple per-author rate limit — e.g. ≤N comments / rolling window, enforced by a
  count query).
- `comment-action.ts` + `comments.tsx` on flight detail.
- Integration tests: comment requires visibility; list scoped to visible flight;
  author can delete own; flight owner can remove any; non-author/non-owner cannot;
  over-length rejected; rate limit trips.
- Depends on PR2. **If the sprint runs hot, cut this PR — nothing else depends on it.**

## Files Summary

**New**
- `lib/social/follows.ts`, `lib/social/kudos.ts`, `lib/social/comments.ts` (PR5),
  `lib/social/visibility.ts` (+ `visibility.test.ts`)
- `components/social/follow-button.tsx`
- `components/flight/kudos-button.tsx`, `components/flight/comments.tsx` (PR5)
- `app/[handle]/follow-action.ts`
- `app/flights/[id]/kudos-action.ts`, `app/flights/[id]/comment-action.ts` (PR5)
- `app/feed/page.tsx`
- `test/social.integration.test.ts` (follow + kudos authz),
  `test/feed.integration.test.ts`, additions to `test/privacy.integration.test.ts`
  (friends-only matrix)
- `prisma/migrations/*follow_graph/`, `*kudos/`, `*comments/`

**Modified**
- `prisma/schema.prisma` — `Follow`, `Kudos`, `Comment`; back-relations on
  `Profile`/`Flight`
- `lib/flights/repo.ts` — `areMutualFollows`, `visibleVisibilitiesFor`,
  friends branch in `getFlightForViewer`, `listProfileFlightsForViewer`,
  `listFeedForViewer`
- `app/[handle]/page.tsx` — viewer-scoped flights, follow button, counts
- `app/flights/[id]/page.tsx` + `visibility-action.ts` — kudos/comments UI; accept
  `"friends"`
- `app/settings/*`, onboarding — **Friends only** default option + central validation
- `components/app-header.tsx` — Feed nav link
- `proxy.ts` — `/feed` is an authenticated route

## Definition of Done

- [ ] A pilot can follow/unfollow another; profiles show follower/following counts and
      the viewer's follow state; self-follow is impossible.
- [ ] `"friends only"` visibility works end-to-end and is enforced **only** in
      `lib/flights/repo.ts`; integration tests prove a non-mutual viewer (anon,
      one-way follower, stranger) cannot read a friends-only flight, and a mutual can.
- [ ] Kudos toggle + count + who-kudosed work and are gated by visibility (cannot
      kudos an unseeable flight).
- [ ] The `/feed` shows only visible, ready flights from followed pilots, paginated,
      excluding own flights; friends-only only from mutuals.
- [ ] (If not cut) comments post/list/delete-own/owner-remove with length + rate
      limits and visibility-gating.
- [ ] No flight read for display bypasses the viewer-scoped repo. `grep` confirms no
      `prisma.flight.find*` for display outside `repo.ts`.
- [ ] All gates green: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`,
      `pnpm e2e`. E2E happy-path (follow → friends-only visible → kudos) passes.
- [ ] "Fly together" remains a documented future sketch; no code shipped for it.
- [ ] `/qa-prompt` handed to the validator partner.

## Risks

- **Friends-only mis-resolution (highest).** A logic slip turns a private flight
  public to followers. *Mitigation:* single resolver in `repo.ts`, fail-closed
  default, exhaustive truth-table integration tests, a unit-tested pure predicate.
- **Page-level bypass.** A new social surface queries `prisma.flight` directly and
  skips the resolver. *Mitigation:* DoD grep gate; PR review checklist; all reads go
  through `repo.ts`.
- **Feed query correctness with empty sets.** Empty `following`/`mutual` arrays must
  fail closed. *Mitigation:* explicit early-return + `{ in: [] }` matches-nothing
  semantics, covered by tests.
- **Count drift if denormalized later.** Avoided this sprint by computing counts; a
  conscious deferral, noted so a future PR doesn't silently re-introduce drift.
- **Comment abuse surface.** Only real user-content surface. *Mitigation:* length +
  rate limit now, owner-remove now, richer moderation deferred; PR is cuttable.
- **N+1 in feed.** Per-flight count queries. *Mitigation:* batch `kudosCountsFor`
  via `groupBy`.

## Security (privacy / authz)

- **The invariant:** "friends only" — like "private" — is enforced **exclusively** in
  `lib/flights/repo.ts`. Pages and server actions never compute friendship or
  visibility; they obtain `viewerId` and call `getFlightForViewer` /
  `listProfileFlightsForViewer` / `listFeedForViewer`.
- **Friendship is derived** (two reciprocal `Follow` rows) and resolved by
  `areMutualFollows`, which is part of the read-authz surface and lives in `repo.ts`.
- **Fail-closed everywhere:** unknown/unhandled visibility → `null`; empty follow sets
  → no rows; non-mutual friends-only → denied. The default is "deny", and a new
  visibility value that isn't wired returns nothing rather than leaking.
- **Mutations are authz-gated by reads:** kudos and comments first assert
  `getFlightForViewer(...) !== null`, so you can only engage with a flight you can
  actually see. Comment deletion requires author **or** flight owner.
- **Follow actions** are self-scoped: the follower id is always the session user, never
  taken from the request body.
- **Tests are the contract:** every visibility/permission path gets an integration
  test (allowed AND denied directions). The privacy suite gains the full friends-only
  matrix; a new social suite covers kudos/comment authz and feed scoping.
- Edge-split auth stays Prisma-free in `lib/auth.config.ts`; none of the new repos are
  imported by `proxy.ts`.

## Dependencies

- **Internal:** PR2 depends on PR1 (needs the follow graph); PR3 & PR4 depend on PR2
  (use the friends-aware `getFlightForViewer`); PR5 depends on PR2. Build strictly in
  order PR1 → PR2 → {PR3, PR4} → PR5.
- **External / stack:** none new. Prisma v6 (pinned), NextAuth v5, Postgres on
  Railway. No new packages — UI uses existing `components/ui/*` primitives. Resend is
  already wired but intentionally untouched (notifications deferred).
- **Data/seed:** extend `prisma/seed` (or test setup) with ≥2 mutually-following
  pilots and a third one-way follower to exercise the matrix manually and in E2E.

## Open Questions

1. **Follow semantics — RESOLVED as a recommendation:** asymmetric, unapproved follow
   for the feed; **"friends" = mutual follow** for the visibility tier. Alternative
   considered: an explicit request/accept `Friendship` object. Rejected for sprint 1 —
   it doubles the relationship model and adds an approval UI for marginal benefit;
   derived-mutual is precise and cheap. *Confirm before building PR2.* If the product
   later wants approval-gated follows (private accounts), it layers on top without
   changing the friends predicate.
2. **Comments in this sprint?** Included as the **trailing, cuttable PR5**. Confirm
   whether to commit to it or pre-cut to SPRINT-004.
3. **Notifications:** deferred. The hooks (kudos/comment/follow events) exist as
   natural emit points; no surface built. Confirm defer.
4. **Abuse/safety minimum:** comment length + per-author rate limit + owner-remove
   only. Block/mute/report deferred. Confirm this is enough for sprint 1.
5. **Feed surface:** new `/feed` route (recommended — clean nav, paginatable) vs. a tab
   on `/logbook`. Recommendation: dedicated `/feed`.
6. **Feed pagination:** keyset on `(takeoffAt, id)` recommended over offset for
   stability; confirm acceptable for sprint 1 (vs. simple `take`/`skip`).
7. **Should the owner's own profile show friends-only/private flights to the owner?**
   Recommendation: yes (owner sees all their ready flights on their own profile);
   `visibleVisibilitiesFor` already encodes this.

## Future design sketch — "fly together"

*Not built this sprint. Recorded so the data model doesn't foreclose it.*

The goal: when two pilots flew the same flight (same air, same time), show a combined
"flew with" badge and, eventually, both tracks on one timeline. A workable later design:

- **Detection** is a derived, post-ingest pass (it already fits the `ingest-flight.ts`
  seam): two ready flights are *co-flights* when their time windows overlap **and**
  their tracks are spatially proximate for a meaningful fraction of that overlap
  (e.g. bounding-box intersection → sampled point-distance under a threshold over ≥X%
  of shared time).
- **Storage:** a symmetric `CoFlight` edge (`flightAId`, `flightBId`, `overlapS`,
  `score`), computed in the background, never user-asserted.
- **Privacy is the hard part and stays in `repo.ts`:** a co-flight link is only
  surfaced if the viewer may *already* see the other flight under the existing rules.
  The badge must never reveal the existence of a private/friends-only flight to someone
  not entitled to it — i.e. co-flight discovery is filtered through
  `getFlightForViewer` exactly like everything else.
- **UI:** a "flew with @handle" chip on the flight page and, later, an optional
  dual-track overlay on the map. Combined timeline is its own sprint.

Open design questions for that sprint: thresholds & false-positive tuning;
whether detection runs synchronously at ingest or as a sweep; and how to present
co-flights the viewer is *not* entitled to see (answer: not at all).
