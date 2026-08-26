# Critique of `SPRINT-008-CODEX-DRAFT.md`

> Reviewed against the intent document, the Claude draft, and the codebase
> as of SPRINT-007's merge.

---

## Strengths

**1. Exhaustive surface enumeration.** The Codex draft catalogs every zone
affordance that must be hidden: matching, suggestions, creation, display,
naming dialog, boundary picker, community dialog, endorsements, rename, and
operator commands. The server-action enforcement section
(lines 174–188) is particularly thorough — it lists every specific function
and action path by name, including the boundary read/write variants that are
easy to forget. This is the most complete "hide checklist" of the two drafts.

**2. Clear data-flow diagrams.** The `findLocation` → `createOrAttachSiteFromFlight`
→ `resolveLocationFields` → `SiteNameControl` text flow diagram (lines 85–105)
gives an implementer an at-a-glance understanding of how data moves. The Claude
draft omits a comparable summary.

**3. Files summary table.** The table (lines 311–340) with per-file action and
purpose is immediately actionable. It covers files the Claude draft only
mentions in passing — like `location-community-dialog.tsx` (verify), and
`boundary-editor.tsx` (verify, no change expected). These "verify" rows
are valuable — they name files that could be forgotten.

**4. Phased implementation.** Four phases with effort percentages give a team a
rough roadmap. The Claude draft proposes a single PR with no internal ordering,
which is fine for a solo implementer but would leave a pair or team without
sequencing guidance.

**5. Explicit dependency and precedent citations.** The Dependencies section
(lines 436–451) cites `SITE_BOUNDARY_MATCHING=off` directly, names existing
test data constraints, and calls out that no new npm, service, or Prisma
changes are needed. Useful for someone picking up the sprint cold.

**6. Risk: "hidden zones still influence site suggestions."** Risk row 4
(line 399) calls out a subtle case: a hidden zone's proximity pulling its parent
site into suggestions even when the site itself is out of range. The Claude
draft addresses this in the architecture section but doesn't flag it as a named
risk.

---

## Weaknesses

**1. Open questions left unresolved.** The Codex draft lists six open questions
(lines 455–476) — every one of which the intent document provides enough
information to answer. These are not unknowns; they're product decisions the
draft should commit to. Examples:

- Q1 ("env-controlled or hard constant?") — the intent explicitly names the
  `SITE_BOUNDARY_MATCHING=off` precedent as a "strong candidate pattern to reuse
  or mirror." The answer is env-controlled. The Claude draft commits to this.
- Q2 ("should site owners see old zone names on their own flights?") — the
  intent says "a pilot should no longer be able to ... see ... a zone anywhere
  in the app." The answer is no. The Claude draft commits to this.
- Q5 ("should existing zone e2e tests still run in CI?") — the intent says
  "existing test coverage should not be deleted." The answer is yes, adapted.
  The Claude draft commits to this.

Leaving these open means the implementer has to make product decisions at coding
time, which is exactly what the sprint doc exists to prevent.

**2. Env var naming and semantics are inconsistent with precedent.** The draft
proposes `SITE_ZONES === "on"`. The existing precedent is:

```ts
// lib/sites/lookup.ts, line 23-24
function boundaryMatchingEnabled(): boolean {
  return process.env.SITE_BOUNDARY_MATCHING !== "off";
}
```

That pattern checks `!== "off"` (default on). For a gate that defaults off,
the inversion is `=== "on"` (Codex) or `=== "true"` (Claude). Both work, but
`SITE_ZONES` as a var name is ambiguous — it reads as "the zone configuration"
rather than "whether zones are on." `ZONES_ENABLED` or `SITE_ZONES_ENABLED`
would be clearer. This is minor, but the sprint should commit to one name
rather than deferring it.

**3. File placement: `lib/sites/features.ts` is premature generalization.** The
draft places the gate in a new `features.ts` file. This implies a generic
feature-flag module — but we have exactly one gate, and the existing precedent
(`boundaryMatchingEnabled`) lives inline in `lookup.ts`. A dedicated file
is fine, but the name should be specific (`zones-enabled.ts`, as in the Claude
draft) rather than generic. A `features.ts` file invites future flags to
accumulate there rather than staying close to the code they control.

**4. Phased effort breakdown is optimistic on Phase 4.** Phase 4 ("Preservation,
docs, and release pass") is estimated at 20% but includes: keeping operator
commands working, updating architecture docs, adding a `/whats-new` entry,
ensuring legacy zone tests run in a gate-on context, and running all five
validation gates. That last item alone — getting `pnpm build`, `pnpm test`,
`pnpm typecheck`, `pnpm lint`, and `pnpm e2e` to pass — is not a doc task; it's
the integration verification for the entire sprint. If anything breaks during
that run, the fix effort lands in Phase 4's 20% bucket. A more honest estimate
would put the full-pass verification as a cross-cutting activity rather than a
phase.

**5. The `zonesEnabled` prop threading is underspecified.** The draft says
(line 79): "Server components that render `SiteNameControl` pass a `zonesEnabled`
boolean prop derived from the server gate." But it doesn't trace the prop chain:
which server component reads the gate? How does it reach `NameSiteDialog`?
`flight-header.tsx` is listed (line 238) but `FlightHeader` may itself be a
client component imported by a server page — the draft doesn't verify the
server/client boundary for this prop. The Claude draft's approach (the read path
strips zone data, so `SiteNameControl` naturally receives null zone props
without needing a separate `zonesEnabled` prop) is simpler — fewer
prop-threading points means fewer places to get it wrong.

---

## Gaps in Risk Analysis

**1. No risk entry for the zone-step removal breaking the site-only submit
path.** The intent document explicitly calls this out: "does removing the zone
step break the site-only flow SPRINT-004 originally shipped?" The Codex draft
describes the desired UI behavior but doesn't flag the state-machine change as
a risk. In `name-site-dialog.tsx`, the step transitions (`"site"` → `"zone"` →
submit) are tightly coupled; short-circuiting `"zone"` could break submit timing
or leave stale state. The Claude draft at least names this as a risk area
(line 402–407: "`findLocation`'s zone-disabled path silently regresses
site-only matching").

**2. No risk for zone-aware code paths imported outside server actions.** The
draft recommends "action-level gates first, with lower-level guards only for
functions imported outside those actions" (Open Question 3) but doesn't analyze
*which* lower-level zone functions are imported outside actions. If
`lib/sites/community.ts` zone functions are called from a future page or
component that bypasses the action layer, the gate is missed. The files summary
marks `community.ts` and `endorsements.ts` as "Verify/Modify," which is the
right instinct, but there's no risk row for "zone helper imported from a path
that doesn't hit the action gate."

**3. No risk for `suggestNearbyLocations`'s distance-ranking change.** When
zones are hidden, a site whose nearest zone was closer than the site centroid
will now rank differently (using the site's own distance only). This could
change which sites appear as suggestions for flights near the boundary of
multiple sites' ranges. It's a benign change, but the draft doesn't acknowledge
it. A test that asserts suggestion order stability would catch future surprises.

**4. Missing risk: `ingest-flight.ts` and the device-push API.** The ingest
seam calls `findLocation` — the draft doesn't explicitly verify that the seam
absorbs the gate change passively. The Claude draft names it in the "Unchanged
on purpose" list (line 308–309). The Codex draft's files summary omits
`lib/ingest/ingest-flight.ts` entirely.

---

## Missing Edge Cases

**1. A flight where takeoff matched a zone but landing matched a different zone
(or no zone).** This is a real state in the database. The draft talks about
"a flight already bound to a zone" in the singular, but a flight has *four*
zone columns (takeoff and landing, each with id and name). The display
suppression must handle each endpoint independently. The Claude draft's
`resolveEndpoint` placement (line 158–162) handles this naturally, but neither
draft calls it out as an explicit edge case to test.

**2. A flight where the zone is visible but the parent site is private.** Under
SPRINT-005/007 rules, this is a legal state (visibility is a conjunction, not
inheritance). When zones are hidden, the flight shows the site name — but the
site might be private to viewers other than the owner. Does the existing
`canSeeSite` check still apply correctly after zone suppression? Almost
certainly yes (the read path checks site visibility separately), but the edge
case is worth a test row.

**3. A flight with a zone name but a null site name (orphaned zone binding).**
Could exist from a bug or operator intervention. When zones are hidden, what
does the display show — an empty location? The draft doesn't cover this
degenerate case. `formatLocationLabel` with both `siteName` and `zoneName` null
would return an empty or fallback string.

**4. E2E test for the "already zone-bound flight" display.** The DoD mentions
logbook/feed/profile rendering site-only (line 369–370), but the E2E section
only covers naming and auto-match (line 383–386). There's no DoD item for an
E2E test that loads a zone-bound flight and confirms the heading reads site-only.
The integration tests cover the data layer, but the E2E gap means a rendering
bug (e.g., a component that reads `zoneName` from a different source) could
survive.

**5. The `getBoundaryForPublicRow("zone", ...)` path.** Line 182 lists it as
needing rejection, which is correct. But the public boundary read is used on
the *map* component of the flight page. If the map component fetches the zone
boundary independently (not through `resolveLocationFields`), it could show a
zone polygon even when the zone is hidden from everything else. The draft
doesn't trace this path.

---

## Definition of Done Completeness

The DoD is detailed (20 items) and covers the critical invariants well. Gaps:

1. **No DoD item for the ingest seam.** The intent says ingestion (web upload
   and future device push) must match site-only. The DoD covers `findLocation`
   in the abstract but doesn't verify the seam absorbs it — a test that calls
   `ingestFlight` with a coordinate inside a zone's radius and confirms
   site-only matching would close this.

2. **No DoD item for zone-bound flight *display* at the E2E level.** Item 10
   (line 369) says "Logbook, feed, profile, and flight-page labels render
   'Site' rather than 'Site - Zone'" — but no corresponding E2E DoD item
   verifies this in a browser. The E2E items (lines 383–386) cover naming and
   auto-match only.

3. **No DoD item for the `zones-enabled` gate's unit test.** The Codex draft
   mentions "Add a unit test for default-off" in the risk table (line 401) but
   doesn't promote it to a DoD checkbox. The Claude draft makes it the first
   DoD item (line 334–336).

4. **"No client-rendered copy uses 'spot' or 'zone'" (line 377) is unverifiable
   as stated.** This is an aspiration, not a testable criterion. A `grep` for
   "spot" in component files would produce false positives (e.g., "spotlight,"
   CSS classes). A better formulation: "no user-visible label or dialog copy
   references 'spot' or 'zone' in the default product flow" — verified by a
   manual QA sweep or a targeted string search against rendered text.

5. **No DoD item for `docs/architecture.md` accuracy.** The Codex draft includes
   updating architecture docs (line 305), which is good, but it's not in the
   DoD checklist — it's only in Phase 4's task list.

---

## Key Divergences from the Claude Draft

| Topic | Codex Draft | Claude Draft | Assessment |
|-------|-------------|--------------|------------|
| **Env var name** | `SITE_ZONES` (check `=== "on"`) | `ZONES_ENABLED` (check `=== "true"`) | `ZONES_ENABLED` is clearer; `SITE_ZONES` is ambiguous. Minor. |
| **Gate file location** | `lib/sites/features.ts` (generic) | `lib/sites/zones-enabled.ts` (specific) | Claude's is better — avoids premature generalization. |
| **Open questions** | 6 left open | All answered as committed decisions | Claude's approach is correct — the intent provides enough to decide. |
| **Phasing** | 4 phases with % estimates | 1 PR, no phasing | Codex's phasing is useful for planning but the % estimates are questionable. |
| **Prop threading** | `zonesEnabled` prop from server to client | Read path strips zone data; no extra prop needed | Claude's is simpler and has fewer failure modes, but may still need a prop for the naming dialog's step-machine behavior. |
| **Zone-bound flight display** | Both agree: show site-only | Both agree: show site-only | No divergence. |
| **Gate default** | Both default off | Both default off | No divergence. |
| **Ingest seam** | Not mentioned | Named as "unchanged on purpose" | Claude's is more thorough on passive absorption. |
| **`formatLocationLabel`** | "Can stay unchanged" | "Unchanged — already handles null zone" | Agreement, but Claude's phrasing is more precise about *why*. |
| **Test strategy** | Split into "default-off" and "gate-on legacy" families | Existing tests stay unchanged (they bypass the gate); new tests verify disabled state | Claude's is more practical — existing unit tests call functions directly and don't go through the gate, so they don't need modification. |

---

## Summary Verdict

The Codex draft is a competent, well-structured plan with the best surface
enumeration of the two drafts. Its files-summary table and phased breakdown
would serve a team well. But it has two structural weaknesses: it leaves
product decisions as open questions when the intent provides the answers, and
it underspecifies the prop-threading mechanism while overcomplicating the gate's
file placement. Its risk analysis misses the naming-dialog state-machine risk,
the ingest-seam passthrough, and several edge cases around multi-endpoint
zone bindings.

The Claude draft is tighter: it commits to every decision, traces the
implementation to specific code patterns, names what's *deliberately unchanged*
(which is as important as what changes), and avoids premature abstractions. Its
weakness is the lack of phasing guidance and the absence of a files-summary
table.

A merged final draft should take the Codex draft's surface enumeration and
files table, the Claude draft's committed decisions and simpler architecture,
and add the missing edge cases and risk items identified above.
