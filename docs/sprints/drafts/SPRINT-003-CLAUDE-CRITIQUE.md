# SPRINT-003 Claude Draft Critique

## Summary

The draft is directionally strong: it identifies the right security boundary
(`lib/flights/repo.ts`), resolves the central product ambiguity with a concrete
mutual-follow definition, sequences the work in plausible PRs, and keeps "fly
together" out of scope. The biggest gaps are not in the broad architecture; they
are in the places where a privacy-sensitive social feature becomes stateful across
more surfaces than the draft accounts for: default visibility during ingest,
viewer-specific caching/revalidation, engagement metadata leaks, endpoint coverage
for track/replay/photos, and a too-simple grep-based Definition of Done.

The sprint plan should be tightened before implementation. In particular, PR2
must explicitly update the ingest path and all visibility normalization, PR3 must
make kudos metadata viewer-gated, PR4 must specify real keyset pagination and
viewer-specific cache behavior, and the DoD must verify subresource privacy and
direct Prisma exceptions rather than relying on a broad grep.

## Strengths

- The draft correctly treats "friends only" as the core security change, not as
  a UI option. Anchoring all display reads in `lib/flights/repo.ts` matches
  `CLAUDE.md` and the existing `lib/flights/repo.ts` privacy model.
- The mutual-follow definition is precise and testable. It avoids adding a second
  relationship model before the product has validated whether explicit friend
  requests are needed.
- The PR sequencing is mostly sensible: follow graph first, friends visibility
  second, then kudos/feed, with comments last and cuttable.
- The draft avoids building "fly together" and records only a future sketch. That
  is the right call because co-flight detection would add a second privacy problem:
  revealing the existence of flights a viewer cannot see.
- The test emphasis is good. The planned matrix for mutual, one-way follower,
  stranger, anonymous, owner, and private is exactly the right baseline for PR2.
- Deferring denormalized kudos/comment counts is reasonable for the first social
  slice. It reduces transaction complexity while the authorization model is still
  being proven.

## Major Weaknesses and Required Changes

### 1. PR2 omits `lib/ingest/ingest-flight.ts`, so default `"friends"` would not work

The draft says to add "Friends only" to the default visibility selector, but the
current ingest path only preserves `"public"` and maps every other value to
`"private"`:

```ts
const visibility = owner?.defaultVisibility === "public" ? "public" : "private";
```

If PR2 adds `"friends"` in settings without updating ingest, new uploads from a
pilot whose default is friends-only will silently become private. That is an
end-to-end failure of a committed use case.

Action:

- Add `lib/ingest/ingest-flight.ts` to PR2's modified files.
- Introduce one central visibility normalizer, for example
  `lib/flights/visibility.ts`, used by settings, onboarding if applicable,
  `visibility-action.ts`, `ShareToggle`, and ingest.
- Add an integration test: a profile with `defaultVisibility = "friends"` uploads
  or ingests a new flight and the stored `Flight.visibility` is `"friends"`.
- Update schema comments from `private | public` to include `friends`; comment-only
  schema changes do not need a DB migration, but they do need to be in the PR.

### 2. The "repo-only" invariant is too broad as written

The draft says pages and actions never compute visibility, and the DoD says grep
should confirm no `prisma.flight.find*` outside `repo.ts`. That will produce false
positives and may also miss real leaks.

Current code already has valid direct `prisma.flight.findUnique` calls outside
`repo.ts` for owner-only mutations, such as photo upload/delete ownership checks.
Those are not display reads. Conversely, a social repo such as
`listKudos(flightId)` could leak metadata without ever querying `prisma.flight`
directly if it is called before a viewer-gated flight read.

Action:

- Rewrite the invariant as: every flight or flight-derived display/read endpoint
  must call a viewer-scoped flight authorization API before returning data.
  Owner-scoped mutations may query `prisma.flight` directly only when the where
  clause or subsequent check constrains `ownerId` to the session user.
- Replace the grep-only DoD with an audited allowlist of direct flight queries:
  owner-only mutations, ingest/dedupe, tests, and repo internals.
- Add a review checklist item for derived data tables: `FlightData`, `Photo`,
  `PhotoData`, `Kudos`, and `Comment` must not be returned unless the parent
  flight has already been authorized for the viewer.

### 3. Engagement metadata can leak unless kudos/comment APIs take `viewerId`

The draft defines `countKudos(flightId)`, `listKudos(flightId)`, and
`hasKudosed(flightId, viewerId)`. `listKudos(flightId)` is unsafe as a general
API because it can reveal that a hidden flight exists and who interacted with it
if called from a route or component that has not first gated the flight.

The same applies to comments. A comments list, comment count, or delete path can
become an existence oracle if hidden flights return a different status, count, or
author list than nonexistent flights.

Action:

- Make read APIs viewer-scoped by default:
  `listKudosForViewer(flightId, viewerId)`,
  `kudosSummaryForViewer(flightId, viewerId)`,
  `listCommentsForViewer(flightId, viewerId)`.
- Keep batch APIs such as `kudosCountsFor(visibleFlightIds)` internal and document
  that callers must pass only IDs already returned by `repo.ts`.
- Ensure hidden and nonexistent flights return the same user-facing result for
  kudos/comment mutation attempts, typically a 404-equivalent or generic failure.
- Add denied tests for kudos count, who-kudosed, comment list, comment create, and
  comment delete on private and non-mutual friends-only flights.

### 4. Viewer-specific pages and subresources need explicit cache/revalidation rules

The draft does not analyze caching. That is a privacy risk because the same URL can
return different content based on viewer identity and follow state:

- `/@handle` can include public, friends-only, and possibly owner-private flights.
- `/feed` is entirely viewer-specific.
- `/flights/[id]` can be public, owner-only, or mutual-only.
- `/api/flights/[id]/track`, `/replay`, `/photos`, and photo bytes inherit the
  flight's visibility.

Current route handlers use `cache-control: private, max-age=60` or `300` on track,
replay, and photo bytes. That is acceptable for public/private today if the product
accepts short-lived local browser caching, but the draft should explicitly decide
what happens after unfollow, visibility downgrade, or a friendship break. At a
minimum, shared/proxy caching must never be possible, and server-rendered profile
or feed pages must not be statically cached across viewers.

Action:

- In PR2, mark viewer-specific pages/routes dynamic or no-store according to the
  current Next 16 guidance in `node_modules/next/dist/docs/`.
- Revalidate or avoid caching on follow/unfollow and visibility changes for:
  the actor's feed, the owner profile, the viewer profile, and the flight page.
- Add tests or manual QA steps for revocation: mutual can see a friends-only
  flight, one follow is removed, then the flight page, profile list, feed, track,
  replay, and photos all deny on the next request.
- Decide whether private/friends media endpoints should use `no-store` rather than
  short `private` max-age. If short browser caching is retained, state that
  revocation is not immediate for already-fetched bytes on the same device.

### 5. Feed pagination is under-specified and the sample query is not enough

The draft says keyset pagination, but the sample uses `cursor: { id }` with
`orderBy: [{ takeoffAt: "desc" }, { id: "desc" }]`. That may work in Prisma for a
unique cursor, but the plan does not specify the contract: what the cursor encodes,
how null `takeoffAt` is handled, and what happens when multiple flights share the
same timestamp.

The profile list ordering also lacks an `id` tiebreaker. That is less severe than
feed pagination, but it can still create unstable lists.

Action:

- Define the feed cursor as an opaque value containing the ordered fields
  (`takeoffAt` and `id`, or `flightDate`/`takeoffAt`/`id` if that is the product
  order).
- Add `id` as the final tiebreaker to profile and feed ordering.
- Add integration tests with three flights sharing the same `takeoffAt`, plus a
  relation change between page 1 and page 2.
- Add `ownerId: { not: viewerId }` to the feed query even though self-follow is
  supposed to be impossible. Defense in depth keeps malformed data from putting
  own flights in the feed.

### 6. Data integrity relies too much on application code

The draft treats a DB-level self-follow `CHECK` as optional. For a security-facing
relationship table, that should be stronger. A self-follow row could be created by
a bug, seed script, console fix, or future import, and it would violate the feed
"own flights excluded" invariant unless every query defensively excludes self.

The social models also need indexing tuned to their planned access patterns:

- `Comment` rate limiting by author and time needs `@@index([authorId, createdAt])`.
- `Kudos` "who-kudosed, newest first" needs either the composite PK plus an explicit
  order decision or `@@index([flightId, createdAt])`.
- Feed query performance depends on `Flight` indexes for `(ownerId, visibility,
  status, takeoffAt)` or a narrower measured variant. The existing schema only has
  `@@index([ownerId, flightDate])`.

Action:

- Make `CHECK ("followerId" <> "followeeId")` part of the follow migration unless
  Prisma migration portability prevents it. If omitted, require explicit defensive
  exclusions in every read query and document why.
- Add indexes for comment rate limiting and any ordered kudos/comment list.
- Add a performance note or measured EXPLAIN target for the feed query before
  shipping beyond a tiny dataset.
- Consider singular model names (`Kudo`, `Comment`, `Follow`) for Prisma convention
  consistency. `Kudos` works but is awkward as a model/client name.

## Security and Privacy Holes

### Mutual-follow semantics may not match user expectations

"Friends only" as "anyone I follow who follows me back" is simple, but it conflates
interest with trust. A pilot may follow someone to see their public flights without
intending to grant access to their own friends-only flights if that person follows
back. This is not a code bug, but it is a privacy product risk.

Action:

- Confirm the copy and UX make the trust implication obvious: following someone
  who follows you grants them access to your friends-only flights.
- Add a settings/profile hint when selecting Friends only.
- Track a future "approved followers" or explicit friend request model as the
  migration path if the product wants Strava-private-account semantics.

### Profile stats can reveal more than intended

`listProfileFlightsForViewer` lets the owner see private/friends-ready flights on
their own public-profile URL. That may be intended, but then the page is no longer
just "Public flights". It also means stats shown to the owner differ from stats
shown to everyone else.

Action:

- Decide whether owner view of `/@handle` should show all ready flights or only the
  same public/profile-visible set that others see. If it shows all, change labels
  and tests accordingly.
- Add tests for stats as well as rows: stranger stats must not include friends-only
  or private flights; mutual stats may include friends-only; owner stats behavior
  must match the chosen product rule.

### Subresource privacy is not in the PR2 test matrix

The repo change should automatically protect track, replay, and photo read routes
because they call `getFlightForViewer` or photo repo helpers. The draft should not
leave that as an assumption. These routes return the sensitive path, raw-derived
replay, and image bytes.

Action:

- Extend PR2 or PR3 privacy integration tests to cover:
  `/api/flights/[id]/track`,
  `/api/flights/[id]/replay`,
  `/api/flights/[id]/photos`,
  `/api/flights/[id]/photos/[photoId]`.
- Test allowed mutual and denied one-way/anonymous cases for at least track and
  photo metadata; photo bytes can be a focused route test.

### Follow and engagement actions need abuse limits beyond comments

The draft rate-limits comments only. Follow/unfollow and kudos toggles can also be
used for spam, enumeration, and load spikes. Notifications are deferred, which
reduces impact, but the actions are still write surfaces.

Action:

- Add idempotency and race tests for rapid follow/unfollow and kudos toggles.
- Consider a low-cost per-user write throttle or at least structured logging for
  follow/kudos/comment actions.
- Make optimistic UI reconcile from server truth after races rather than assuming
  local state is final.

## Missing Edge Cases

- One-way directionality: test both "viewer follows owner only" and "owner follows
  viewer only". The draft names one-way follower, but both directions matter.
- Visibility transitions: public -> friends -> private -> public should update
  detail page, feed, profile, track/replay/photos, kudos/comment availability, and
  existing engagement display.
- Relationship transitions: mutual -> one-way -> mutual should immediately affect
  profile and feed visibility.
- Deleted users/profiles: cascade deletes should remove follows, kudos, and
  comments. Tests should verify no orphaned social rows after profile deletion.
- Deleted flights: cascade deletes should remove kudos/comments and not leave feed
  rows or counts.
- Failed/uploaded flights: feed and public profiles should show only `ready`, but
  owners may still see failed uploads in logbook/detail. Confirm friends-only does
  not expose failed flights on profiles/feed.
- Anonymous handling: follow, kudos, comment, and feed should redirect or reject
  consistently; hidden flight detail should be indistinguishable from nonexistent.
- Duplicate handles and revalidation: follow action should revalidate old and new
  profile paths if a handle changes during or after follow state changes.
- Blocked future states: if block/mute/report are deferred, document that the
  model does not yet support revoking one specific follower without breaking mutual
  follow or making a flight private.

## Data Model Concerns

- `Flight.visibility` and `Profile.defaultVisibility` remain free-form strings.
  That is compatible with the existing schema, but the sprint needs a single TS
  union/normalizer and tests for invalid values. Otherwise invalid strings can
  behave differently in settings, ingest, actions, and repo reads.
- `areMutualFollows(a, a) => true` is convenient but not necessary. Owner access is
  already a separate branch. Keeping self-mutual logic out of the friendship helper
  would reduce accidental misuse in feed or social UI code.
- Re-exporting `areMutualFollows` from `lib/social/follows.ts` after defining it in
  `lib/flights/repo.ts` blurs module ownership and risks circular imports later.
  Prefer either a tiny dependency-free relationship helper in `lib/social` used by
  `repo.ts`, or keep it private to `repo.ts` and do not re-export it for UI logic.
  The important rule is that pages never assemble flight visibility decisions.
- Comments need moderation metadata if owner-remove is part of the sprint. Hard
  delete is simplest, but then there is no audit trail and no way to distinguish
  author delete from owner moderation. Decide intentionally.
- The draft says derived data is not denormalized for counts, while the project
  orientation says derived data is commonly denormalized onto rows for fast lists.
  The no-denormalization choice is acceptable for v1, but the plan should call out
  expected limits and a future migration path if feed/profile queries get slow.

## PR Sequencing Issues

- PR1 adds follow counts and a follow button before the privacy implications are
  visible. That is shippable, but product copy should not imply "friends" until PR2
  lands.
- PR2 is too large as currently described: repo security, visibility UI, settings
  default, onboarding, profile behavior, and tests. It is still the right security
  PR, but it must include ingest and subresource tests or it is incomplete.
- PR3 and PR4 are listed as parallel after PR2, but the E2E happy path in PR4 uses
  kudos. Either PR4 depends on PR3 for E2E, or PR4's E2E should be feed-only and
  the full follow -> friends -> kudos path belongs after PR3.
- Comments are cuttable, but the draft still includes comments in multiple file
  summaries and DoD lines. Split comments into a clearly optional appendix so PR1-4
  can close the sprint without unresolved checklist noise.
- `/feed` protection in `proxy.ts` must be handled carefully with the NextAuth
  edge split. The draft says no new repos are imported by `proxy.ts`, which is
  good, but PR4 should explicitly test unauthenticated `/feed` behavior.

## Definition of Done Gaps

The DoD should add these items:

- Central visibility normalizer exists and is used by settings, onboarding if it
  exposes default visibility, `visibility-action.ts`, `ShareToggle`, ingest, and
  tests.
- A friends default visibility ingest test passes.
- Profile rows and profile stats are tested for owner, mutual, one-way, stranger,
  and anonymous viewers.
- Track, replay, photo metadata, and photo bytes are tested for friends-only
  allowed and denied cases.
- Kudos and comments do not expose counts, actors, bodies, or existence for a
  flight the viewer cannot see.
- Follow/unfollow and visibility-change revocation are tested, including feed and
  profile refresh behavior.
- Viewer-specific routes are marked dynamic/no-store or have explicit private cache
  semantics that are accepted by the product.
- Direct `prisma.flight.find*` calls outside `repo.ts` are audited against an
  allowlist instead of merely grepped.
- Feed pagination has stable ordering with an `id` tiebreaker and tests for same
  timestamp rows.
- Database integrity includes no self-follow at the DB layer or explicit defensive
  query exclusions everywhere self-follow would matter.

## Recommended Revisions Before Implementation

1. Amend PR2 to include `lib/ingest/ingest-flight.ts`, central visibility
   normalization, schema comment updates, and subresource privacy tests.
2. Change social read APIs so kudos/comments are viewer-scoped by default.
3. Add an explicit caching/revalidation section for all viewer-specific pages and
   route handlers.
4. Replace the grep DoD with an allowlisted audit of direct flight queries and
   derived-data reads.
5. Make the follow migration enforce no self-follow at the database layer, or add
   defensive `ownerId != viewerId` filters to every relevant query.
6. Clarify PR4's dependency on PR3 or move the kudos E2E path to the first PR that
   includes kudos.
7. Reword user-facing "Friends only" copy to state the mutual-follow trust model
   plainly before shipping.
