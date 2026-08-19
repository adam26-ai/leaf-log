# Cross-critique: Claude → Codex draft (SPRINT-004)

Critique of [`SPRINT-004-CODEX-DRAFT.md`](./SPRINT-004-CODEX-DRAFT.md) against
[`SPRINT-004-INTENT.md`](./SPRINT-004-INTENT.md) and the code as it exists on `main`
today. Every factual claim below is cited to a file and line I read. Planning
document only — no application code, migrations, or tests were written or modified.

---

## Verdict up front

The Codex draft gets the **central architectural decision right** and states it more
crisply than I did: `Flight.takeoffSiteName` / `landingSiteName` become a
*public-name cache*, private sites keep the id and null the name, and read-time
resolution happens in `lib/flights/repo.ts`. Its one-line justification —
"flight visibility and site visibility stay independent" — is the correct frame, and
its corollary (a flight visibility change needs **no data rewrite**) is the property
that makes the whole design safe.

Where it is weak is not the architecture, it is the **mechanism**. It specifies
several operations (private→public promotion, operator emergency fixes, bounded
re-association) that its own schema cannot execute efficiently or at all, and it
contains one constraint pair that is **mutually contradictory** and will fail on
`prisma.user.deleteMany` in test teardown. Its Q3 answer creates a one-way door on
the app's most sensitive new data type with no in-product remedy, and its Q5 answer
names as "primary" a UI branch that is, by construction, almost unreachable.

Two of its answers — **Q7 (site kind)** and its **backfill-script design** — are
better than mine, and its overall scope restraint is the better call for this
sprint. Details in [Where Codex beats my draft](#where-codex-beats-my-draft).

---

## Strengths

**1. The core privacy model is stated as an invariant, not a procedure.**
The Overview's three numbered rules ("Public and curated sites may cache their
names…", "Private sites may be linked by `takeoffSiteId`… but their cached name
columns are always `null`", "Every viewer-facing flight read resolves safe display
site names… in `lib/flights/repo.ts`") are checkable. That is exactly the SPRINT-003
shape the intent asks the sprint to imitate, and it is the right shape: it makes the
leak structurally impossible for the *cached column*, rather than preventing it by
review discipline at each render site.

**2. Correct identification of write-scope vs. read-scope as different questions.**
Architecture § *Site privacy and lookup*: "`ingestFlight()` passes `viewerId: ownerId`.
That is the right write-time scope… Read time remains separately scoped, so a private
association does not imply public display." This is the subtlest point in the intent's
OQ2 ("is owner-scoping at write time the right notion when the *reader* may be someone
else?") and the draft answers it directly and correctly.

**3. The "per-viewer cache" risk is a genuinely good catch.**
Risks § *Per-viewer cache*: "Profile/feed/logbook rows differ by viewer because private
site names differ by viewer." This is a real, easy-to-miss consequence of moving name
resolution to read time — the rows were previously viewer-independent for the site
column. My own draft does not name it. Flagging it, and tying the mitigation to the
existing SPRINT-003 dynamic/no-store behavior, is correct.

**4. PR ordering is stated with a rationale and it is the right rationale.**
Implementation preamble: "Ordered so the privacy invariant lands before user-facing
creation." PR1 closes the read-side leak before PR3 makes it possible to create a
private site at all. That means every intermediate commit is safe to deploy — which
matters here, because Railway runs `prisma migrate deploy` pre-deploy (`railway.toml`).

**5. `canSeeSite` is fail-closed on the null cases, and the code is written out.**
`Boolean(viewerId && ownerId && viewerId === ownerId)` correctly refuses when either
id is null — which matters because `Site.ownerId` is nullable by design. This is
better than prose; it is the predicate, and it is right. (The *query* form of the
same rule is not — see [E4](#e4--the-lookup-predicate-as-written-matches-orphaned-private-sites-for-anonymous-viewers).)

**6. Backfill-script flags are concrete operator ergonomics.**
`--site-id <id>` and `--public-only` in Architecture § *Retroactive association* give
the operator a targeted tool for exactly the case Q4 defers (community-wide sweep for
one newly-public site). This is more useful than "the script becomes the global sweep."

**7. Security section is short, auditable, and states an invariant.**
"private site names and ids are never returned to a viewer unless
`canSeeSite(site.visibility, site.ownerId, viewerId)` is true." One sentence, testable,
names the predicate. Good.

**8. Honest non-goals.** The "Explicitly out of scope for v1" list is specific and
the Q-answers do not quietly re-add anything to it.

---

## Factual errors and understated claims about the existing codebase

### E1 — "`lib/flights/repo.ts` remains the only display-read gate for flights" understates the DTO blast radius

`getFlightForViewer` (`lib/flights/repo.ts:142-161`) returns the **entire raw `Flight`
row** — `prisma.flight.findUnique({ where: { id: flightId } })` with no `select`, typed
`Promise<Flight | null>`. Turning it into a viewer-safe DTO is not a two-component
change. Its callers are:

- `app/flights/[id]/page.tsx:24`
- `app/api/flights/[id]/track/route.ts:20`
- `app/api/flights/[id]/replay/route.ts:24`
- `lib/photos/repo.ts:67` and `:102`
- `lib/social/kudos.ts:32` and `:55`

plus `components/flight/flight-header.tsx:5` and `components/flight/metric-tiles.tsx`,
both of which are typed `flight: Flight` — the Prisma model type, not a local
interface. PR1's bullet "Update `FlightHeader` / `FlightRow` **only as needed**"
undersells this. It is fine as a plan (the DTO can be a superset of `Flight` with two
fields overridden), but the draft should say so explicitly, because the alternative
reading — a narrowed DTO — silently breaks four authz consumers that only need
`ownerId`/`status`.

### E2 — `LIST_SELECT` has no landing fields, and `statsFrom` is never mentioned

`LIST_SELECT` (`lib/flights/repo.ts:15-26`) ships `takeoffSiteName` and `takeoffSiteId`
only — there is **no** `landingSiteName` / `landingSiteId` in lists or the feed
(`FEED_SELECT` spreads `LIST_SELECT` at `:30`). Two consequences the draft misses:

- DoD bullet 2 promises "the flight page, logbook, profile, and feed render the
  correct viewer-safe site display", and PR3 adds a landing-site line. If landing
  names ever reach a list surface, `LIST_SELECT`, `FlightListItem`
  (`repo.ts:28`), and `components/logbook/flight-row.tsx:52` all change. The plan
  names none of them.
- `statsFrom` (`repo.ts:259-265`) derives `siteCount` from
  `new Set(ready.map(f => f.takeoffSiteId))`. The draft proposes nulling
  `takeoffSiteId` for sites the viewer cannot read — which silently changes a
  user-facing stat on `/@handle`, and changes a value asserted with exact equality in
  `test/privacy.integration.test.ts:299-313`. That change is probably *correct*
  (a stranger should not be able to count a pilot's private launches), but it is a
  deliberate product decision the draft never makes and never tests.

### E3 — `onDelete: SetNull` and the "private requires owner" CHECK are mutually contradictory

The draft specifies both:

- `owner Profile? @relation("OwnedSites", fields: [ownerId], references: [id], onDelete: SetNull)`
- `CHECK (visibility <> 'private' OR ownerId IS NOT NULL)`

These cannot both hold. Prisma emits `onDelete: SetNull` as a real DB referential
action (see the precedent at
`prisma/migrations/20260618144057_init/migration.sql:158,164,167` —
`ON DELETE SET NULL ON UPDATE CASCADE`). Deleting a `User` cascades to `Profile`
(`schema.prisma:62`), which fires `SET NULL` on `Site.ownerId`, which makes the CHECK
evaluate `'private' <> 'private' OR NULL IS NOT NULL` → **false** → constraint
violation → the delete fails.

**Concrete failure today, not hypothetically:** every integration suite deletes its
pilots in `afterAll` — `test/privacy.integration.test.ts:217`,
`test/feed.integration.test.ts:76`, `test/social.integration.test.ts:88`, and the
new `test/sites.integration.test.ts` the draft itself specifies. The moment that new
suite creates a private site owned by a test pilot and tears the pilot down, teardown
throws. There is no account-deletion feature in app code today (I grepped `app/` and
`lib/` for `user.delete` — nothing), so production is unaffected *for now*, but the
sprint's own tests will hit it on day one.

Pick one: drop the CHECK and make the read predicate the backstop
(`ownerId IS NOT NULL AND ownerId = viewerId`, which `canSeeSite` already does), or
keep the CHECK and handle owned-site disposition in app code before the cascade. The
draft cannot have both.

### E4 — the lookup predicate as written matches orphaned private sites for anonymous viewers

Architecture § *Site privacy and lookup* states the candidate query as:

```
visibility = "public" OR (visibility = "private" AND ownerId = viewerId)
```

In Prisma, `{ ownerId: null }` compiles to `"ownerId" IS NULL`, not `= NULL`. So with
`viewerId: null` — an anonymous caller, or `scripts/backfill-sites.ts` on a row whose
owner was removed — the private branch matches **every orphaned private site**
(exactly the rows E3's `SET NULL` creates). The draft's own `canSeeSite` gets this
right; the query spec, which is what an implementer copies, does not. It needs an
explicit "when `viewerId` is null, omit the private branch entirely," plus an
integration assertion for the anonymous row of the matrix.

### E5 — the dedup candidate lookup cannot surface the opposite-endpoint site that Q7 requires

Architecture § *Creating and attaching sites*, step 2: "Runs visible-site candidate
lookup first." That lookup is defined two sections earlier as filtering
`kind in (requested kind, "both")` — matching today's behavior at
`lib/sites/lookup.ts:34` (`OR: [{ kind }, { kind: "both" }]`).

Q7 then says: "If a visible existing site is explicitly reused from the opposite
endpoint, widen it to `both`." **There is no path in the described UI that surfaces an
opposite-kind site as a reuse candidate.** A pilot who named their LZ `kind:'landing'`
and later names their launch at the same spot will be shown no candidates and will
create a duplicate — the exact outcome success criterion 4 exists to prevent. The
candidate query for the *create dialog* must ignore `kind` (or query all four kinds
and label them); only the *automatic* matcher should filter by kind.

### E6 — the reuse branch the draft calls "primary" is almost unreachable

Q5: "Inside the normal match radius (600 m takeoff / 900 m landing), reuse is the
primary action." But the only entry point this sprint builds is the "Unknown site"
affordance on the flight page (`components/flight/flight-header.tsx:7`,
`components/logbook/flight-row.tsx:52`). That string renders *because* `findSite`
already returned null at that coordinate, for that owner, at ingest
(`lib/ingest/ingest-flight.ts:71-72`). By construction, nothing visible to that pilot
sits inside 600 m / 900 m — except in the un-backfilled tail (a site created after this
flight was ingested and missed by the bounded scan) or a genuine race.

The 2× advisory radius is the branch that actually does the work, and the draft
demotes it to "warns but does not block." The intent asks this question directly
("Does the reuse radius equal the match radius … or should it be wider to catch
near-duplicates the matcher would miss?") and the draft's answer is inverted relative
to its own architecture.

Secondary: a 2× multiplier makes the advisory radius endpoint-dependent (1200 m
takeoff / 1800 m landing) for no stated reason. A single fixed suggestion radius is
easier to reason about and to test.

### E7 — 4-decimal rounding is listed as a privacy mitigation; it is not one

Risks § *Coordinate sensitivity* lists "rounded stored coordinates" as a mitigation
for public sites revealing launch locations. 4 dp is ≈ 11 m — the arithmetic in Q6 is
right, but 11 m does not obscure a launch. It also cannot be the marginal disclosure:
`Flight.takeoffLat` / `takeoffLon` are stored at full precision
(`schema.prisma:181-184`) and the derived track is served to anyone who can see the
flight (`app/api/flights/[id]/track/route.ts`).

The rounding is still worth doing — it de-correlates the public site row from one
specific flight's exact fix, which is a real if narrow benefit — but the draft
over-claims. (Same decision as mine, weaker justification.)

### E8 — several specified operations have no supporting index

- **Q1's promotion transaction** ("fills the public cache on linked flights in the
  same transaction") requires `UPDATE "Flight" … WHERE "takeoffSiteId" = $1`. `Flight`
  has no index on `takeoffSiteId` or `landingSiteId` (`schema.prisma:199-201`:
  `@@unique([ownerId, igcSha256])`, `@@index([ownerId, flightDate])`,
  `@@index([ownerId, status, flightDate])`). The draft's migration adds none.
- **Q4's bounded re-association** ("scan up to 200 of the creator's own ready flights
  missing that endpoint") is the *inverse* of `findSite` — site → flights within
  radius. There is no index on `Flight.takeoffLat` / `takeoffLon` either. The
  `ownerId` prefix makes it survivable at pilot scale, but the draft never says the
  scan is bbox-filtered, so the plain reading is "load 200 rows and haversine them in
  JS," and `200` is an arbitrary silent cap with no user feedback when it truncates.
- **Index review:** `@@index([visibility, ownerId])` leads with a two-value column and
  is largely subsumed by `@@index([ownerId, visibility, normalizedName])`. Meanwhile
  `normalizedName` is added as a stored column and indexed, but **no query in the
  draft consumes it** — the reserved-name check is against a computed value, and Q10
  explicitly declines a uniqueness constraint. Either wire it to the duplicate check
  or drop the column.

### E9 — smaller factual notes

- The intent's table calls `lib/sites/lookup.test.ts` "existing **pure** unit tests
  for the matcher." It is not: it is DB-backed (`lookup.test.ts:10-11` —
  `const enabled = Boolean(process.env.DATABASE_URL); const d = enabled ? describe : describe.skip`)
  and asserts against seeded rows. The draft inherits that error in PR2 ("**keep** unit
  tests for bbox, haversine ranking…") — those tests do not exist yet and will be
  written, not kept. Worth noting because it is one more file whose four `findSite`
  calls (`:23, :34, :40, :46`) use the old positional signature.
- Relatedly, the draft states the *policy* "a skipped site privacy suite is a failed
  sprint" but never the *mechanism*. The repo already has it:
  `test/privacy.integration.test.ts:34-36` **throws** in `beforeAll` when
  `DATABASE_URL` is unset, rather than `describe.skip`. The new suite should say it
  follows that pattern; "CI provisions Postgres" alone is a policy that a future
  workflow edit can silently undo.
- Adding `updatedAt DateTime @updatedAt` to a populated table needs an explicit
  `DEFAULT CURRENT_TIMESTAMP` (or backfill-then-`SET NOT NULL`) in hand-written SQL.
  PR1 lists the column without the step.
- `CHECK (source IN ('manual','user'))` adds a migration dependency for the documented
  future ParaglidingEarth import (`prisma/seed.ts:8-9` calls the curated set "the
  documented Plan B while ParaglidingEarth bulk-redistribution terms are unconfirmed").
  `source` is not an authz field, so the CHECK buys nothing and costs a future
  migration. The `visibility` and `kind` CHECKs are worth keeping; this one is not.
- The `lib/sites/geo.ts` split buys less than implied: the haversine already lives in
  `lib/geo/distance.ts` and `lib/sites/lookup.ts` imports only a Prisma *type* plus
  that helper. The genuinely pure, currently-untested piece is the bbox padding math
  (`lookup.ts:26-28`, including the `Math.max(0.01, cos)` guard). Worth extracting —
  just for a smaller reason than stated.

---

## Design errors and internal contradictions

### D1 — the "public cache column" is vestigial under this design, and the draft never picks an authority

The repo must join the `Site` row on **every** list/feed/detail read anyway — that is
the only way to know whether the linked site is private. Once joined, `Site.name` is
free, and the cached column saves nothing. The draft half-acknowledges this ("If the
linked site is public, the cached `Flight.*SiteName` **may** be used as the fast path
but must agree with the site row when backfilled") and then never says which value
wins. That ambiguity is load-bearing:

- **If the join wins**, the cache is dead weight, and — worse — it destroys the
  column's original purpose. `schema.prisma:186` comments the pair as
  "*denormalized name kept for history*", and `Flight.takeoffSite` is
  `onDelete: SetNull` (migration `:164`). Today, deleting a site leaves
  `takeoffSiteId = NULL` and `takeoffSiteName = 'Mussel Rock'`, and the logbook still
  reads correctly. Resolve-from-join-only silently reverts every such flight to
  "Unknown site". The draft never states what the repo does when `siteId IS NULL` and
  `siteName IS NOT NULL`.
- **If the cache wins**, a public rename (Q3 defers rename UI to "operator SQL") leaves
  stale names on every linked flight forever, and — the sharp one — an operator
  *deleting* an abusive public site does **not** remove its name from other pilots'
  logbooks. Q3's entire remedy ("operator SQL/admin tooling handles emergencies")
  is defeated by Q1's cache design. Neither answer mentions the other.

This is resolvable, and cheaply: keep the cache, declare the **site row authoritative
whenever `siteId` is non-null**, use the cache **only** as the historical fallback when
`siteId IS NULL`, and make every site rename/delete/promote go through one
transactional `updateMany` over newly-added `takeoffSiteId` / `landingSiteId` indexes
(E8). The draft needs one sentence and two indexes; right now it has neither.

### D2 — `Site.visibility` defaults to `"public"` while the normalizer fails closed to `"private"`

`normalizeSiteVisibility` returns `"private"` on anything unrecognized. The column is
`@default("public")`. The `Flight` precedent is the opposite (`schema.prisma:157`:
`visibility String @default("private")`). Any future `prisma.site.create` that omits
`visibility` silently publishes a site.

To be fair, the public default is doing real work: it keeps `prisma/seed.ts:32` and
`test/privacy.integration.test.ts:108-116` compiling and green unchanged, and it makes
the migration a no-op for the old code running during Railway's pre-deploy window.
Those are legitimate. But the same safety is available without the fail-open default:
**no column default at all** (Prisma then requires it in every `create`) plus an
explicit `UPDATE "Site" SET "visibility" = 'public'` backfill in the migration. Seed
and tests then have to state their intent — which is what you want — and the
private-requires-owner rule (if kept per E3) turns forgetfulness into a loud failure
instead of a silent publish. The draft doesn't acknowledge that this tension exists.

### D3 — public creation is a one-way door on the app's most sensitive new data

Q3 combines: public publication is immediate; rename/delete UI deferred; demotion
"out of scope and should not exist"; remedy is "operator SQL/admin tooling". Net
effect: **a pilot who mis-clicks Public on their home launch has permanently published
a coordinate and a name, and has no in-product way to undo it.** For a product whose
identity is "private-first" and whose intent document explicitly frames a private
takeoff coordinate as location data, routing that mistake through a support ticket is
the wrong default.

This is a privacy decision presented as a scope decision. The cheapest fix that keeps
the draft's admirable restraint: let the **creator** delete or unpublish their own site
while **no other pilot's flight references it** — one `count()` guard, no moderation
model, no new authorization concept. It removes the one-way door for ~100% of real
mistakes (a fresh mistake has no other referents yet). Note it needs D1's `updateMany`
and E8's index to clear cached names.

### D4 — the migration's own backfill is unverified

PR1 says "Backfill existing curated rows to `public` with normalized names." Nothing in
the DoD asserts it happened, and nothing in the test plan covers it. Given the
`@default("public")` (D2), a *forgotten* backfill is invisible — the rows would be
correct by accident. That is fine until the default changes. One integration assertion
("every `source='manual'` row is `visibility='public'`, `ownerId IS NULL`, and has a
non-empty `normalizedName`") closes it.

---

## Gaps in risk analysis

The seven listed risks are real and well-mitigated. These are missing:

**R1 — Adversarial site planting is not in the risk list, and it is the severe one.**
"Public UGC quality" covers typos, jokes, and duplicates. It does not cover the
mechanism: `findSite` ranks strictly by **nearest**, with no preference for
`license = 'curated'` (`lib/sites/lookup.ts:38-46`). A public user site planted 100 m
from Mussel Rock's seeded coordinate (`prisma/seed.ts:11`) *wins the ranking* for most
flights launched there — so one pilot can relabel a famous launch in **every other
pilot's future logbook row and feed entry**. The draft's UX "warns before allowing
creation" but explicitly "does not block"; there is no user-facing delete, no report
path, and per D1 deleting the row may not clear cached names. Two cheap structural
mitigations, either of which the plan could adopt: refuse creation of a **public** site
inside an existing *visible* site's match radius (reuse or nothing — creating a
*private* one there stays fine), and/or tie-break toward `license = 'curated'` in the
matcher. Neither costs a new concept.

**R2 — No rate limiting of any kind.** Immediate public creation + no moderation +
no per-pilot cap means one authenticated script inserts thousands of public sites, each
of which contaminates the global matcher. The Security section doesn't mention it. A
per-pilot daily cap is a few lines and belongs in v1 given Q3's other choices.

**R3 — Rollback is the leak.** Railway runs `prisma migrate deploy` pre-deploy
(`railway.toml`), so the schema always lands first — safe. But the draft never
considers the reverse: if PR3 ships and is then rolled back, rows with
`visibility = 'private'` exist while the old unscoped `findSite`
(`lib/sites/lookup.ts:18-23`) and the old unconditional cache write
(`lib/ingest/ingest-flight.ts:110-113`) are live again. **A rollback of this sprint is
itself a privacy incident.** That deserves an explicit "roll forward, never back" note
and, ideally, a PR ordering where private sites cannot exist until every scoped reader
has been deployed for at least one release — which the draft's PR1→PR3 ordering
already achieves and should claim credit for.

**R4 — The e2e "second nearby upload" has a dedupe trap.** Ingest dedupes on
`(ownerId, igcSha256)` (`lib/ingest/ingest-flight.ts:44-55`, `@@unique([ownerId, igcSha256])`
at `schema.prisma:199`) and returns `deduped: true` pointing at the **first** flight.
A Playwright test that re-uploads the same fixture to prove auto-association will pass
while asserting against the original flight. DoD bullet 9 needs "a *distinct* IGC file
launching within the radius" spelled out, or it is a false green.

**R5 — Flights that already matched a curated site are never revisited.** The bounded
scan covers flights "missing that endpoint" only. A pilot who names their actual launch
will find their old flights still labelled with a curated site 500 m away, with no way
to fix them. That is a defensible v1 choice — nearest-wins is evaluated once, at first
match — but it is user-visible and the draft doesn't state it.

**R6 — Antimeridian: test-or-fix is undecided.** PR2 promises unit tests for
"antimeridian behavior." The current bbox prefilter is `lon: { gte: lon - dLon, lte: lon + dLon }`
(`lookup.ts:32-33`) with no wraparound, so a site at −179.99° is invisible to a lookup
at +179.99°. A test written today would enshrine that. The plan must say whether v1
fixes the wrap (a small `OR` on the bbox) or documents it as known-broken; the test
cannot be written until it does. (Shared gap — my draft is no clearer.)

---

## Missing edge cases

### Around the `Flight.takeoffSiteName` denormalization leak

- **`statsFrom` / `siteCount`** — see [E2](#e2--list_select-has-no-landing-fields-and-statsfrom-is-never-mentioned).
- **Historical names after site deletion** — see [D1](#d1--the-public-cache-column-is-vestigial-under-this-design-and-the-draft-never-picks-an-authority).
- **Stale names after a public rename** — see D1.
- **The unstated invariant that makes the model tractable.** In this design a private
  site can only ever be linked to *its own owner's* flights: ingest scopes candidates
  to the flight owner, and creation is owner-only. So "flight owner" and "site owner"
  coincide for every private link. The repo's per-row `canSeeSite` is correct even if
  that invariant broke — good — but the invariant is worth asserting in a test, because
  it is what makes `siteCount` and feed semantics reason about cleanly.
- **The feed path specifically.** `FEED_SELECT` spreads `LIST_SELECT`
  (`repo.ts:30-40`), so sanitation must run inside `listFeedForViewer` after the
  `page.slice`/`kudoCountsFor` mapping (`repo.ts:240-246`), not only on the list
  helpers. Worth naming, because the feed is the one path where the viewer is
  *never* the owner. (The cursor encoder at `repo.ts:57-65` uses only dates and id, so
  it is safe — also worth stating, so a reviewer doesn't have to re-derive it.)

### Around site visibility transitions

- **Owner account deletion** — see [E3](#e3--ondelete-setnull-and-the-private-requires-owner-check-are-mutually-contradictory). The draft doesn't say what
  *should* happen: orphan the public sites (correct — other pilots' flights depend on
  them) and delete or hard-privatize the private ones.
- **Promotion changes global matching, not just display.** Q1's promotion transaction
  flips `visibility` and fills cached names. It does not mention that the site now
  enters *every* pilot's matcher — which is the more consequential half. Should
  promotion also trigger the `--site-id` backfill sweep? The draft has the tool and
  doesn't connect it.
- **Demotion exists in disguise.** Q3's "operator SQL handles emergencies" *is*
  public→private demotion, which Q1 declares "should not exist without a symmetric
  cache-clearing migration." The draft contains both statements and reconciles neither.

### Around the device-push ingest path (no interactive UI)

- **Scoping is handled correctly and explicitly** — `viewerId: ownerId` on both
  callers (`app/api/upload/route.ts:56`, `app/api/ingest/route.ts:49`), with a DoD line
  and integration tests. Credit where due; this is the criterion most likely to be
  hand-waved and the draft doesn't hand-wave it.
- **Discoverability is missing entirely.** A pilot whose SD card auto-uploads 40
  flights gets 40 rows reading "Unknown site" and nothing anywhere tells them a site
  wants naming. The intent stresses that this path "has no interactive UI to fall back
  on"; the draft reads that solely as a *correctness* constraint and never as a
  *product* one. One line of scope — an "Unknown site" count or filter on `/logbook` —
  converts the feature from "discoverable if you happen to open the right flight" to
  "discoverable." Not a DoD miss (no success criterion demands it), but the obvious
  v1 gap for the device-first pilot, who is the Leaf's actual user.
- **Pushes racing the re-association scan are silently missed.** A device flight that
  lands mid-scan is not in the 200-row window and there is no later sweep except the
  operator script. Low severity, zero mention.
- **The 200-row cap has no user feedback.** A pilot with 300 unmatched flights gets
  partial association and no indication that anything was skipped.

---

## Definition of Done completeness

Mapping the intent's six success criteria to the draft's eleven DoD bullets:

| Intent SC | Covered by | Verdict |
|---|---|---|
| 1 — owner names an unmatched takeoff **or** landing, public/private, in-place | Bullet 1 | ✅ — but "without leaving the flight page" is not asserted; the Playwright test should assert no navigation |
| 2 — name replaces "Unknown site" everywhere the cached name renders | Bullet 2 | ✅ — enumerates *more* surfaces (profile, feed) than the criterion asks. Strong. |
| 3 — later flights auto-associate, identically for device push | Bullet 3 | ✅ — device push named explicitly |
| 4 — creating near an existing visible site offers reuse | Bullet 4 | ✅ as written, ⚠️ unreachable in practice via the main entry point (E6) |
| 5 — private site never visible to anyone but its owner, **in one auditable place**, CI-run matrix | Bullets 5, 6, 7, 9 | ⚠️ **partial** — see below |
| 6 — five gates, `/whats-new`, `FEATURES.md` | Bullets 10, 11 | ✅ |

**Where SC5 is not fully verifiable from the DoD:**

- *"one auditable place"* — the rule is expressed in `lib/sites/visibility.ts`
  (`canSeeSite`), enforced in `lib/sites/lookup.ts` (candidates), enforced again in
  `lib/flights/repo.ts` (display), and implied a third time in the write-side
  `siteCachePatch`. Bullet 7 ("no page or route performs ad-hoc private-site
  authorization") is close but is about *pages*, not about the four modules. What
  would make it auditable: a DoD line asserting `canSeeSite` is the **only** place the
  private rule is expressed — checkable with a grep that
  `visibility === "private"` appears in exactly one file.
- *"not through site lookup"* — covered. *"not through search"* — vacuous (no search
  in v1); worth saying so rather than leaving it implicitly checked.

**Success criteria aside, these are missing from the DoD entirely:**

1. **`scripts/backfill-sites.ts`.** It is the highest-volume writer of the cached
   columns, it currently calls `findSite` unscoped (`backfill-sites.ts:22-26`) and
   writes names unconditionally (`:32-35`). Run unmodified after this sprint it would
   attach *anyone's* private sites to *anyone's* flights and denormalize their names
   at bulk. It appears in PR2's plan; it has **no DoD line and no test**. This is the
   single most consequential omission in the DoD.
2. **The migration's curated-row backfill** (D4).
3. **`statsFrom` / `siteCount` semantics** under sanitized ids (E2).
4. **The historical-name case** (`siteId IS NULL`, `siteName` non-null) — D1.
5. **Deploy/rollback**: nothing asserts the sprint is roll-forward-only (R3).

---

## Open Questions, one by one

**Q1 — the denormalization leak. Slightly worse than the alternative; same decision.**
Both drafts land on public-only cache + read-time resolution, and Codex's framing
("flight visibility and site visibility stay independent"; transitions need no data
rewrite) is the crisper statement of *why* it works. It is weaker on mechanism: no
DB CHECK for the half that *is* expressible
(`CHECK ("takeoffSiteName" IS NULL OR "takeoffSiteId" IS NOT NULL)`), no
`takeoffSiteId` / `landingSiteId` index for the `updateMany` its own promotion
transaction requires (E8), and no answer for the historical-name case (D1). Right
decision, under-specified.

**Q2 — viewer-scoping `findSite`. Essentially tied; each has one thing the other lacks.**
The options-object signature `findSite(db, { lat, lon, kind, viewerId })` is marginally
better than a fifth positional argument — self-documenting at the call site, immune to
reordering — and the claim "TypeScript breaks all callers" is correct (positional →
object breaks `ingest-flight.ts:71-72`, `backfill-sites.ts:22-26`, and
`lookup.test.ts:23,34,40,46`). Against that: the null-viewer footgun (E4), and
`SiteMatch` (`lookup.ts:8-11`) is never widened to carry `visibility` / `ownerId`,
which `siteCachePatch` needs in order to decide whether to cache the name — the helper
is specified but its input isn't.

**Q3 — public site creation. Worse, and it is the draft's weakest answer.** The
one-way door (D3) is a privacy decision made as a scope decision. That said, one part
of this answer is *better* than my alternative: refusing to invent a novel
"you may edit until another pilot depends on it" authorization rule keeps a new
authz concept out of the same sprint that closes a privacy leak, and that restraint
is correct. The specific line drawn — no user-facing remedy at all — is the problem,
not the restraint. "Creator may delete or unpublish while unreferenced" is the middle,
and it costs one `count()`.

**Q4 — retroactive re-association. Mixed: better tool, weaker mechanics.** Same core
decision as the alternative (current flight + bounded owner scan; never everyone's
flights on request) and the reasoning is sound. The `--site-id` / `--public-only` flags
are **better** than my vaguer "the script becomes the global sweep" — they are the
concrete operator answer to the case Q4 defers. Weaker on: no bbox prefilter stated,
no index (E8), an arbitrary 200 with no truncation feedback, no answer for
already-matched flights (R5), and no DoD coverage of the script itself.

**Q5 — dedup UX. Worse.** The "inside the match radius, reuse is primary" branch is
largely unreachable from the entry point the sprint builds (E6), so the answer's
emphasis is inverted; the advisory 2× radius, which is the branch that does the real
work, is demoted to a non-blocking warning — and that non-blocking is the door R1
walks through. The endpoint-dependent multiplier (1200 m vs 1800 m) is unargued.

**Q6 — site coordinate. Same decision, weaker justification.** 4 dp / ~11 m is right
and the load-bearing check ("precise enough for 600/900 m matching") is correctly
identified. The privacy framing over-claims (E7). Neither draft addresses the
longer-term issue that the first flight's fix defines the site centre forever — an
outlier launch permanently mis-centres the site — which is worth naming as deferred
(centroid refinement) rather than leaving implicit under "pilot-adjustable markers".

**Q7 — site `kind`. Better than my answer, and I'd adopt it.** Create narrow
(`takeoff` / `landing`), widen to `both` **only** on explicit opposite-endpoint reuse,
never narrow. My draft has manual binds ignore `kind` and leave the site row untouched
— which means the site stays permanently mislabelled, so the *next* pilot at that spot
hits the same dead end and creates the duplicate we were trying to prevent. Codex's
rule actually records the fact the pilot asserted and makes the shared gazetteer
improve with use, which is the sprint's whole point; "never narrow" bounds the
shared-state mutation to a monotone widening, which is the right guard. Its only
defect is E5 — the candidate lookup as specified can't surface the opposite-endpoint
site — and that is a fixable gap in the plumbing, not a wrong decision.

**Q8 — surface area. Fine and correctly scoped; the consequence is unowned.** No site
pages, no browse, no search, `lib/prisma.ts:14-21`'s "only `Flight` is URL-visible"
left closed — all correct, and the enumeration/moderation-surface argument in the
Security section is the right argument. But taking the restraint all the way means
there is *no* management surface anywhere, which is precisely what makes Q3's one-way
door bite (D3). The two answers need to be reconciled; individually each is defensible.

**Q9 — `Profile.homeSiteId`. Tied, and Codex's is more concise.** Both say out of
scope. Codex adds the useful implementation note that `Site.ownerId` forces relation
edits adjacent to `homeSiteId` (`schema.prisma:72-73`) whether or not the feature ships
— true, and the kind of detail that saves an implementer five minutes.

**Q10 — naming rules. Worse on the parts that matter.**
- "Reject … angle brackets" is cargo-cult in a React app — the draft's own Security
  section concedes React escapes output. It rejects legitimate names and prevents
  nothing.
- "Reject control characters" **does not cover the actual spoofing vectors**: bidi
  overrides (U+202A–U+202E, U+2066–U+2069) and zero-width characters
  (U+200B–U+200D) are Unicode *format* (Cf) characters, not *control* (Cc)
  characters. A rule phrased as "control characters" lets `U+202E` straight through
  into a name every pilot reads. NFKC folds compatibility forms but not
  Cyrillic/Greek homoglyphs either.
- The reserved list blocks `takeoff`, `landing`, `private`, `public` — harmless but
  arbitrary — while omitting the ones that actually show up: `unnamed`, `none`,
  `n/a`, `null`, and anything normalizing to empty.
- `normalizedName` is added, indexed, and never consumed (E8).
- **Correct and well-argued:** no global uniqueness. "Place names repeat around the
  world; geo matching and duplicate suggestions are the v1 duplicate guard" is right,
  and a global unique name would let the first creator squat a common one. 2–80 chars
  is also the more defensible bound (my 2–60, justified by the curated set's longest
  name, is thin).

---

## Where Codex beats my draft

Stated plainly, because it is the most useful thing here:

1. **Q7 (site `kind`) — adopt Codex's answer wholesale.** Widening to `both` on
   explicit opposite-endpoint reuse makes the gazetteer improve with use; my
   "manual binds ignore `kind`, site unchanged" leaves the row permanently wrong and
   guarantees the next pilot creates the duplicate. "Never narrow" is the right guard.
2. **The backfill script's `--site-id` / `--public-only` flags.** Concrete operator
   ergonomics for exactly the deferred case. Mine gestured at this; Codex specified it.
3. **The "per-viewer cache" risk.** Codex names a real consequence of read-time
   resolution that my draft misses entirely, and ties it to the SPRINT-003 precedent.
4. **Overall scope restraint is the better call for this sprint.** Codex's committed
   scope is materially smaller than mine — no `/settings/sites`, no per-pilot caps, no
   admin script, and crucially no novel "dependency rule" edit model. Landing a
   headline privacy invariant is not the sprint to also introduce a bespoke
   authorization concept that needs its own test matrix. Codex is right that the
   review surface should stay small; it just cut one thing too many (D3).
5. **The options-object `findSite` signature** is cleaner than a fifth positional
   argument.
6. **"Ordered so the privacy invariant lands before user-facing creation"** — stating
   the ordering rationale explicitly is better practice than leaving it inferable,
   and it happens to also be the answer to the rollback risk (R3) that neither draft
   names.

---

## Minimum changes to make this draft mergeable

Ordered by severity. Everything here is a plan edit, not new scope.

1. **Resolve E3.** Drop the private-requires-owner CHECK and rely on the fail-closed
   predicate, or keep the CHECK and specify pre-cascade handling. As written, the
   sprint's own integration teardown fails.
2. **Fix E4.** State that the private branch is omitted entirely when `viewerId` is
   null, and add the anonymous row to the matrix.
3. **Pick an authority in D1** (site row when `siteId` non-null; cache only as the
   historical fallback), and add the `Flight.takeoffSiteId` / `landingSiteId` indexes
   the promotion/rename/delete `updateMany` needs (E8).
4. **Fix E5.** The create-dialog candidate query ignores `kind`; only the automatic
   matcher filters by it. Without this, Q7's widening rule is unreachable.
5. **Add a DoD line and a test for `scripts/backfill-sites.ts`** — it is the bulk
   writer of the cached columns and currently unscoped.
6. **Add R1 to the risk list** with one structural mitigation (refuse *public*
   creation inside an existing visible site's radius, and/or tie-break toward
   `license = 'curated'`).
7. **Give the pilot an undo (D3):** creator may delete or unpublish their own site
   while no other pilot's flight references it.
8. **Fix Q10's character rules:** strip bidi and zero-width (Cf) characters explicitly;
   drop the angle-bracket rule; either wire `normalizedName` to the duplicate check or
   remove the column.
9. **Invert Q5's emphasis:** the wider advisory radius is the primary path; the
   inside-match-radius branch is the race/backlog case.
10. **Spell out the e2e's distinct-IGC requirement** (R4), and name the
    throw-not-skip mechanism for the new suite (E9).
