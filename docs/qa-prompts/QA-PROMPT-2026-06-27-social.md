# QA Validation Prompt — Social foundation (friends, friends-only, kudos, feed)

## Summary
Leaf Log gained a social layer: pilots can **friend** each other (request →
accept), share flights with a new **Friends only** visibility, give **kudos**
(thumbs-up) on flights they can see, and browse a **feed** of their friends'
flights. The security-critical rule: a "friends only" flight is visible to the
owner and **accepted friends only** — never to a stranger, a pending requester,
or an anonymous visitor.

> Heavy emphasis requested on the **privacy matrix** — the friends-only access
> rules are the highest-risk part. Prove both the allow AND deny directions.

## Changes Overview
- **Friends:** Add friend / Requested / Respond / Friends button on `/@handle`;
  a `/friends` requests inbox (incoming accept/decline, outgoing cancel, friends
  list); friend count on profiles. Friendship is bidirectional once accepted.
- **Friends-only visibility:** a 3-way flight visibility control (Private /
  Friends only / Public) on the flight page and a matching default in Settings;
  new uploads inherit the default.
- **Kudos:** thumbs-up toggle + count + recent who-kudosed avatars on the flight
  detail page. Can't kudos a flight you can't see; can't kudos your own.
- **Feed:** `/feed` (nav link) lists recent ready flights from your accepted
  friends, newest first, paginated, with owner context; empty state when you have
  no friends/flights yet.

## Validation Scenarios

### Friends graph & requests inbox

**E2E scenarios:**
- **Send + accept:** Pilot A opens `/@b` and clicks **Add friend** → button shows
  **Requested**. Pilot B sees the request at `/friends` and **Accepts** → both
  now show **Friends** on each other's profile and the friend count increments.
  Routes: `/@[handle]`, `/friends`.
- **Decline / cancel:** B declines an incoming request → it disappears and A is
  back to **Add friend**. Separately, A cancels a pending outgoing request → gone.
- **Reverse-pending auto-accept:** A requests B (pending); then B requests A →
  they become friends immediately (no second pending row, no error).
- **Remove friend:** an accepted friend taps remove → both return to non-friends,
  and any friends-only access is revoked (see privacy matrix).
- **Self:** a pilot viewing their **own** `/@handle` sees no friend button.
- **Graph is public:** friend counts and the friends list are visible to anyone.

### Friends-only visibility (THE privacy matrix — highest priority)

Set up: pilots **A & B are accepted friends**; **C** is unrelated (or has only a
*pending* request to B); plus an **anonymous** visitor. B owns three flights, one
each at **Private / Friends only / Public**.

**E2E scenarios — for B's FRIENDS-ONLY flight, verify visibility on the flight
page (`/flights/[id]`), B's profile (`/@b`), and the feed:**
- **Allowed:** A (accepted friend) can open it and sees it listed on B's profile.
- **Denied (must be a not-found-equivalent, indistinguishable from a missing
  flight):** C with only a pending request; an unrelated signed-in stranger; an
  anonymous visitor. None of them see it on the flight page, B's profile, or feed.
- **Owner:** B always sees their own Private + Friends-only + Public flights on
  their own profile, **including non-ready uploads** (uploaded/processing/failed).
- **Private** flight: only B (owner) — A, C, anon all denied.
- **Public** flight: everyone (incl. anon) allowed.
- **Revocation:** A can see B's friends-only flight; B (or A) removes the
  friendship; on the **next** load, A is denied on the flight page, B's profile
  list, and the feed.
- **Subresources inherit visibility:** for a friends-only flight, the map track,
  3D replay, and photos must be **denied** to C/anon and **allowed** to friend A.
  Routes: `/api/flights/[id]/track`, `/replay`, `/photos`,
  `/photos/[photoId]`. (These should 404 for the non-friend.)
- **Default visibility on upload:** set the Settings default to **Friends only**,
  upload a new flight, confirm it lands **Friends only** (not Private). Route:
  `/settings`, `/upload`.

### Kudos

**E2E scenarios:**
- **Toggle:** on a flight A can see (B's public or friends-only), A taps the
  thumbs-up → count +1 and A appears in recent kudoers; tapping again removes it.
- **Cannot kudos the unseeable:** C/anon cannot kudos B's friends-only or private
  flight (no control, or the action fails the same generic way).
- **No self-kudos:** B viewing their own flight sees the count/who-kudosed but
  cannot kudos it.
- **Friend can kudos friends-only:** A (friend) can kudos B's friends-only flight.

### Feed

**E2E scenarios:**
- **Shows friends' flights:** A's `/feed` shows B's recent **public AND
  friends-only** ready flights (since they're friends), newest first, with B's
  avatar/handle linking to `/@b`.
- **Excludes:** B's **private** flights; B's **non-ready** flights; A's **own**
  flights; flights from **non-friends** (incl. someone with only a pending
  request).
- **Empty state:** a pilot with no friends (or whose friends have no flights)
  sees the friendly empty state, not an error.
- **Pagination:** with several flights sharing the same date/time, paging through
  the feed shows each flight exactly once (no duplicates, no gaps).

## Regression Checks
- **Auth — "keep me signed in?" interstitial (PR #17, not previously QA'd):** after
  clicking a magic link, the user lands on a **"You're signed in"** prompt with
  **Keep me signed in** / **Just this time**, then proceeds to their destination.
  Both buttons complete sign-in (cookie persistence differs but login works). A
  signed-in pilot visiting `/` is redirected to `/logbook`.
- **Account menu + What's new (PR #19):** the header avatar opens a dropdown
  (What's new · Settings · Sign out); `/whats-new` lists release notes; there is
  **no** standalone Settings nav tab (nav = Logbook · Upload · Profile · Feed).
- **Flight sharing still works:** the new 3-way visibility control replaces the
  old "Share flight" toggle — Private→Public still makes a flight visible to
  logged-out visitors (the original happy-path).
- **Existing privacy unchanged:** public flights still public; private still
  owner-only; photos/track/replay still gated.

## Environment Notes
- **Needs ≥3 pilots:** an accepted-friend pair (A, B) and an unrelated/pending
  pilot (C), plus anonymous. The friends-only matrix can't be exercised without
  the friend relationship set up first.
- **Auth in dev:** magic link is written to `/tmp/leaf-magic-link.txt` (no email).
  After clicking it, **click through the "Keep me signed in?" interstitial** before
  onboarding — automated flows that assume a direct `/onboarding` redirect will
  hang (this exact regression was just fixed in the repo's own e2e specs).
- **"Denied" means not-found:** hidden flights return a 404-equivalent — assert
  indistinguishability from a nonexistent flight, not a 403 page.
- A repo CI workflow (`.github/workflows/ci.yml`) now runs the Vitest privacy
  matrix + Playwright e2e against a Postgres service; your suite is complementary
  (live-environment, broader scenarios).
