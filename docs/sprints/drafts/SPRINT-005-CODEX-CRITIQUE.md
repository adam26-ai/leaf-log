# Critique — SPRINT-005 Codex draft (Site + Zone)

Reviewed: [`SPRINT-005-CODEX-DRAFT.md`](./SPRINT-005-CODEX-DRAFT.md) against
[`SPRINT-005-INTENT.md`](./SPRINT-005-INTENT.md) and the shipped
[`SPRINT-004.md`](../SPRINT-004.md) + the code it produced (`lib/sites/*`,
`lib/flights/repo.ts`, `app/flights/[id]/site-action.ts`).

**Verdict.** The privacy architecture is right and the PR sequencing is right. The
*matching* design has a load-bearing internal contradiction (§2.1) and a behavioural
regression against the intent's headline "no dead ends" criterion (§2.2), and the
retroactive-association rule silently misses the single most common real-world case
(§2.4). Fix those three and this is mergeable; ship it as-is and PR1 encodes a matcher
that contradicts its own use cases.

---

## 1. Strengths

1. **The anchoring decision is the correct one, and it's argued rather than asserted.**
   "`Site` remains the privacy boundary; `Zone` has its own owner for attribution and
   undo but inherits visibility" collapses the intent's Open Question 1 into a model
   where the SPRINT-004 privacy matrix extends by one dimension instead of multiplying by
   four. The stated reason — avoiding "a new class of *public parent reveals hidden
   child* bugs" — is the right reason. Independent `Zone.visibility` would have meant
   `canSeeZone` needing both rows, and every `resolveEndpoint` branch doubling.

2. **Keeping `Flight.{takeoff,landing}SiteId` pointed at the parent `Site` and adding
   *optional* `*ZoneId` is the lowest-risk answer to intent OQ2.** It means
   `resolveEndpoint()` (`lib/flights/repo.ts:150`), `statsFrom()` (`repo.ts:360`,
   `new Set(ready.map(f => f.takeoffSiteId))`), `referencedByOthers()`
   (`associate.ts`, the `OR: [{takeoffSiteId}, {landingSiteId}]` guard), and the entire
   existing privacy matrix keep working on the parent column. The alternative — repointing
   `*SiteId` at `Zone` — would have rewritten every one of those. The draft picks the
   option that lets the SPRINT-004 suite be *extended* rather than *rewritten*, which is
   exactly what the intent's success criterion 5 demands.

3. **The endpoint-specific fallback framing is a genuinely good idea** (even though the
   draft's implementation of it is broken — see §2.1/§2.2). "A site with only takeoff
   zones remains a landing fallback" is the right *intent*: it stops a half-mapped site
   from creating dead ends on the endpoint nobody has named yet.

4. **The stale-row defence is correctly generalised.** "strip both zone and site identity
   unless the parent site id independently resolves as visible" plus the PR2 test
   *"stale row with mismatched `zone.siteId` and `flight.siteId` cannot leak"* is the
   direct descendant of SPRINT-004's stale-row test, and it's the right shape: the read
   path stays safe even when the column is wrong.

5. **`findLocation` keeps `viewerId` required and defaultless**, preserving SPRINT-004's
   best trick — every un-updated call site becomes a compile error (`lookup.ts:20-31`,
   the comment there is explicit that this is deliberate). The DoD bullet *"no ingest
   caller can compile without stating write-time scope"* correctly restates it.

6. **The write-audit extension is named, not assumed.** Adding `*ZoneName` to
   `SITE_NAME_VALUE_ASSIGNMENT` in `lib/sites/write-audit.test.ts:47` is a two-character
   regex change that most drafts would have forgotten; this one puts it in PR2's task
   list *and* the DoD.

7. **`onDelete: Cascade` on `Zone.siteId` + `SetNull` on the four `Flight` zone FKs** is
   the correct pairing and matches the SPRINT-004 precedent (`Site.ownerId` is `SetNull`,
   deliberately, so teardown doesn't explode — SPRINT-004 documented why).

8. **PR sequencing is stated as a safety property**, not a convenience: *"user creation
   waits until the read-path firewall understands zones."* Same reasoning as SPRINT-004's
   "nothing can create a private site before the read path that hides one is proven."

---

## 2. Weaknesses

### 2.1 Use case 3 and the DoD contradict the retained `Site.kind` semantics — **blocker**

The draft keeps `Site.kind String @default("unknown")` and defines candidate step 2 as
*"Query visible endpoint-compatible sites by bbox…"*. `kindMatches()`
(`lib/sites/geo.ts:24`) is `candidateKind === requested || candidateKind === "both"` —
`"unknown"` matches **nothing**, and `"takeoff"` does not match a landing request.

Meanwhile `createOrAttachSiteFromFlight` creates sites with `kind: endpoint`
(`lib/sites/repo.ts`, the `mode === "create"` branch), and the draft does not change
that for `create_site`.

So for a site created from a takeoff with a first zone:

- Use case 3 claims *"A site has a takeoff zone but no landing zone. … landing matching
  may still use the parent site fallback until a landing zone exists."*
- DoD claims *"A site with a takeoff zone but no landing zone can still match as a
  landing fallback."*
- The actual matcher: `Site.kind = "takeoff"` fails `kind IN ('landing','both')`, so the
  site is **never** a landing candidate. Both statements are false.

The draft's own narrowing sentence — *"its meaning narrows: it is the fallback endpoint
kind for a site with no endpoint-compatible zones"* — is where the confusion enters. If
`Site.kind` is now a *fallback* kind rather than a *classifier*, then a site with zones
should stop filtering on it at all, or `create_site` should write `kind: "both"`. The
draft says neither. Pick one and say it in PR1:

- **(a)** Drop `Site.kind` from the fallback predicate entirely — a bare site is a
  candidate for both endpoints. Cleanest, but changes SPRINT-004 bare-site behaviour
  (a landing-only site would start matching takeoffs), which violates the intent's
  zero-behaviour-change clause.
- **(b)** Keep `Site.kind` filtering for zero-zone sites (exact SPRINT-004 behaviour),
  and for sites *with* zones treat the site as fallback-eligible for any endpoint that
  has no compatible zone, ignoring `Site.kind`. This is what use case 3 actually
  describes, and it's the one I'd take.

Either way the DoD bullet *"`Site.kind` remains only as fallback kind for direct site
matching"* is too vague to be checkable.

### 2.2 The exclusion rule creates dead zones — a regression against the intent's own success criterion

Candidate step 2 excludes a site from fallback the moment *any* endpoint-compatible zone
exists under it. Radii stay at 600 m / 900 m for both levels (the draft: *"Run exact
haversine filtering with the existing 600 m takeoff and 900 m landing radii"*).

Concrete failure: "Mission Ridge" is a bare public site at the ridge centre. Today a
launch anywhere within 600 m of that point matches it. Pilot A names "North Launch" at
the north end. Now a pilot who launches from the south end — 700 m from North Launch,
150 m from the Site coordinate — matches **nothing** and gets "Unknown site".

That is a strictly *worse* outcome than SPRINT-004 produced, caused by another pilot's
contribution, and it silently un-labels flights that used to label themselves. The intent
is unambiguous on this point:

> …with **no dead ends**: every previously-matchable case (a bare site, exactly as
> SPRINT-004 produces today) keeps working with zero behavior change from a pilot's
> perspective.

The draft narrows this to bare sites only (DoD: *"A **bare site with zero zones** still
matches and displays exactly like SPRINT-004"*) without flagging the narrowing, and the
PR1 test *"site with takeoff zone does not also match as bare takeoff"* actively locks
the regression in.

The fix is cheap and it's also the answer to **intent OQ4, which the draft never
answers**: rank zones and the parent site in one set *without* mutual exclusion, with
zone-before-site as a **level** precedence rather than a tie-break, and give the site
fallback a wider radius than the zone radius (zones are precise spots; the site is an
area). Something like `ZONE_RADIUS = 400 m / 600 m` and `SITE_FALLBACK_RADIUS = 600 m /
900 m`, zone wins whenever any zone is in its radius. That preserves use case 1, use
case 3, *and* the no-dead-ends criterion, and it removes the need for the awkward
`zones: { none: ... }` correlated subquery in step 2 entirely.

### 2.3 "visible endpoint-compatible zones" is a leftover from the model the draft rejected

Step 1 joins parent `Site` with `siteVisibleWhere(viewerId)` — correct. But step 2's
*"where no **visible** child zone exists"* implies per-zone visibility, which §Architecture
explicitly forbids ("A public zone under a private site, or a private zone under a public
site, is not a v1 state"). Under inheritance, every zone of a visible site is visible and
every zone of a hidden site is hidden, so "visible" is dead weight that invites a reader
to implement a per-zone predicate that doesn't exist. Delete the word or, better, delete
the rule per §2.2.

### 2.4 `reassociateOwnFlights` will skip the most common case

`lib/sites/repo.ts` filters candidates on `[siteIdField]: null`:

```ts
const where: Prisma.FlightWhereInput = {
  ownerId, status: "ready", [siteIdField]: null, ...
};
```

The draft's rule — *"When a new zone is created, reassociate the creator's own matching
**unmatched** endpoints to the zone"* — keeps that predicate. But the headline scenario
for this whole sprint is a pilot who has *already* been flying Mission Ridge, whose
flights are all bound to the bare site (`takeoffSiteId = <site>`, `takeoffZoneId = null`),
and who now names "North Launch". Every one of those flights has a non-null `siteId`, so
the reassociation query returns **zero rows**. Their logbook stays "Mission Ridge" while
new flights read "Mission Ridge — North Launch" — the exact split-display problem the
sprint exists to solve, delivered by the sprint that solves it.

The predicate needs to become, for `create_zone` / zone-target reassociation:

```
[siteIdField]: null  OR  ([siteIdField]: parentSiteId AND [zoneIdField]: null)
```

still owner-scoped, still bbox-prefiltered, still capped at `REASSOCIATE_CAP = 200`,
still logging truncation. This is a real change to a function the Files Summary already
lists as modified; it just isn't described.

### 2.5 No zone-level create cap, and no consequence copy on `create_zone`

SPRINT-004 made `DAILY_CREATE_CAP = 10` (`lib/sites/repo.ts:51`) load-bearing, because
Public is preselected and there is no moderation model:

> Because it overrides that default, three things are load-bearing rather than optional:
> the dialog shows consequence copy before the save, the creator undo is in committed
> scope, and a daily create cap stays.

The draft carries over exactly one of the three to zones. `create_zone` gets no cap
(`tx.site.count({ ownerId, createdAt: { gte: startOfDayUtc } })` counts sites only), and
the consequence-copy sentence is scoped to `create_site` only: *"`create_site` … Public
remains preselected, with SPRINT-004 consequence copy."* A pilot adding a spot under
someone else's public site is publishing a name and a coordinate to every pilot, with no
copy telling them so and no cap. Both belong in PR3.

### 2.6 The zone creator's "undo" is materially weaker than SPRINT-004's, and the site
owner has no remedy at all

Use case 7: *"A zone creator can rename, **unpublish via parent-site demotion when they
own the site**, or delete their own zone while no other pilot's flight references it."*

Read that carefully: if you add a zone to *another* pilot's public site — which the
draft explicitly supports as `create_zone` — you cannot unpublish it, because you don't
own the site and zones have no visibility of their own. Your only undo is delete, and
delete is gone the instant one stranger's flight binds to it. SPRINT-004's creator undo
had two levers; here it has one, and only under a site you happen to own.

The mirror-image gap is sharper: **the site owner cannot remove a bad zone from their own
site.** `deleteZone` is gated on zone ownership. So a stranger can attach "Bob's Cliff of
Death" to your public site and neither of you can take it down — only
`scripts/admin-sites.ts delete-zone` can. SPRINT-004's guiding principle was *"a bad
public name must always be fixable by someone"*; that's technically still true, but the
draft has moved a whole class of graffiti from "creator can undo it" to "email the
operator", without noting the change or listing it as an accepted residual risk.

Minimum fix: let the parent site's owner delete/rename a zone under their site (they
already control its visibility wholesale via demotion, so this grants no new power), and
say so in the Security section.

### 2.7 `deleteSite` can silently destroy another pilot's zones

`referencedByOthers()` counts *flights* owned by other pilots
(`OR: [{takeoffSiteId}, {landingSiteId}], ownerId: { not: ownerId }`). With
`Zone.siteId onDelete: Cascade`, a site owner deleting their site also destroys every
zone another pilot contributed. If those zones have no flights bound yet, the existing
guard doesn't fire and the contribution vanishes with no trace. The draft's PR4 lists
`deleteZone` and *"zone-aware `deleteSite`"* but never says what "zone-aware" means here.
It should mean: extend the guard to `count(zones WHERE ownerId <> siteOwner) === 0` as
well.

### 2.8 The cross-row invariant is dismissed a step too early

> Prisma cannot express "zone.siteId equals flight.siteId" as a cross-row CHECK, so all
> writes go through `lib/sites/associate.ts`.

True for `CHECK`, but not for foreign keys. `Zone` with `@@unique([id, siteId])` plus a
composite FK on `Flight (takeoffZoneId, takeoffSiteId) → Zone(id, siteId)` enforces the
invariant in Postgres, and Prisma 6 can declare it. The reason to *reject* it is real —
`onDelete: SetNull` on a composite FK nulls **both** columns, so deleting a zone would
also detach the parent site, which contradicts the draft's own rule *"Parent site ids
remain unless the delete action also deliberately detaches the endpoint."* That's a good
argument. Make it, the way SPRINT-004 made the argument for why there is deliberately no
"private ⇒ owned" CHECK. Right now the draft reads as if the option didn't exist.

### 2.9 A new mixed-provenance display state, undiscussed

Read-path rule 3: *"If `siteId` is non-null and visible but `zoneId` is null, return the
live site name **and the cached zone name only as a historical suffix**."*

This composes a live `Site.name` with a dead `Flight.*ZoneName` — a state SPRINT-004
never had. There, the rule was absolute: id non-null ⇒ the row wins entirely; id null ⇒
pure cache (`resolveEndpoint`, `lib/flights/repo.ts:150-165`). The new hybrid means a
flight can render "Mission Ridge — North Launch" for a zone that was deleted months ago,
next to a flight at the identical coordinate reading "Mission Ridge". I don't think it's
a *leak* — the demote/rename writers null `*ZoneName` via the `*SiteId` updateMany, which
still matches these rows — but it is a correctness-of-display decision that deserves a
sentence and a test, or should simply be dropped (null `*ZoneName` in `deleteZone` and
keep the cache purely for the `siteId IS NULL` case, matching SPRINT-004 exactly).

### 2.10 Smaller, concrete

- **`pnpm db:reset` does not exist.** `package.json` has `db:up`, `db:down`, `db:migrate`,
  `db:seed`, `db:studio` — no `db:reset`. The line should say `pnpm exec prisma migrate
  reset && pnpm db:seed`.
- **The E2E's "seeded site that has no zones" has no seed to come from.** PR #40 removed
  the curated seed; `prisma/seed.ts` now logs *"no seed data — sites are fully
  community-driven"*. The bare-site fallback leg needs the site created through the UI
  (name it without a spot name) or via a test fixture — say which.
- **`listOwnFlightsByIds` (`lib/flights/repo.ts:287`) does not call `resolveSiteFields`.**
  It returns raw `LIST_SELECT` rows to `app/settings/devices/page.tsx:15`. It's
  owner-scoped so it isn't a leak today, but adding `*ZoneName` to `LIST_SELECT` widens an
  already-unresolved path, and the DoD claims *"`lib/flights/repo.ts` re-verifies every
  non-null site id and zone id on **every** display read."* Either route it through the
  resolver or carve it out explicitly.
- **`compareLocationCandidates` inherits a dead tie-break.** `compareSiteCandidates`
  (`geo.ts:122`) ranks `license === "curated"` first; with PR #40 gone, no curated row can
  exist, and `Zone` copies `license`/`sourceId`/`sourceUrl` with no stated use. Either
  drop the curated rank or say it's kept for a future gazetteer import.
- **`reuse_zone` doesn't widen `Zone.kind`.** SPRINT-004's rule is explicit and tested
  ("opposite-endpoint reuse widens `kind` to `both`; never narrows"). The draft applies it
  to `reuse_site` and omits it for `reuse_zone`, so binding a `kind:"takeoff"` zone as a
  landing leaves it un-matchable for future landings. Inconsistent with the precedent it
  claims to reuse.
- **Zone dedup has no proximity component.** Sites reject a `normalizedName` conflict
  within `SUGGEST_RADIUS_M = 2000`; zones only reject *"duplicate zone names … within the
  same site"*. Nothing stops "N Launch" and "North Launch" 10 m apart under one site. The
  suggestion ordering mitigates it; say so, the way SPRINT-004 said "residual duplicates
  are a data-quality issue, not a correctness one."

---

## 3. Gaps in risk analysis

The Risks section has eight entries and is well-written, but it is a strict subset of
SPRINT-004's and drops categories that got *worse*, not better, with a second level:

| SPRINT-004 risk | SPRINT-005 status |
|---|---|
| Near-duplicate proliferation | **Missing.** Two levels means two duplicate axes (duplicate sites *and* duplicate zones under one site), and zone dedup is weaker than site dedup (§2.10). |
| Community vandalism / bad public names | **Missing**, and §2.6 makes it materially worse: graffiti on another pilot's site is operator-only to remove. |
| Public-by-default increases accidental publication | **Missing**, despite `create_zone` shipping with no consequence copy and no cap (§2.5). |
| Private-site shadowing | **Missing.** Now compounded: a pilot's private zone under their private site can shadow a nearby public site's zone in their own matching. |
| Re-association cost | **Missing**, and the fix in §2.4 makes the candidate set *larger* (site-bound flights now qualify), so the 200 cap is more likely to truncate. |
| Rollback | **Missing.** SPRINT-004 explicitly reasoned "a revert of PR3/PR4 leaves a coherent system." Here it's sharper and worth stating: reverting PR3/PR4 after zones exist in production leaves rows the reverted read path doesn't understand. What's the story? |

Two risks the draft names but under-mitigates:

- **"Larger read-path cost"** — the mitigation says *"one additional `Zone.id IN (...)`
  lookup after page slicing, with parent `Site` selected in the same query."* But
  `resolveSiteFields` already batches a `Site.id IN (...)`; adding a zone query that
  *also* joins `Site` means two queries returning overlapping site rows, and the resolver
  now needs a merge rule for when the two disagree. Say it's one query (`Zone` with
  `include: { site: ... }`) unioned into the existing site map, or say it's two and
  which wins.
- **"Schema invariant not fully enforceable in Prisma"** — see §2.8; the mitigation list
  is right but the premise is overstated.

**One risk nobody names:** the matching-behaviour change in §2.2 is *retroactive from the
pilot's perspective* — the first zone anyone creates changes what every subsequent flight
at that site matches, for every pilot, with no notification. Even after fixing §2.2 to
remove the dead zones, the display split (§2.4) is a real "why does my logbook say two
different things" support issue. It deserves an entry.

---

## 4. Missing edge cases

The intent lists six edge cases to *explicitly handle*. Scoring the draft:

| Intent edge case | Handled? |
|---|---|
| Site with zero zones matches/displays | ✅ Use case 2, PR1 test, DoD bullet |
| One zone vs multiple zones of the same kind | ✅ PR1 test: *"two zones of the same kind sort by distance then deterministic tie-break"* |
| Takeoff and landing under two different sites / same site different zones / same zone | ⚠️ **Partial.** Endpoints are matched independently, which is correct, but no use case, no test, and no statement of what the flight header renders when the two parents differ, or whether `statsFrom`'s `siteCount` counts one or two. |
| Private zone under public site / public zone under private site | ✅ Answered decisively (not a v1 state) — the best-handled of the six |
| Deleting/unpublishing a zone: last zone vs others remain vs site still has direct flights | ❌ **The "last zone" case is missing entirely.** Deleting the last zone under a site re-opens site fallback eligibility under the draft's own rule, silently changing matching for every future flight there. No test in PR4's list covers it. The "site still has flights directly matched to it" case is also untested — those flights keep `siteId` while zone-bound siblings lose `zoneId`, and the two now display differently. |
| Concurrent zone creation under the same site | ✅ PR3 test, in-transaction re-probe |

Additional edge cases neither document raises:

1. **A zone whose coordinate is outside its parent site's radius.** Nothing constrains
   `Zone.lat/lon` relative to `Site.lat/lon`. A pilot at an LZ 4 km down-valley opens the
   dialog, sees "Mission Ridge" within the 2 km suggest radius, and picks *Add spot* —
   creating "Lower LZ" 4 km from the site anchor. Legitimate, arguably, but it means
   `Site.lat/lon` stops being a meaningful anchor for the fallback candidate query. Either
   constrain zone creation to some `MAX_ZONE_OFFSET_M` from the parent, or state
   explicitly that the site coordinate is only ever a fallback anchor and zones are free.
2. **A flight whose endpoint has no coordinate.** SPRINT-004 tests this
   (*"a flight with no fix for that endpoint offers no affordance"*, and
   `endpointCoord()` returns null). PR3's test list drops it.
3. **`onDelete: SetNull` on `Zone.ownerId` when a `User` is deleted.** SPRINT-004 chose
   `SetNull` for `Site.ownerId` and documented *why* there is no "private ⇒ owned" CHECK
   (it would break integration teardown). `Zone` copies the `SetNull`, correctly — but an
   orphaned zone under a *public* site stays fully visible with no attribution, whereas an
   orphaned *private site* is deliberately readable by nobody (`canSeeSite`'s
   `ownerId IS NOT NULL AND ownerId = viewerId` fail-closed branch). That asymmetry is
   probably fine but is unstated.
4. **Zone rename when the parent site is private.** The draft's transition writer says
   *"Zone rename: update only `*ZoneName` on zone references **when parent site is
   public**."* Correct — but it means a private-site zone rename writes nothing, and the
   owner still sees the new name only because the resolver reads the live row. Worth one
   test, mirroring SPRINT-004's "a private site's cache stays NULL either way."
5. **`Profile.homeSiteId`.** Dormant since SPRINT-004 (schema comment says so explicitly)
   and `Site.homeProfiles` survives in the draft's schema block — but the draft never says
   whether a home *zone* is a thing. One sentence in "explicitly out of scope" closes it,
   matching SPRINT-004's treatment.

---

## 5. Definition of Done completeness

21 checkboxes, all specific and checkable — better than most. But measured against
SPRINT-004's 25, six things that were load-bearing there have quietly dropped out:

**Missing outright:**

- ❌ **"CI provisions Postgres and the matrix actually runs (throws, does not skip)."**
  SPRINT-004 made this a DoD bullet precisely because the integration tests auto-skip
  without `DATABASE_URL` (per `CLAUDE.md`), and *"a skipped sites matrix means the privacy
  work is unverified."* With zones added, a silently-skipped suite is the single most
  likely way this sprint ships a leak. This is the most important omission in the DoD.
- ❌ **The leak sweep.** The intent asks for it by name: *"the CI leak sweep SPRINT-004
  introduced should be extended to assert no private zone name/id leaks either."*
  `test/sites.integration.test.ts:314` is the existing sweep. PR2's test list has the
  stale-row test but not the sweep, and the DoD has neither.
- ❌ **A daily create cap** (§2.5). SPRINT-004: *"A daily create cap is enforced; every
  create / bind emits a structured log line."* The draft keeps the log line (PR3) and
  drops the cap.
- ❌ **"No site read for display outside `lib/sites/repo.ts` — audited allowlist."**
  This exists in SPRINT-004's DoD and now needs to cover `prisma.zone` too. It's asserted
  in the draft's Security section (*"Raw `prisma.site`/`prisma.zone` reads for display are
  forbidden"*) but not made a checkable DoD item.
- ❌ **Feed cursor stability + dynamic/`no-store`.** PR2's test list has *"site/zone id
  nulling does not change feed cursor stability"*; the DoD doesn't. Zone names now also
  vary by viewer, so the "these pages may never become publicly cacheable" constraint
  applies with more force, not less.
- ❌ **A "deferred items NOT shipped" bullet.** SPRINT-004's final DoD line enumerates
  what must *not* appear. The draft has a good "Explicitly out of scope" prose section
  (independent zone visibility, move-zone, site pages, cross-pilot re-association) but
  never converts it to a check, so scope creep in PR3/PR4 has nothing to fail against.
- ❌ **`/qa-prompt` hand-off.** Named in PR4's task list, absent from the DoD; SPRINT-004
  had it in both.

**Present but not checkable as written:**

- *"`Site.kind` remains only as fallback kind for direct site matching."* — no observable
  behaviour to verify, and it's the exact bullet that §2.1 shows is ambiguous. Restate as:
  *"a site with a takeoff zone and no landing zone matches a landing endpoint by fallback"*
  — which is testable, and currently false.
- *"Matching ranks endpoint-compatible zones and endpoint-fallback sites in one
  deterministic candidate set."* — "deterministic" needs the SPRINT-004 phrasing that
  names the order and the scenario: *"tested with a zone and a bare site both in radius,
  and with two same-kind zones at equal distance."*
- *"Creator undo works for zones independently of site ownership until another pilot
  references the zone."* — as written this is **false** for unpublish (§2.6); it's true
  only for delete. Split it into two bullets or fix the design.

**Good bullets worth keeping verbatim:** the `*SiteName`/`*ZoneName` allowlist bullet, the
in-transaction re-resolve bullet, the "private parent site hides all child zones from
matching, suggestions, **and** display" bullet (the three-surface phrasing is exactly
SPRINT-004's and it's what makes the matrix test complete), and the read-DTO bullet.

---

## 6. Also worth deciding before merge

The intent poses six Open Questions and SPRINT-004's house style resolves every one in a
numbered "Open Questions (resolved here)" section. The draft's Open Questions section
contains three *new* questions instead, leaving the intent's OQ4, OQ5 and OQ6 answered
only implicitly or not at all:

- **OQ4 (radii)** — unanswered; the draft just reuses 600/900 for both levels. §2.2 argues
  this is the wrong answer, not merely an unstated one.
- **OQ5 (denormalized "has zones" flag)** — implicitly answered *no* (the fallback query
  derives it with `zones: { none: ... }`), but never stated, and it's the one decision
  that touches the matching hot path. Say it and say why (site counts are tiny; a flag is
  a cache-invalidation liability on every zone create/delete).
- **OQ6 (local dev migration)** — one sentence, with a script name that doesn't exist
  (§2.10).

The draft's own three new questions are good ones. **Q1 (`Zone` in code, "spot" in copy)**
is the right call and should be promoted from a question to a decision — the UI shape
section already writes `Spot name`, so leaving it open means PR3 has two names for one
thing. **Q3 (`move-zone` in operator tooling)** should probably become *yes*: §2.7 and
§2.6 both end in "the operator fixes it", and merge-plus-delete can't repair a zone
filed under the wrong parent without destroying the flights bound to it.
