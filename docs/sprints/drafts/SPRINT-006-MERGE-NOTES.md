# SPRINT-006 Merge Notes

Inputs: [`SPRINT-006-CLAUDE-DRAFT.md`](./SPRINT-006-CLAUDE-DRAFT.md),
[`SPRINT-006-CODEX-DRAFT.md`](./SPRINT-006-CODEX-DRAFT.md),
[`SPRINT-006-CLAUDE-CRITIQUE.md`](./SPRINT-006-CLAUDE-CRITIQUE.md) (Claude critiquing
Codex), [`SPRINT-006-CODEX-CRITIQUE.md`](./SPRINT-006-CODEX-CRITIQUE.md) (Codex critiquing
Claude), and a 4-question stakeholder interview. Gemini did not participate — the CLI's
free-tier auth is no longer supported in this environment (`IneligibleTierError`), the
same gap noted in the SPRINT-005 session.

## Draft strengths

**Claude draft**: the storage design (versioned `{v, kind, geometry}` envelope, single
`boundary Json?` + 4 derived bbox `Float?` columns), the `kind` discriminant that folds
the adjacent per-site-radius FEATURES.md idea into the same column as a future variant,
the explicit "boundary replaces circle, never unions with it" semantics with a stated
reason (a union can only ever widen, never fix an over-broad circle), the
`reassociateOwnFlights`/`suggestNearbyLocations` boundary-awareness (Codex's draft left
both circle-only), the four-PR safety ordering (nothing can create a boundary until
PR3), and an unusually rigorous edge-case/DoD list. Its own critique of Codex's draft
(below) is also the sharpest single artifact this process produced.

**Codex draft**: correctly identified that `withinRadius` needs restructuring for
polygon rows to get a `distanceM`, scoped Phase effort percentages realistically, and —
most importantly — its critique of Claude's draft caught a real, structural
self-contradiction that Claude's own critique missed: Claude's "never accept a site/zone
id from the client, always re-derive from the flight row" policy makes the sprint's own
headline use case (expanding a ridge site whose endpoints fall outside its old circle)
unreachable, because the dialog can only open once a row is already bound. That gap
existed in *both* drafts' UI designs — Codex's editor is likewise only reached from an
already-bound flight — but only Codex's critique named it.

## Critiques: accepted vs. rejected

**Accepted from Claude's critique of Codex's draft** (see that file for full reasoning):
zone-first short-circuit hazard from oversized zone polygons (W1) — resolved by
interview, see below; the ranking/`distanceM` mechanical gap for polygon rows (W2) —
fixed, no tier added, see below; antimeridian handling as specified in Codex's draft is
internally contradictory (W3) — resolved by adopting Claude's draft's flat refusal;
`suggestNearbyLocations` and the in-transaction dedup probe must be boundary-aware (W5)
— adopted from Claude's draft, which already had this; `reassociateOwnFlights` should be
boundary-aware on both ends (W6) — adopted from Claude's draft, which already had this;
no rollback kill switch for a matching-engine change on the ingest hot path (W9) —
adopted, an env-gated `SITE_BOUNDARY_MATCHING=off` escape hatch is now in scope; `merge`/
`zone-merge` silently destroying boundaries (W8) — adopted, both commands now refuse
(or, with `--force`, carry the boundary across) rather than dropping it silently; no
undo/attribution on a boundary edit (W7) — partially adopted: a `boundaryUpdatedById`
column plus a confirm step on Clear, not a full undo history (out of scope: the
interview didn't raise this and a full undo stack is disproportionate to the fix); pilots
"draw blind" with no visible circle/neighbors (W13) — adopted as a mitigation for the
"allow large, accept the risk" interview answer on zone size; no rate limit on boundary
writes (W14) — adopted, a modest daily cap mirrors `DAILY_CREATE_CAP`'s existing pattern;
missing release-process files — ledger row, `FEATURES.md` move — adopted into the DoD.

**Rejected from Claude's critique**: the recommendation to cap zone boundary area near
the existing zone-circle scale (part of W1's fix options) — the interview explicitly
chose "allow large, accept the risk" over this, so v1 uses a generous, level-scoped area
cap (not a tight one) and leans on the existing operator remedy plus the new
draw-time visual context (W13) as the mitigation instead. The recommendation to add a
polygon-beats-circle ranking tier (W2's suggested fix) — also declined by the interview
(the "allow large, accept the risk" answer explicitly paired with "no ranking change");
the mechanical `distanceM` gap is still fixed, but ranking stays anchor-distance-only,
which is also what Claude's own original draft argued for on separate grounds (a ranking
tier would let a 3 km ridge beat a genuinely nearer unrelated site).

**Accepted from Codex's critique of Claude's draft**: the off-radius edit-surface
blocker (2.2/2.3) — resolved by interview, see below; malformed stored boundary at
match time has no defined behavior (2.5) — resolved: fail closed per-row (skip the
candidate, structured log, never throw into ingest and never silently fall back to
circle, since a silent circle fallback would undo a pilot's deliberate tightening); the
partial-index claim needs to be honest about what it buys (2.4) — adopted Claude's own
already-more-honest framing (a scan-restricting set reducer, not a spatial index) plus a
DoD row requiring the query shape to actually filter on the indexed bbox columns; the
`kind: "both"` ambiguity (2.1) — resolved by interview, see below.

**Rejected from Codex's critique**: nothing outright rejected — every substantive point
either matched something Claude's own critique had already found (dedup/suggestions,
though from a different angle) or was accepted above. The one point not carried forward
literally is "add a dedicated owner-only management surface" as one option for 2.2 — the
interview picked the in-dialog picker instead, which avoids a new page/URL surface
entirely.

## Interview decisions (binding)

1. **Off-radius editing → owner-scoped picker, inside the existing dialog.** The naming
   dialog gains an "Edit a boundary" entry point reachable regardless of whether the
   current flight's endpoint is bound. It opens a small owner-scoped picker: the pilot's
   own sites, own zones, and zones under sites they own (the same set `findZoneEditableBy`
   already recognizes). Selecting a row opens the boundary editor for it. This does admit
   a site/zone id from the client for the first time in this feature area — but every
   read and write re-verifies ownership server-side before the id is trusted for
   anything, the same posture `findZoneEditableBy` already has, and the id never appears
   in a URL (it travels through component state and a server action's form data, inside
   the same dialog). This closes both Codex critique 2.2 (headline use case unreachable)
   and 2.3 (parent-site-owner zone remedy unreachable in practice).
2. **Zone boundary size: allow large, accept the risk.** No zone-specific cap tied to the
   old 300 m/400 m circle scale. Zone and site caps are both generous (see Architecture),
   with the zone cap somewhat smaller than the site cap to keep *some* asymmetry, not
   because it's constrained to circle scale. The accepted hazard (an oversized public
   zone polygon short-circuiting ahead of nearby sites for every pilot) is documented in
   Risks with its real mitigations: the area/vertex caps still exist (just not tight
   ones), the editor shows the current circle and nearby visible boundaries while
   drawing (W13), and `boundary-clear` remains a one-command operator fix.
3. **`kind: "both"` rows: one shared boundary.** A boundary on a `both` row applies to
   both takeoff and landing matching. No endpoint-specific boundary pair. Simpler model,
   and it's the pilot's own shape — if they draw a "both" boundary they're tracing the
   whole usable area they know, launch and LZ alike.
4. **Scope: one sprint, four PRs.** No split into a schema-only SPRINT-006 plus a
   UI-only SPRINT-007. The drawing UI ships in PR4 as originally scoped by both drafts,
   with W11's testability fix (extract the editor's state machine into a pure,
   jsdom-testable module separate from the MapLibre rendering shell) and e2e tile-mocking
   folded in as execution details, not a scope cut.

## What the final document does that neither draft did alone

- Resolves the off-radius edit-surface contradiction both drafts shared (only Codex's
  critique named it) with a concrete, ownership-gated picker design.
- Fixes the `distanceM`-for-polygon-rows mechanical gap Codex's critique found, without
  adopting the ranking-tier fix Claude's critique proposed — because the interview
  explicitly declined a ranking change.
- States a real behavior for corrupt/malformed stored boundaries at match time (neither
  draft did).
- Adds the rollback kill switch, the `merge`/`zone-merge` boundary-preservation guard,
  and the boundary-write rate limit — three gaps both critiques flagged that neither
  draft's DoD covered.
- Keeps Claude's storage design, envelope versioning, and `kind`-discriminant radius-
  override precedent essentially verbatim — both critiques agreed these were the right
  calls, and the interview raised no objection to them.
