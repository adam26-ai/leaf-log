# SPRINT-004 merge notes

How the final [`SPRINT-004.md`](../SPRINT-004.md) was reached from two independent
drafts, two cross-critiques, and the planning interview.

**Workflow:** `consensus(opus-4.8, gpt-5.5)` per the Weather Report's Sprint Planning
row (max / extra-high effort) — the same pair used for SPRINT-002 and SPRINT-003.
Gemini is listed there as optional ("can improve consensus in some cases") and was
not run, matching the precedent of the last two sprints.

> **Tooling note.** The Codex CLI was broken at the start of this session — the
> vendored binary under `@openai/codex@0.125.0` was missing (`ENOENT`). Repaired with
> `npm i -g @openai/codex` before the gpt-5.5 draft ran.

## The headline result: independent convergence

Both models, working only from `SPRINT-004-INTENT.md` and the codebase, arrived at the
**same architecture** for the sprint's central hazard (OQ1):

- `Flight.takeoffSiteName` / `landingSiteName` are redefined as a **public-name cache**.
  A private site sets the id and leaves the name `NULL`.
- Site names and ids are resolved **for the viewer** inside `lib/flights/repo.ts`.
- When the viewer may not read the site, **both** the id and the name are stripped, so
  the row carries nothing about a site the viewer isn't entitled to.
- `findSite` takes a **required** viewer scope so every existing call site fails to
  compile until made explicit; `ingestFlight` passes `viewerId: ownerId`, which leaves
  both routes (web upload and device push) untouched.

Codex stated the underlying principle most crisply, and the final document adopts its
framing: **flight visibility and site visibility are independent**. The property that
falls out — *changing a flight's visibility requires no site writes at all* — is what
makes the design safe, and it is the reason both drafts rejected the alternative of
forbidding private sites on non-private flights.

Convergence this strong means the remaining work was mechanism, not architecture.
Both critiques agreed on that assessment independently.

## Claude (opus-4.8) draft — strengths carried forward

1. **The alternatives table for OQ1.** Four options weighed with explicit verdicts,
   including why "null the cache for everyone" breaks the core promise (your own
   logbook stops showing the name you typed).
2. **PR ordering as a safety property.** The read path that hides a private site ships
   and is proven *before* any UI can create one. Adopted verbatim.
3. **A real defect found in existing code.** `test/feed.integration.test.ts:52`
   fabricates `takeoffSiteName` with no `takeoffSiteId` — verified accurate. It is a
   hole in the invariant and would violate the new CHECK.
4. **The dedup no-op insight.** A suggestion radius equal to the match radius is
   useless *by construction*: the dialog only opens because `findSite` already returned
   null there. Codex's critique called this "exactly right" and conceded the point.
5. **Name validation depth** — bidi/zero-width (Cf) stripping as a homograph defence,
   script-agnostic charset (this is an international sport), reserved-word rejection.
6. **OQ9 (`Profile.homeSiteId`)** — argued out rather than waved off: a home site is a
   second name-leak path, and adding it to the review surface of the PR closing the
   first one is a bad trade.
7. **Fail-closed `visibility` handling** and the observation that a "private ⇒ owned"
   CHECK is incompatible with `onDelete: SetNull`.

## Codex (gpt-5.5) draft — strengths carried forward

1. **The independence framing** (above) — the final Overview uses it.
2. **Viewer-safe DTOs.** Naming the repo's return value as a display DTO rather than
   returning a `Flight`-shaped object whose `takeoffSiteId` may be nulled. Claude's
   critique conceded this: a sanitized `Flight` is "a view DTO masquerading as a model"
   and invites a future mutation to treat it as the persisted row.
3. **`kind` widening on explicit opposite-endpoint reuse; never narrow.** Adopted
   wholesale over Claude's "manual binds ignore kind, site unchanged", which leaves the
   row permanently wrong and guarantees the next pilot creates the duplicate.
4. **Backfill script flags** `--site-id` / `--public-only` — concrete operator
   ergonomics for exactly the deferred cross-pilot sweep.
5. **The "per-viewer cache" risk**, tied to the SPRINT-003 `no-store` precedent. Claude's
   draft missed it entirely: once site names resolve per viewer, profile/feed/logbook
   rows genuinely differ by viewer and must not be publicly cacheable.
6. **Options-object `findSite` signature** — harder to misuse than a fifth positional
   argument.
7. **`normalizedName` as a stored column** for NFKC/diacritic-aware comparison, versus
   Claude's `lower(name)` index which cannot catch the equivalences its own validator
   normalizes.
8. **Scope restraint.** Materially smaller committed scope. Claude's critique conceded
   this was the better call — "landing a headline privacy invariant is not the sprint to
   also introduce a bespoke authorization concept that needs its own test matrix" — while
   arguing it cut one thing too many (the undo; see D3 below).

## Critiques accepted

### Codex → Claude

| # | Finding | Resolution |
|---|---------|------------|
| C1 | **The resolver doesn't close the leak.** It only queries `Site` when a row has an id *and* a null name, so a row with a stale non-null name pointing at a private site is never checked. "Impossible by construction" was overstated. | **Accepted — and settled by the interview.** The read path now verifies **every** non-null site id. See *Interview refinements* #1. |
| C2 | **Ingest race.** `findSite` runs before `prisma.flight.create` and outside any transaction (`lib/ingest/ingest-flight.ts:66-80`). A site demoted between match and create writes a stale public name onto the new flight. | **Accepted.** The matched site is re-read inside the flight-create transaction and the cache recomputed from that read. |
| C3 | **"One writer" is aspiration without enforcement.** Those columns are written today in ingest, the backfill script, and test fixtures. | **Accepted.** A DoD line requires an audited allowlist test that fails on cached-name writes outside the helper. |
| C4 | **Feed read-path cost understated.** | **Accepted.** The cost is named explicitly, and a test asserts keyset cursor stability is unaffected (`encodeFeedCursor` uses only dates + id, so nulling site ids must not perturb it). |
| C5 | **No deterministic tie-break** when a public site and the owner's private site are both in radius — worst on device push, which has no UI to ask. | **Accepted.** Ordering is distance → curated → id, specified and tested. |
| C6 | **Concurrent duplicate creation** across two pilots is unguarded. | **Accepted.** The visible-site probe re-runs inside the create transaction. |
| C7 | **The uniqueness index contradicts its own prose.** A partial unique index on `(ownerId, lower(name), kind)` is global-per-owner, not proximity-scoped, and blocks one pilot from naming two different places "Le Col"; `lower()` also misses the NFC/diacritic equivalences the validator normalizes. | **Accepted.** Index dropped; replaced by Codex's `normalizedName` column plus the proximity probe. |
| C8 | **Delete bypass.** A raw `prisma.site.delete` leaves orphan cached names. | **Accepted.** Operator instructions forbid raw deletes; the remedy path re-denormalizes. |
| C9 | **`Flight`-shaped return is a leaky type.** | **Accepted.** Adopted Codex's DTO naming. |

### Claude → Codex

| # | Finding | Resolution |
|---|---------|------------|
| E3 | **`CHECK (visibility <> 'private' OR ownerId IS NOT NULL)` and `onDelete: SetNull` are mutually contradictory.** Deleting a `User` cascades to `Profile`, fires `SET NULL` on `Site.ownerId`, and violates the CHECK. **This breaks the sprint's own test teardown on day one** — every integration suite deletes its pilots in `afterAll` (`test/privacy.integration.test.ts:217`, `feed:76`, `social:88`). | **Accepted.** CHECK dropped. The fail-closed read predicate (`ownerId IS NOT NULL AND ownerId = viewerId`) is the backstop, so an orphaned private site is readable by nobody. |
| E4 | **Prisma `{ ownerId: null }` compiles to `IS NULL`**, so the private branch as written matches *every orphaned private site* for an anonymous viewer. | **Accepted.** The private branch is omitted entirely when `viewerId` is null; the anonymous row is in the matrix. |
| E5 | **The dedup query filters by `kind`**, so an opposite-endpoint site can never surface as a reuse candidate — making Codex's own `kind`-widening rule unreachable. | **Accepted.** The *create-dialog* candidate query ignores `kind`; only the *automatic* matcher filters by it. |
| E6 | **The "primary" reuse branch is nearly unreachable** (same insight as the dedup no-op). | **Accepted.** The wider advisory radius is the primary path. |
| E7 | **4-dp rounding is not a privacy mitigation** — `Flight.takeoffLat/Lon` are stored at full precision and the track is served to anyone who can see the flight. | **Accepted.** Rounding kept, justification corrected to what it actually buys: de-correlating the public site row from one private flight's exact fix. |
| E8 | **Missing indexes.** Promotion/rename/delete need `UPDATE Flight WHERE takeoffSiteId = $1`; `Flight` has no index on either site-id column. | **Accepted.** Both indexes added. |
| D1 | **The cache has no declared authority.** "May be used as the fast path but must agree" never says which value wins — and either answer breaks something (join-wins silently reverts deleted-site flights to "Unknown site", destroying the column's documented "kept for history" purpose; cache-wins means an operator deleting an abusive public site doesn't remove its name from other pilots' logbooks). | **Accepted, and reinforced by the interview.** The **site row is authoritative whenever `siteId` is non-null**; the cache is the historical fallback **only** when `siteId IS NULL`. |
| D2 | **`@default("public")` fails open** while the normalizer fails closed. | **Accepted.** No column default at all — Prisma then requires it on every create — plus an explicit backfill in the migration. |
| D3 | **Public creation is a one-way door** with no in-product remedy. | **Accepted; settled by the interview.** See *Interview refinements* #2. |
| D4 | **The migration's own backfill is unverified.** | **Accepted.** An integration assertion covers the curated rows. |

## Critiques rejected, or accepted only in part

- **Claude's `/settings/sites` management page** — *rejected in favour of the narrower
  undo.* Codex's scope-restraint argument won: this sprint should not also introduce a
  bespoke "dependency rule" edit model with its own test matrix. The undo (below) gets
  the safety benefit at a fraction of the review surface.
- **Claude's per-pilot daily caps (25/day, 10 public/day)** — *kept, but simplified to a
  single daily create cap.* The elaborate two-tier version was scope; some cap is real
  abuse mitigation, and the interview's choice of a public-preselected dialog raises the
  volume of accidental public sites, which argues for keeping it rather than cutting it.
- **A DB trigger to maintain the cache** (Codex critique's third option for C1) —
  *not adopted.* The interview chose strict read-side verification instead; triggers are
  new territory for this repo's hand-written migrations and harder to test than a repo
  function with an integration matrix.
- **Codex's `Site.source` CHECK including only `manual | user`** — *kept*, but noted as a
  constraint to revisit if a gazetteer import ever lands (still blocked on
  ParaglidingEarth redistribution terms).
- **Claude's "manual binds ignore `kind`, never promote"** — *rejected* in favour of
  Codex's explicit widening, per both critiques.

## Interview refinements applied

1. **Strict read path.** The repo verifies visibility for **every** non-null
   `takeoffSiteId` / `landingSiteId` on every display read — one indexed
   `Site.id IN (...)` query per page that has any site ids, the friends feed included.
   The site row wins whenever an id is present; the cached column is used only as the
   historical fallback when `siteId IS NULL`. This settles C1 and D1 together and makes
   the read path a genuine firewall rather than a write-side invariant with a test.
   *Cost accepted deliberately:* the extra query is by primary key, runs after the page
   slice, and the feed's limit is capped at 50 (`lib/flights/repo.ts:206`).
2. **Undo while unreferenced.** The creator may unpublish or delete their own site while
   **no other pilot's flight references it** — one `count()` guard, no new authorization
   concept, no moderation queue. This covers essentially every real mis-click, since a
   fresh mistake has no other referents yet. Once another pilot depends on it, the site
   is community property and the affordance disappears (operator script only).
3. **Public is preselected in the create dialog.** *This overrides the private-first
   default and the `Flight.visibility` precedent, and was the user's explicit call* — the
   reasoning being that a site only helps anyone if it is public, so the feature has to
   default toward contribution to earn its keep.
   **Because it is an override, the design compensates rather than just complying:**
   - the dialog carries explicit consequence copy — publishing shares the **name and
     location** with every pilot — shown before the save, not after;
   - the undo from refinement #2 stops being a nice-to-have and becomes **load-bearing**,
     and is therefore in the committed scope rather than deferred;
   - the daily create cap is kept (see above) rather than cut for scope;
   - the DoD requires the consequence copy and the undo path to be covered by tests.
   Flagged here so a future reader knows this was a deliberate product decision with
   compensating controls, not an oversight.
4. **Takeoff *and* landing in v1.** Confirmed as scope. The landing columns and the
   900 m radius already exist in schema and ingest; the incremental cost is the new
   landing line on the flight page and an endpoint dimension in the test matrix. LZs are
   where the curated gazetteer is thinnest, so cutting them would leave "Unknown site"
   on the half that needs it most.

## Consequences worth carrying into execution

- **PR2 is the security PR** and should get the most review attention. Nothing can create
  a private site until it lands.
- **The `test/feed.integration.test.ts:52` fixture must be fixed in PR2**, not later — it
  currently violates the invariant the sprint is establishing.
- **Two pre-existing issues were found during planning and are *not* in this sprint's
  scope** (logged separately): the unrate-limited device endpoints, and the phantom
  `DeviceToken` left active when a claimed pairing expires before the device polls.
