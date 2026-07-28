# SPRINT-003 — Social foundation: friends, friends-only flights, kudos, feed

> Produced by the multi-agent sprint-planning workflow
> (`consensus(opus-4.8, gpt-5.5)` + cross-critique + interview). Drafts, critiques,
> and merge notes are in [`drafts/`](./drafts/). Intent:
> [`drafts/SPRINT-003-INTENT.md`](./drafts/SPRINT-003-INTENT.md).

## Overview

This sprint turns Leaf Log from a private logbook into a social companion. It
stands up the **friend graph** (request → accept), unblocks the deferred
**`"friends only"`** flight-visibility tier, adds **kudos** (thumbs-up), and a
**friends feed**.

Two decisions anchor the sprint:

1. **Friendship is explicit and bidirectional** (chosen in the planning
   interview, overriding the drafts' mutual-follow recommendation): you send a
   friend request, the other pilot accepts, and you are friends both ways. There
   is **no separate asymmetric "follow."** A flight set to `"friends"` visibility
   is visible to the owner and to **accepted friends** — nobody else.
2. **`"friends only"` is resolved in exactly one place — `lib/flights/repo.ts`** —
   matching the project's no-RLS, app-layer privacy model. Pages, route handlers,
   and server actions never compute who-is-a-friend or who-can-see-what; they pass
   a `viewerId` and trust the repo. This is the single most security-sensitive
   change in the product and the discipline is non-negotiable.

**Committed scope:**
1. Send / accept / decline / cancel friend requests; remove a friend; a
   **requests inbox**; friend/friends counts and state on profiles.
2. `"friends only"` visibility, enforced in `repo.ts`, with an exhaustive
   integration matrix proving non-friends (anonymous, pending, stranger) are denied
   and friends are allowed.
3. **Kudos** on a flight you can see: toggle, count, who-kudosed — visibility-gated.
4. A **friends feed** of recent visible flights from your accepted friends.

**Explicitly out of scope (later sprints):**
- **Comments** → SPRINT-004 (the main moderation/abuse surface; ships as the next
  social slice).
- **Notifications** (in-app/email on request/accept/kudos) — design the emit hooks,
  build no surface. *Exception:* the friend-**requests inbox** is in scope because
  accept/decline is intrinsic to request/accept, not a notification system.
- **Block / mute / report**, rate-limit throttles (named as a risk; structured
  logging only).
- **"Fly together" combined timelines** — design sketch only (see end). Not built;
  no flight-grouping tables.

**Why this order:** the friend graph is the foundation the visibility tier reads
from, so it ships first (PR1) with its full UI. The friends-only resolver is the
security core and ships second (PR2) with the exhaustive matrix. The lower-risk
engagement features — kudos (PR3) and feed (PR4) — layer on top.

## Use Cases

1. **Send a friend request.** On `/@handle`, a signed-in pilot taps **Add friend**;
   the button becomes **Requested**. You cannot friend yourself.
2. **Accept / decline.** The addressee sees the request in their **Requests inbox**
   (`/friends`) and accepts (→ friends both ways) or declines (→ request removed).
   The requester can cancel a pending request.
3. **Reciprocal request auto-accepts.** If B already has a pending request to A and
   A sends one to B, they become friends immediately (no duplicate row).
4. **Remove a friend.** Either friend can remove the friendship; friends-only
   access drops on the next read.
5. **See relationship at a glance.** Any profile shows **N friends** (count, public)
   and a browsable friends list (public), plus the viewer's state (Add friend /
   Requested / Respond / Friends).
6. **Share with friends only.** A pilot sets a flight (or their upload default) to
   **Friends only**. It now appears to accepted friends on the flight page, the
   owner's profile, and their feeds — and to no one else.
7. **A friend sees it; a stranger does not.** A and B are friends. A's friends-only
   flight is visible to B. A pending-but-not-accepted pilot C, a stranger, and an
   anonymous visitor all get a not-found-equivalent.
8. **Give kudos.** On a flight they can see, a pilot toggles the thumbs-up; the
   count updates and they appear in the who-kudosed list. You cannot kudos a flight
   you cannot see, nor your own flight.
9. **Browse the feed.** `/feed` shows recent, ready, **visible** flights from your
   accepted friends, newest first, paginated, excluding your own.

## Architecture

### Prisma data model

`Flight.visibility` / `Profile.defaultVisibility` stay free-form `String`; adding
`"friends"` needs **no column migration** — only the central normalizer + the repo
resolver + a backstop CHECK. Two additive tables: `Friendship`, `Kudo`.

```prisma
// ---- Friend graph: explicit request → accept, bidirectional ----
// One directed row per ordered (requester, addressee) pair. "Are A and B friends?"
// = an accepted row exists in EITHER direction. Keeping requester/addressee (vs a
// canonical lo/hi pair) lets the inbox show who must respond.
model Friendship {
  requesterId String
  addresseeId String
  status      String    // "pending" | "accepted"   (decline/cancel = row deleted)
  requester   Profile   @relation("SentFriendRequests", fields: [requesterId], references: [id], onDelete: Cascade)
  addressee   Profile   @relation("ReceivedFriendRequests", fields: [addresseeId], references: [id], onDelete: Cascade)
  createdAt   DateTime  @default(now())
  respondedAt DateTime?

  @@id([requesterId, addresseeId])
  @@index([addresseeId, status]) // inbox: pending requests TO me; friend lookups
  @@index([requesterId, status]) // outgoing pending; friend lookups
}

// ---- Kudos (thumbs-up) ----
model Kudo {
  flightId  String
  profileId String
  flight    Flight   @relation(fields: [flightId], references: [id], onDelete: Cascade)
  profile   Profile  @relation(fields: [profileId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@id([flightId, profileId])     // at most one kudo per pilot per flight
  @@index([flightId, createdAt])  // who-kudosed, newest first
}
```

Back-relations only (no column changes on hot rows, so list queries stay light):

```prisma
model Profile {
  // ...existing...
  sentFriendReqs     Friendship[] @relation("SentFriendRequests")
  receivedFriendReqs Friendship[] @relation("ReceivedFriendRequests")
  kudos              Kudo[]
}
model Flight {
  // ...existing... visibility stays String; "friends" is now a third legal value
  kudos Kudo[]
  // add index for the feed (see below)
  @@index([ownerId, status, flightDate])
}
```

**Raw-SQL backstops appended to the generated migrations** (Prisma v6 cannot
represent CHECK in `schema.prisma` — these will show as `migrate diff` drift;
**that is expected — do not delete them to "fix" the drift**, document in the
migration):
- `Flight.visibility IN ('private','friends','public')`
- `Profile.defaultVisibility IN ('private','friends','public')`
- `Friendship`: `"requesterId" <> "addresseeId"` (no self-friendship)

**Deliberately NOT denormalized:** no `kudosCount` column. Counts come from a
single `groupBy` over already-authorized flight ids. Avoids drift/transaction
ceremony in a security sprint; denormalize later behind a measured need.

### The visibility core — `lib/flights/repo.ts`

A new **`lib/flights/visibility.ts`** holds the single source of truth:

```ts
export const FLIGHT_VISIBILITIES = ["private", "friends", "public"] as const;
export type FlightVisibility = (typeof FLIGHT_VISIBILITIES)[number];
export function normalizeVisibility(v: unknown): FlightVisibility {
  return (FLIGHT_VISIBILITIES as readonly string[]).includes(v as string)
    ? (v as FlightVisibility) : "private"; // fail-closed default
}
// pure, unit-tested truth table:
export function canSee(v: FlightVisibility, isOwner: boolean, isFriend: boolean): boolean {
  if (isOwner) return true;
  if (v === "public") return true;
  if (v === "friends") return isFriend;
  return false; // private (or unknown) → deny
}
```

Friendship resolution lives in the repo (it is read-authz):

```ts
/** Accepted friendship in EITHER direction. The ONLY place "friends" resolves. */
export async function areFriends(a: string, b: string): Promise<boolean> {
  if (a === b) return false; // owner is handled by a separate branch
  const n = await prisma.friendship.count({
    where: {
      status: "accepted",
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
  });
  return n > 0;
}
```

`getFlightForViewer` — **preserves owner-sees-all-statuses** (owner branch returns
before any `status` filter; media routes rely on this for non-ready flights):

```ts
export async function getFlightForViewer(flightId, viewerId): Promise<Flight | null> {
  const flight = await prisma.flight.findUnique({ where: { id: flightId } });
  if (!flight) return null;
  if (viewerId && flight.ownerId === viewerId) return flight;        // owner: any status
  if (flight.visibility === "public") return flight;
  if (flight.visibility === "friends" && viewerId &&
      (await areFriends(viewerId, flight.ownerId))) return flight;   // accepted friends
  return null;                                                        // private / non-friend → deny
}
```

New viewer-scoped reads (replace the un-scoped `listPublicFlights` on the profile
page; `listPublicFlights` is retained **only** for anonymous/SEO and is the thin
`listProfileFlightsForViewer(ownerId, null)`):

```ts
async function visibleVisibilitiesFor(ownerId, viewerId): Promise<FlightVisibility[]> {
  if (viewerId && viewerId === ownerId) return ["public", "friends", "private"];
  const allowed: FlightVisibility[] = ["public"];
  if (viewerId && (await areFriends(viewerId, ownerId))) allowed.push("friends");
  return allowed; // strangers/anon: ["public"]
}
export async function listProfileFlightsForViewer(ownerId, viewerId) {
  const visibility = await visibleVisibilitiesFor(ownerId, viewerId);
  return prisma.flight.findMany({
    where: { ownerId, status: "ready", visibility: { in: visibility } },
    orderBy: [{ flightDate: "desc" }, { takeoffAt: "desc" }, { id: "desc" }], // id tiebreaker
    select: LIST_SELECT,
  });
}
```

**Feed** — friendship is symmetric, so the feed needs no back-edge math: ready
public+friends flights whose owner is an accepted friend, excluding self. Join
against `Friendship` (not a giant `IN`), composite keyset cursor, bounded limit:

```ts
export async function listFeedForViewer(viewerId, { limit, cursor }) {
  // friendIds via accepted Friendship in either direction (subquery/join, capped limit)
  // WHERE flight.ownerId IN friendIds AND status='ready' AND visibility IN ('public','friends')
  //       AND ownerId <> viewerId               // defense-in-depth
  // ORDER BY flightDate DESC, takeoffAt DESC, id DESC
  // keyset: cursor encodes (flightDate, takeoffAt, id); limit clamped to <= 50
}
```

### New `lib/social/` repos

- **`lib/social/friends.ts`** — `sendRequest(meId, targetId)` (rejects self;
  rejects if a row exists either direction; **if a reverse pending row exists,
  accept it** instead of creating a duplicate), `acceptRequest(meId, requesterId)`
  (addressee only), `declineRequest` / `cancelRequest` (delete), `removeFriend(a,b)`,
  `listFriends(profileId)`, `countFriends(profileId)`, `listIncomingRequests(meId)`,
  `friendStateFor(viewerId, profileId)` → `"self"|"none"|"outgoing"|"incoming"|"friends"`.
  `areFriends` lives in `repo.ts` (read-authz surface); `friends.ts` imports it (no
  re-export back, to avoid a cycle).
- **`lib/social/kudos.ts`** — `toggleKudo(flightId, viewerId)` **after** asserting
  `getFlightForViewer(...) !== null` and `ownerId !== viewerId` (no self-kudos);
  viewer-scoped reads `kudoSummaryForViewer(flightId, viewerId)` (count + hasKudoed +
  recent N), and internal `kudoCountsFor(authorizedFlightIds)` (groupBy) for lists.

### Server actions & UI

- **Friend actions:** `app/[handle]/friend-action.ts` (`"use server"`) →
  send/accept/decline/cancel/remove, `revalidatePath('/@'+handle)` + `/friends`.
  `components/social/friend-button.tsx` (client, optimistic) renders by
  `friendStateFor`.
- **Requests inbox:** `app/friends/page.tsx` — friends list + incoming/outgoing
  pending requests with accept/decline/cancel. Auth-gated (`proxy.ts`), `no-store`.
  "Friends" link in `components/app-header.tsx` / account menu.
- **Profile page** (`app/[handle]/page.tsx`): resolve `viewerId`, render friend
  count + button, swap to `listProfileFlightsForViewer`. **Dynamic per session, never
  publicly cached.**
- **Visibility option:** add **Friends only** to the flight visibility toggle and
  the settings/onboarding default; all writes go through `normalizeVisibility` +
  runtime allowlist; ingest honors a `"friends"` default.
- **Kudos:** `app/flights/[id]/kudos-action.ts` + `components/flight/kudos-button.tsx`
  + who-kudosed list on the flight detail page.
- **Feed:** `app/feed/page.tsx` (Server Component, auth-gated, `no-store`), "Feed"
  nav link, reuse `components/logbook/flight-row.tsx`.

## Implementation (ordered, small, non-overlapping PRs)

Each PR ships its own migration (where needed) and passes all gates
(`build`, `test`, `typecheck`, `lint`, `e2e`).

### PR1 — Friend graph + requests inbox
- Migration `friend_graph`: `Friendship` + indexes + raw-SQL no-self-friend CHECK.
- `lib/social/friends.ts` (send/accept/decline/cancel/remove/list/counts/state),
  with the reverse-pending auto-accept and self-guard.
- `friend-action.ts`, `friend-button.tsx`, friend count + state on `/@handle`,
  `/friends` inbox page + nav link.
- **No flight-visibility change** — friends exist but don't yet gate anything.
- Integration tests: request → pending; accept → friends both ways; decline/cancel;
  reverse-pending auto-accepts (no dup); self-request rejected; remove; `areFriends`
  + `friendStateFor` correctness; cascade on profile delete.

### PR2 — Friends-only visibility (the security PR)
- `lib/flights/visibility.ts` (normalizer + `canSee` + unit tests).
- Runtime allowlist validation in `visibility-action.ts` **and**
  `app/settings/actions.ts` (replaces the binary `=== "public"` coercion);
  onboarding default; **`lib/ingest/ingest-flight.ts` honors `"friends"`**.
- `repo.ts`: `areFriends`, `visibleVisibilitiesFor`, friends branch in
  `getFlightForViewer` (owner-all-status preserved), `listProfileFlightsForViewer`
  (+ `id` tiebreaker); `listPublicFlights` becomes the thin anon call.
- `app/[handle]/page.tsx`: pass `viewerId`, viewer-scoped list, **dynamic/no-store**;
  stats computed from the repo-filtered list.
- Raw-SQL visibility CHECK constraints (documented drift).
- Tests (**heart of the sprint**): the full matrix — owner (incl. non-ready),
  friend, pending-not-friend, stranger, anonymous × public/friends/private — on the
  flight gate AND on `/api/flights/[id]/{track,replay,photos[/photoId]}`; ingest
  honors friends default; revocation (remove friend → next read denies); profile
  rows + stats per viewer class.
- Depends on PR1.

### PR3 — Kudos
- Migration `kudos`: `Kudo` + index.
- `lib/social/kudos.ts` (toggle gated by `getFlightForViewer`; no self-kudos;
  viewer-scoped summary; groupBy counts).
- `kudos-action.ts` + `kudos-button.tsx` + who-kudosed (recent N + count) on detail.
- Tests: toggle idempotent; **cannot kudos an unseeable flight** (private +
  non-friend friends-only both denied, indistinguishable from nonexistent); no
  self-kudos; count + who-kudosed correct; concurrent double-toggle converges.
- Depends on PR2.

### PR4 — Friends feed + release pass
- `listFeedForViewer` (keyset cursor `(flightDate,takeoffAt,id)`, bounded limit,
  join-not-IN, `Flight(ownerId,status,flightDate)` index), `kudoCountsFor` batch.
- `app/feed/page.tsx` + "Feed" nav; empty state; **no-store**.
- Tests: feed shows friends' public+friends ready flights; excludes private,
  non-ready, own, and non-friends; pagination stable across identical `flightDate`
  and across a friendship change mid-page.
- **E2E happy path:** A & B friend each other → B posts a friends-only flight → A
  opens it and kudos it → unrelated C is denied.
- Depends on PR1 + PR2 (+ PR3 for the kudos step of the E2E).

## Files Summary

**New:** `lib/flights/visibility.ts` (+ test), `lib/social/friends.ts`,
`lib/social/kudos.ts`, `components/social/friend-button.tsx`,
`components/flight/kudos-button.tsx`, `app/[handle]/friend-action.ts`,
`app/flights/[id]/kudos-action.ts`, `app/friends/page.tsx`, `app/feed/page.tsx`,
`test/social.integration.test.ts`, `test/feed.integration.test.ts`,
`prisma/migrations/*friend_graph/`, `*kudos/`.

**Modified:** `prisma/schema.prisma` (`Friendship`, `Kudo`, relations, Flight feed
index), `lib/flights/repo.ts` (areFriends, visibleVisibilitiesFor, friends gate,
profile + feed reads), `app/[handle]/page.tsx`, `app/flights/[id]/page.tsx` +
`visibility-action.ts`, `app/settings/actions.ts` + onboarding,
`lib/ingest/ingest-flight.ts`, `components/app-header.tsx`, `proxy.ts`
(`/feed`, `/friends` protected), `test/privacy.integration.test.ts` (friends matrix).

## Definition of Done

> **Status: complete.** Shipped in PRs #21–#24 (+ #25 What's New, #26 friend search)
> and deployed to production. Boxes below were re-verified against `main` on
> 2026-07-27; the code references after each item are where the behaviour lives.

- [x] Send/accept/decline/cancel/remove friends works; reverse-pending auto-accepts;
      self-request impossible; requests inbox at `/friends`; friend count + state on
      profiles; friends list + counts public.
      *(`lib/social/friends.ts`, `app/friends/`, `app/[handle]/friend-action.ts`)*
- [x] `"friends only"` works end-to-end and is enforced **only** in
      `lib/flights/repo.ts`. The integration matrix proves: friend allowed; pending,
      stranger, anonymous denied; owner sees all incl. non-ready; **subresources**
      (track/replay/photos) match; removing a friend denies on next read.
      *(`test/privacy.integration.test.ts`, `test/social.integration.test.ts`)*
- [x] Central `normalizeVisibility` + **runtime** allowlist used by settings,
      onboarding, visibility action, and **ingest** (friends default persists);
      DB CHECK backstops present and the Prisma-v6 drift is documented.
      *(`lib/flights/visibility.ts` + `visibility.test.ts`, migration
      `20260627121000_friends_visibility_checks`)*
- [x] Profile + feed render **dynamically per viewer / `no-store`**, never publicly
      cached; profile stats computed from the repo-filtered list.
      *(`export const dynamic = "force-dynamic"` in `app/[handle]/page.tsx` and
      `app/feed/page.tsx`; stats from `listProfileFlightsForViewer`)*
- [x] Kudos toggle + count + who-kudosed work, visibility-gated; **no self-kudos**;
      counts computed (no denormalized column).
      *(`lib/social/kudos.ts` — every entry point goes through `getFlightForViewer`
      first and `toggleKudo` rejects `flight.ownerId === viewerId`)*
- [x] `/feed` shows only visible, ready flights from accepted friends, paginated
      (stable keyset, `id` tiebreaker), excluding own.
      *(`lib/flights/repo.ts` `decodeFeedCursor`/`feedCursorWhere`,
      `test/feed.integration.test.ts`)*
- [x] No unscoped flight **display read** outside `repo.ts` — audited allowlist
      (owner-scoped writes like photo POST/DELETE are permitted); derived tables
      (Kudo, track, photos) only returned after the parent flight is authorized.
      *(Audit re-run 2026-07-27: the only `prisma.flight.*` calls outside `repo.ts`
      are owner-scoped writes — visibility/delete actions, photo POST/DELETE — plus
      the ingest path, which creates rather than displays.)*
- [x] **CI provisions Postgres so the privacy matrix actually runs** (not skipped).
      *(`.github/workflows/ci.yml` — `postgres:16-alpine` service + a `DATABASE_URL`
      env, in both the gates and e2e jobs, so the suites cannot silently auto-skip.)*
- [x] All gates green: `build`, `test`, `typecheck`, `lint`, `e2e` (the happy path).
      *(CI `gates` + `e2e (Playwright)` jobs, green on every merge through #31.)*
- [x] Comments, notifications, block/mute, "fly together" not shipped; "fly together"
      remains a documented sketch.
- [x] `/qa-prompt` handed to the validator partner.
      *(`docs/qa-prompts/QA-PROMPT-2026-06-27-social.md`, plus the follow-up
      `QA-PROMPT-2026-06-29-search-3d.md` covering friend search.)*

## Risks

- **Friends-only mis-resolution (highest).** A logic slip leaks a friends-only or
  private flight. *Mitigation:* single fail-closed resolver in `repo.ts`,
  unit-tested `canSee` truth table, exhaustive matrix incl. subresources, CI runs it.
- **Page/route bypass.** A new social surface queries `prisma.flight` directly.
  *Mitigation:* repo-only invariant; allowlisted audit (reads vs owner-writes);
  review checklist for derived tables.
- **Per-viewer cache leak.** A friend's profile/feed served to others.
  *Mitigation:* dynamic/`no-store` on profile + feed; documented stale-window on
  media TTL after un-friend (accepted, or `no-store` for non-public).
- **Visibility write of garbage / silent private.** *Mitigation:* central
  normalizer + runtime validation + ingest fix + DB CHECK.
- **Feed correctness at scale / empty sets.** *Mitigation:* join-not-IN, keyset
  pagination, bounded limit, `Flight(ownerId,status,flightDate)` index, empty-set
  fail-closed tests.
- **Abuse surface (no rate limits).** Follow/kudos churn, request spam.
  *Mitigation:* named non-goal for v1 + structured logging; notifications deferred
  blunts impact.

## Security (privacy / authz)

- **Invariant:** `"friends"` and `"private"` are enforced **exclusively** in
  `lib/flights/repo.ts`. Pages/actions obtain `viewerId` and call
  `getFlightForViewer` / `listProfileFlightsForViewer` / `listFeedForViewer`.
- **Friendship is read-authz:** `areFriends` (accepted row either direction) lives in
  `repo.ts`; fail-closed everywhere (unknown visibility, no friendship, anon → deny).
- **Mutations gated by reads:** kudos asserts `getFlightForViewer(...) !== null`
  first; the followee/requester ids come from the session, never the request body;
  hidden and nonexistent flights are indistinguishable in responses.
- **Subresources** (track/replay/photos) authorize the parent flight through the repo;
  non-public media is not publicly cacheable.
- **Tests are the contract**, and **CI must run them** (Postgres provisioned) or the
  security work is unverified.
- Edge-split auth stays Prisma-free in `lib/auth.config.ts`; new repos are not
  imported by `proxy.ts`.

## Dependencies

- **Internal:** PR2 ⟵ PR1; PR3 ⟵ PR2; PR4 ⟵ PR1+PR2 (+PR3 for the E2E kudos step).
  Build PR1 → PR2 → PR3 → PR4.
- **External/stack:** none new. Prisma v6 (pinned), NextAuth v5, Postgres on Railway.
  No new packages; UI reuses `components/ui/*`. Resend untouched (notifications
  deferred). **CI needs a Postgres service** for the privacy suite.
- **Seed/test data:** ≥3 pilots — an accepted-friend pair and a third pending/stranger
  — to exercise the matrix and the E2E.

## Open Questions (resolved here; revisit only if product changes)
- Relationship model — **RESOLVED:** explicit Friendship (request/accept),
  friendship-only (no asymmetric follow).
- Comments — **deferred to SPRINT-004.** Notifications — **deferred** (hooks only;
  requests inbox in scope). Friends lists + counts — **public.**
- Self-kudos — **disallowed.** Kudos list — **recent N + count** (not full
  enumeration). Owner sees own friends-only/private flights on their own profile —
  **yes.**

## Future design sketch — "fly together" (NOT built)

When two pilots flew the same air at the same time, show a "flew with @handle" chip
and, later, both tracks on one timeline. Likely a derived post-ingest pass
(fits the `ingest-flight.ts` seam): two ready flights are co-flights when their time
windows overlap **and** tracks are spatially proximate for a meaningful fraction of
the overlap. Store a symmetric `CoFlight` edge (`flightAId`, `flightBId`, `overlapS`,
`score`), computed in the background, never user-asserted. **Privacy stays in
`repo.ts`:** a co-flight is surfaced only if the viewer may already see the other
flight under these rules — the chip must never reveal a flight the viewer isn't
entitled to. Its own sprint; thresholds/false-positive tuning and sync-vs-sweep are
open.
