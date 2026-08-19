# Critique - SPRINT-004 Claude draft

Reviewed against `SPRINT-004-INTENT.md`, `SPRINT-004-CLAUDE-DRAFT.md`, the current
code paths named in the intent, `CLAUDE.md`, and `SPRINT-004-CODEX-DRAFT.md` only
as comparison context.

Verdict: **Claude's draft is strong and, in several places, better than my draft.**
Its public-safe cache + viewer-scoped rehydration proposal is the right direction
for the denormalized-name leak, and its sequencing is unusually good: prove the
read-side privacy firewall before adding a UI that can create private sites. The
main problem is that the draft overstates the guarantee. The read resolver sketch
trusts non-null cached names, so it does not itself close a stale or buggy private
cache leak; it relies on every writer and every transition always preserving the
cache invariant. That is a good invariant, but the plan needs a stronger runtime
or transactional story before execution.

## Strengths

- **Correct center of gravity.** The draft identifies `Flight.takeoffSiteName` and
  `landingSiteName` as the sprint's sharp edge immediately, and makes the cache
  public-only (`SPRINT-004-CLAUDE-DRAFT.md:19-26`). That matches the current
  risk: ingest writes `takeoffSiteName` / `landingSiteName` directly from
  unscoped lookup today (`lib/ingest/ingest-flight.ts:69-73`,
  `lib/ingest/ingest-flight.ts:110-113`), while list/feed reads ship cached site
  fields directly (`lib/flights/repo.ts:15-26`, `lib/flights/repo.ts:222-238`).
- **The write-time vs read-time distinction is excellent.** Binding a flight using
  `public union owner's private` sites at ingest, then deciding per viewer whether
  the site name/id may be returned, is the right model (`SPRINT-004-CLAUDE-DRAFT.md:32-35`,
  `SPRINT-004-CLAUDE-DRAFT.md:301-303`). It avoids coupling flight visibility to
  site visibility.
- **PR sequencing is safer than my draft.** Claude explicitly blocks user-created
  private sites until after the read path is proven (`SPRINT-004-CLAUDE-DRAFT.md:68-72`,
  `SPRINT-004-CLAUDE-DRAFT.md:408-409`). My draft grouped viewer-safe DTO work
  earlier but was less crisp about "no creation before the leak is closed."
- **It catches a real existing test fixture problem.** `test/feed.integration.test.ts`
  fabricates `takeoffSiteName` without a `takeoffSiteId`
  (`test/feed.integration.test.ts:44-53`). Claude calls this out as a CHECK
  violation and an invariant hole (`SPRINT-004-CLAUDE-DRAFT.md:392-395`). That is
  better than my draft, which did not point to the concrete fixture.
- **It notices that landing is currently not rendered.** The existing flight page
  header uses only `takeoffSiteName` (`components/flight/flight-header.tsx:5-15`),
  and the row component also only renders takeoff (`components/logbook/flight-row.tsx:50-53`).
  Claude correctly says success criterion 1 requires a new landing surface
  (`SPRINT-004-CLAUDE-DRAFT.md:354-357`).
- **The DoD is unusually testable.** The leak sweep, positive controls for denied
  cases, transition assertions, CI-run Postgres matrix, and explicit deferred list
  are concrete (`SPRINT-004-CLAUDE-DRAFT.md:396-407`,
  `SPRINT-004-CLAUDE-DRAFT.md:467-516`). This is stronger than a generic "add
  privacy tests" plan.
- **The public UGC position is pragmatic.** Immediate publication with attribution,
  caps, validation, a dependency rule, and operator remedies is a coherent v1
  answer (`SPRINT-004-CLAUDE-DRAFT.md:615-627`). The operator remedy script is a
  useful addition my draft underweighted.
- **Dedup UX is better reasoned than my draft.** Claude correctly observes that if
  the dialog opens only for "Unknown site", the normal match radius has already
  failed, so reuse suggestions must be wider than 600 m / 900 m to matter
  (`SPRINT-004-CLAUDE-DRAFT.md:642-651`). My draft's "inside normal radius reuse
  first" framing was weaker unless the UI is also available on already-matched
  sites.

## Weaknesses And Factual Problems

### 1. The central resolver does not defensively close the leak

The proposed resolver only looks up sites where `siteId` is present and the
cached name is null (`SPRINT-004-CLAUDE-DRAFT.md:209-220`). That is fast, but it
means this row would leak to a stranger:

```ts
{
  visibility: "public",
  takeoffSiteId: "<private-site-id>",
  takeoffSiteName: "Private Launch"
}
```

Because `takeoffSiteName` is non-null, the resolver never checks the site row. The
plan's leak sweep would catch this in tests if the fixture exists, and the one
writer should prevent it in normal code, but the read path itself is not a
firewall against stale data, direct Prisma writes, bad scripts, failed migrations,
or future bypasses. This makes the claim that the leak is "impossible by
construction" too strong (`SPRINT-004-CLAUDE-DRAFT.md:23-25`,
`SPRINT-004-CLAUDE-DRAFT.md:520-527`).

The plan should choose one of these explicitly:

- Query visibility for every site id returned in viewer-facing flight rows, then
  trust cached names only after confirming the site is public or owner-visible.
  This costs one indexed `Site.id IN (...)` query per page with site ids, not just
  pages with null names.
- Keep the optimized null-name-only resolver, but describe the guarantee honestly:
  the cache invariant is a write-side invariant tested by sweeps, not a read-side
  authorization check.
- Add a stronger database/runtime mechanism, such as trigger-maintained public
  cache columns, if the team wants the "raw column is always safe" claim to be
  literally true.

### 2. There is a race between lookup and site visibility transitions

Current `ingestFlight` performs site lookup before the `flight.create`
(`lib/ingest/ingest-flight.ts:66-80`) and is not wrapped in a Prisma
`$transaction`, despite the comment describing one atomic transaction. Claude's
proposal says ingest will route through the public-cache helper, but if the flow
remains "lookup site -> compute public cache -> create flight", this interleaving
can leak:

1. Ingest looks up a public site and receives `{ id, name, visibility: "public" }`.
2. Another transaction demotes that site to private and nulls existing cached
   flight names (`SPRINT-004-CLAUDE-DRAFT.md:253-258`).
3. Ingest creates a new flight with `takeoffSiteId = site.id` and
   `takeoffSiteName = site.name` from the stale match object.

Postgres transactionality protects readers from half-finished demotion updates,
but it does not protect a writer that cached a stale match outside the transition
transaction. The plan needs a re-read of the matched site inside the flight-create
transaction, a lock/version check, or a post-create invariant repair before it can
claim transition safety.

The same race can create stale public names after rename. That is data quality
rather than privacy unless the transition is public -> private, but it is still a
cache-consistency issue.

### 3. "One writer" is an aspiration unless direct Prisma writes are audited

The draft says `lib/sites/associate.ts` is the only writer of the four cached
fields (`SPRINT-004-CLAUDE-DRAFT.md:189-201`, `SPRINT-004-CLAUDE-DRAFT.md:478-480`).
Today those fields are written directly in at least:

- `lib/ingest/ingest-flight.ts:110-113`
- `scripts/backfill-sites.ts:29-36`
- test fixtures such as `test/feed.integration.test.ts:44-53`

Claude plans to fix these specific locations, which is good. The gap is an
enforcement mechanism. The DoD should require an audited allowlist or test that
greps for `takeoffSiteName:` / `landingSiteName:` writes outside the helper,
with fixtures explicitly allowed only when they create a real public site id.
Otherwise "one writer" will regress silently.

### 4. The feed read-path cost is acceptable, but understated

The draft says anonymous/all-public reads cost nothing extra and mixed pages cost
"one small indexed query" only when a row has an id but no cached name
(`SPRINT-004-CLAUDE-DRAFT.md:209-212`). That is true only for the optimized
resolver described there. If the resolver is strengthened to verify all site ids
as suggested above, the friends feed pays an extra `Site.id IN (...)` lookup for
every page containing site ids.

Even with the optimized resolver, the keyset-paginated feed path now has these
costs:

- Existing friendship query (`lib/flights/repo.ts:209-218`)
- Existing flight page query with `take: limit + 1` (`lib/flights/repo.ts:222-238`)
- New site hydration query for up to two ids per visible row
- Existing kudo count query (`lib/flights/repo.ts:240-245`)

That is probably fine at the current `limit <= 50` (`lib/flights/repo.ts:206`),
because site lookup is by primary key and happens after the page slice. But it
should be named as a read-path cost, and tests should assert cursor stability is
unchanged after site-field resolution. Nulling site ids must not affect
`encodeFeedCursor`, which correctly uses only dates and flight id today
(`lib/flights/repo.ts:57-64`).

### 5. Public/private match ordering is under-specified for device push

Claude accepts private-site shadowing (`SPRINT-004-CLAUDE-DRAFT.md:305-308`), but
does not define deterministic tie-breaking when multiple visible candidates are
inside the radius. The current matcher does not order candidates in SQL and only
updates `best` on strictly smaller distance (`lib/sites/lookup.ts:30-45`), so
equal or near-equal candidates can depend on database return order.

This matters more for device push than for interactive upload: the device path
has no UI to ask whether the pilot wanted the public site or their private site.
The plan should specify a stable ordering, for example distance first, then
public/private priority if desired, then createdAt/id as a tiebreaker. It should
also test the case where an owner's private site and a public site are both
inside the radius.

### 6. Concurrent duplicate creation is missing

The dedup plan is user-friendly, but it is not concurrency-safe. Two pilots can
open unknown flights near the same point, both see no visible candidate, and both
create public sites. The partial unique index on `(ownerId, lower(name), kind)`
does not help across owners (`SPRINT-004-CLAUDE-DRAFT.md:165-167`), and because it
is not spatial it also over-blocks one pilot from using the same common name for
two different places.

This does not need a perfect geo uniqueness constraint in v1, but the risk should
be explicit. At minimum, creation should rerun the visible-site probe inside the
transaction immediately before insert. If the team wants stronger protection, use
an advisory lock on a rounded coordinate bucket plus kind while creating.

### 7. The uniqueness model conflicts with the naming answer

OQ10 says real gazetteers have repeated names and uniqueness is proximity-scoped
(`SPRINT-004-CLAUDE-DRAFT.md:709-714`), but the proposed DB backstop prevents the
same owner from creating the same lowercased name for the same kind anywhere in
the world (`SPRINT-004-CLAUDE-DRAFT.md:165-167`). That is not proximity-scoped.

Also, the name rules strip/normalize Unicode and compare diacritic-folded names
nearby (`SPRINT-004-CLAUDE-DRAFT.md:696-714`), but the DB index uses only
`lower("name")`. It will not catch NFKC-equivalent or diacritic-equivalent names.
My draft's `normalizedName` column is better on this specific point, although it
also needs a proximity-aware uniqueness story rather than a broad per-owner lock.

### 8. Delete semantics need a stronger DB-bypass warning

Claude is right that `onDelete: SetNull` on `Flight.takeoffSiteId` /
`landingSiteId` will not clear denormalized names by itself. It compensates with
`deleteSite` nulling cached names (`SPRINT-004-CLAUDE-DRAFT.md:253-258`,
`SPRINT-004-CLAUDE-DRAFT.md:392-393`). The missing warning is that any direct
`prisma.site.delete` or manual SQL delete leaves orphan cached names unless it
goes through the helper first. Because the draft adds an operator script, the
operator instructions should explicitly forbid raw site deletes and require the
same re-denormalization path.

### 9. `getFlightForViewer` returning `Flight` with rewritten fields is convenient but leaky as a type

Claude emphasizes "zero call-site churn" because `getFlightForViewer` can still
return `Flight` (`SPRINT-004-CLAUDE-DRAFT.md:235-237`). That is convenient, and
it may be worth keeping for sprint velocity. But after site scoping, the returned
object is no longer a database `Flight`: `takeoffSiteId` may be nulled for the
viewer even when the row has a site id. That is a view DTO masquerading as a model.

The plan should at least document that invariant. My draft's DTO language is
better here because it makes "viewer-safe display fields" explicit. Claude's
approach is lower-churn, but it increases the chance that a future mutation uses
a sanitized `Flight` object as if it were the persisted row.

## Gaps In Risk Analysis

- **Lookup/transition race** described above. This is the largest missing privacy
  risk.
- **Direct DB or Prisma bypasses** for site delete and cached-name writes. The
  draft names new-surface bypasses (`SPRINT-004-CLAUDE-DRAFT.md:525-527`) but not
  enough concrete enforcement.
- **Concurrency on create/reuse.** Same-place public duplicates and double-submit
  races are not covered.
- **Device ingest ambiguity.** No UI fallback means automatic tie-breaking,
  private-vs-public precedence, and same-coordinate candidates need explicit
  rules.
- **Cache invalidation / route revalidation.** The draft says names show
  immediately and transitions re-denormalize, but it does not specify
  `revalidatePath` coverage for flight page, logbook, profile, and feed after
  create/reuse/rename/promote/demote. If these pages are dynamic today this may
  be cheap, but the plan should state it.
- **CI fixture realism.** Claude depends on a new unknown-site IGC fixture
  (`SPRINT-004-CLAUDE-DRAFT.md:584-586`). That fixture must be far from all
  seeded sites in `prisma/seed.ts`, which currently seeds 12 globally distributed
  curated sites (`prisma/seed.ts:8-21`). This is doable, but it should be a named
  test data requirement in the E2E PR.
- **Backfill selection logic.** Current `scripts/backfill-sites.ts` only selects
  flights with `takeoffSiteId: null` (`scripts/backfill-sites.ts:13-16`), even
  though it also tries to backfill landing. Claude says it becomes a global sweep,
  but the plan should explicitly fix the selection to include missing landing ids
  too.

## Missing Edge Cases

- A public-to-private demotion racing with `ingestFlight`, creating a new cached
  private name after the demotion transaction.
- A site rename racing with ingest or backfill, creating stale cached names.
- Two create requests for the same endpoint on the same flight. The loser should
  not leave behind an unreferenced duplicate site.
- Two pilots creating the same public site concurrently after both passed the
  suggestion check.
- A device-pushed flight where both a public site and the owner's private site are
  inside radius. The plan needs deterministic precedence.
- A device-pushed flight after the original duplicate bytes were already ingested
  before a site existed. Current dedupe returns the existing flight without
  re-running lookup (`lib/ingest/ingest-flight.ts:39-55`). That is probably
  acceptable because the success criterion says "later flight", not duplicate
  re-upload, but it should be called out.
- A private site whose owner is deleted. Claude's fail-closed orphan behavior is
  reasonable (`SPRINT-004-CLAUDE-DRAFT.md:145-152`), but tests should assert an
  orphan private site is not returned by lookup or display hydration.
- Manual bind across kind mismatch. Claude allows it (`SPRINT-004-CLAUDE-DRAFT.md:648-650`,
  `SPRINT-004-CLAUDE-DRAFT.md:671-673`). That is defensible, but the plan should
  test whether later automatic ingest still respects `kind` and does not treat
  that manual bind as a reason to widen the site silently.
- Landing-site visibility in list surfaces. Current list/feed/profile rows do not
  select landing fields at all (`lib/flights/repo.ts:15-26`), and current UI rows
  render only takeoff (`components/logbook/flight-row.tsx:50-53`). If a pilot names
  only a landing site, "logbook/profile/feed show the new name" is not naturally
  true unless the UI adds landing display there too or the DoD narrows that claim.

## Definition Of Done Completeness

Claude's DoD covers most success criteria, but a few items need tightening:

1. **Criterion 1: name takeoff or landing in place.** Covered by the DoD and the
   new landing line (`SPRINT-004-CLAUDE-DRAFT.md:490-492`). Good.
2. **Criterion 2: immediate display everywhere denormalized names render.** Covered
   for takeoff. Ambiguous for landing because landing does not currently render
   anywhere (`rg` finds no app/component use of `landingSiteName`), and the draft
   says logbook/profile/feed all show "the new name" (`SPRINT-004-CLAUDE-DRAFT.md:490-492`).
   The DoD should define expected list behavior for landing-only site names.
3. **Criterion 3: later flights auto-associate, including device push.** Mostly
   covered (`SPRINT-004-CLAUDE-DRAFT.md:472-474`,
   `SPRINT-004-CLAUDE-DRAFT.md:496-499`). Add deterministic candidate ordering
   and explicit device tests for public-vs-private candidate conflicts.
4. **Criterion 4: near duplicate offers reuse.** Covered well, with a better-than-
   intent 2 km suggestion radius and distance/bearing display
   (`SPRINT-004-CLAUDE-DRAFT.md:493-495`).
5. **Criterion 5: private site never visible.** Covered strongly at the test
   matrix level (`SPRINT-004-CLAUDE-DRAFT.md:481-486`), but incomplete as a
   runtime guarantee unless the resolver verifies non-null cached names or the
   plan downgrades the "firewall" claim.
6. **Criterion 6: gates, whats-new, FEATURES.** Covered
   (`SPRINT-004-CLAUDE-DRAFT.md:510-513`). It also correctly aligns with
   `CLAUDE.md` validation gates (`CLAUDE.md:18-24`) and release-note requirement
   (`CLAUDE.md:59-62`).

Additional DoD items I would add before execution:

- Resolver either verifies all site ids on viewer-facing reads or explicitly
  documents that cache safety is write-side only.
- Ingest rechecks matched site visibility inside the transaction that creates the
  flight, or otherwise proves public-to-private demotion cannot race a cached name
  into a new row.
- A grep/audit test enforces cached-name writes only through the helper.
- Creation reruns duplicate detection inside the transaction and has a stated
  concurrency behavior.
- Feed pagination tests assert no overlap/skip after site hydration and id
  scrubbing.
- Backfill selection includes flights missing landing sites, not only
  `takeoffSiteId = null`.

## Open Questions, Compared

1. **Denormalization leak.** Claude's answer is directionally best: public-safe
   cache plus viewer-scoped rehydration keeps flight and site visibility
   independent and makes flight visibility transitions cheap
   (`SPRINT-004-CLAUDE-DRAFT.md:592-602`). It is better than forbidding private
   sites on visible flights. It is worse than the stronger DTO/read-check version
   in my draft only in one respect: the resolver sketch trusts non-null cache
   values and therefore does not defend against drift.
2. **Viewer-scoping `findSite`.** Claude is strong. Required defaultless scope
   makes old call sites fail at compile time, and owner-scoping ingest is correct
   (`SPRINT-004-CLAUDE-DRAFT.md:604-613`). My object-argument signature is
   slightly harder to misuse than appending a fifth positional argument, but that
   is minor.
3. **Public creation open or gated.** Claude is better than my draft because it
   pairs immediate publication with a concrete dependency rule and operator remedy
   (`SPRINT-004-CLAUDE-DRAFT.md:615-627`). My draft deferred more management,
   which left typo/abuse remedies weaker.
4. **Retroactive re-association.** Claude's "current flight plus creator's own
   unmatched flights, capped, no cross-pilot request-time relabeling" is well
   reasoned (`SPRINT-004-CLAUDE-DRAFT.md:629-640`). It should add the backfill
   selection fix for landing, but the policy is sound.
5. **Dedup / snap-to-existing UX.** Claude is better. The point that a same-radius
   suggestion is a no-op when the dialog only appears after lookup returned null
   is exactly right (`SPRINT-004-CLAUDE-DRAFT.md:642-645`). My draft should absorb
   that.
6. **Site coordinate.** Claude's rounded endpoint coordinate is good and gives a
   clear privacy reason (`SPRINT-004-CLAUDE-DRAFT.md:653-661`). Equivalent to my
   draft in outcome; Claude explains the private-flight correlation risk better.
7. **Site kind.** Claude is slightly better. Creating endpoint-specific kind and
   allowing explicit "also land/launch here" opt-in avoids overbroad `both`
   matches (`SPRINT-004-CLAUDE-DRAFT.md:663-673`). My draft's kind-widening on
   opposite-endpoint reuse is compatible, but Claude states the shared-state risk
   more clearly.
8. **Surface area.** Claude is strong: no site URLs/search/browse, keep
   `lib/prisma.ts` short-id policy unchanged, add only settings and the landing
   line (`SPRINT-004-CLAUDE-DRAFT.md:675-684`). This matches the intent.
9. **`Profile.homeSiteId`.** Claude is better than a simple "out of scope"
   because it explains why home site is a separate privacy design and a second
   possible leak path (`SPRINT-004-CLAUDE-DRAFT.md:686-694`).
10. **Naming rules.** Claude's validation rules are good and more internationally
    aware than an ASCII/simple-slug approach (`SPRINT-004-CLAUDE-DRAFT.md:696-714`).
    The weaker part is enforcement: DB uniqueness uses `lower(name)` rather than
    the normalized/folded representation, and the per-owner unique index is not
    proximity-scoped despite the prose saying uniqueness should be proximity-
    scoped.

## Recommended Revisions Before Merge Planning

1. Keep Claude's public-safe cache architecture, but change the resolver plan so
   it does not blindly trust non-null cached names for private-site authorization,
   or explicitly state that the read path depends on a write-side invariant.
2. Add a transaction/recheck requirement for ingest and backfill so site demotion
   cannot race a stale public match into a new cached private name.
3. Define deterministic automatic match ordering for device push when multiple
   visible sites are inside radius.
4. Add concurrency behavior for duplicate site creation and repeated endpoint
   submissions.
5. Replace or revise the partial unique index so it aligns with the normalized,
   proximity-scoped naming policy.
6. Clarify landing-only display expectations in logbook/profile/feed.
7. Add explicit allowlist/audit enforcement for cached-name writers and raw site
   deletes.

With those revisions, Claude's draft is the stronger planning base. The best
parts to preserve are the PR order, the explicit landing surface, the dependency
rule plus operator remedies, the wider dedup suggestion radius, and the
positive-control privacy matrix.
