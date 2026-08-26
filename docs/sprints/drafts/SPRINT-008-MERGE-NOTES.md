# SPRINT-008 Merge Notes

Gemini could not participate — its CLI's free-tier auth is still not
supported (`IneligibleTierError`), the same gap as every prior sprint this
project. Proceeded with Claude (opus, max effort) and Codex (gpt-5.5,
extra-high effort) per the weather report's Sprint Planning consensus pair.

## Where the two drafts agreed (no real divergence)

Both drafts independently reached the same answer on every genuinely
product-facing question:

- **Hide, not delete.** No schema change, no data migration, no column
  nulling. The `Zone` table, `Flight`'s four zone columns, zone audit
  entries, zone endorsements, and zone boundaries all stay exactly as they
  are.
- **The gate defaults OFF.** Absent env var = zones hidden. This is what
  makes the sprint actually ship the user's ask on merge/deploy, with no
  separate "now turn it off" step.
- **An already zone-bound flight collapses to site-only display**, for
  every viewer including the owner — implemented in the read path
  (`resolveLocationFields`), not by touching the stored columns, so
  re-enabling is instant and lossless.
- **Server-side rejection is mandatory, not just UI removal.** Every
  zone-parallel server action fails closed when the gate is off, regardless
  of what a stale client sends.
- **Operator commands (`scripts/admin-sites.ts` zone-*) stay fully
  functional**, ungated — they're maintenance tools for preserved data, not
  part of the pilot-facing product surface this sprint is simplifying.
- **Existing zone-specific test coverage is preserved, not deleted** — it's
  the concrete proof that reversibility is real, not just claimed.

Given this level of independent agreement, and given both cross-critiques
converged on the same corrections (below), no further interview round was
needed — the remaining decisions are implementation details, not genuine
product forks.

## The one real technical gap both critiques caught independently

Both Claude's critique of Codex and Codex's critique of Claude flagged the
**exact same bug** in Claude's own draft: `components/flight/
name-site-dialog.tsx` is a `"use client"` component. Its `NameSiteDialog`
initializes `step` to `"zone"` whenever `currentSiteName` is already set,
and `chooseSiteReuse`/`chooseSiteCreate` call `setStep("zone")` after a
fresh site choice — a step-machine transition that happens *before* any
per-row zone data is even relevant. Claude's draft assumed this would "fall
out" of `resolveLocationFields` returning `zoneId: null`, but a client
component cannot read the server-only `zonesEnabled()` (a raw
`process.env` read) directly, and the zone-step decision isn't data-driven
in the first place — it's a feature-availability decision.

**Resolution, adopted from Codex's draft:** a server component
(`components/flight/flight-header.tsx`, which is already a server
component — it renders `SiteNameControl`, a client component, with plain
props and no hooks of its own) calls `zonesEnabled()` once, server-side,
and passes the boolean down as an ordinary serializable prop:
`FlightHeader` → `SiteNameControl` → `NameSiteDialog`. This is the standard
App Router pattern (server computes, client receives via props) and adds
exactly one prop threading path, not a new client-side env mechanism.

## Other corrections adopted from cross-critique

- **Gate name: `ZONES_ENABLED`, not `SITE_ZONES`.** Claude's critique of
  Codex made the sharper case — `SITE_ZONES` reads as "the zone
  configuration," not "whether zones are on." Claude's own critique
  conceded this too. `ZONES_ENABLED=true` re-enables; anything else
  (absent, `"false"`, `"0"`, empty) means hidden.
- **Gate file: `lib/sites/zones-enabled.ts`, not `lib/sites/features.ts`.**
  Codex's critique of its own generic filename choice (surfaced by Claude's
  critique) is right — there is exactly one gate; a generic `features.ts`
  invites future flags to accumulate somewhere disconnected from the code
  they control, and the specific name mirrors the existing
  `boundaryMatchingEnabled()` convention.
- **`suggestNearbyLocations` must not let a hidden zone's proximity pull a
  site into suggestions it wouldn't otherwise qualify for** (Codex's
  callout, Claude's critique agreed it was a real gap Claude's own draft
  under-specified). Explicit test required, not just prose.
- **Import-graph audit as an explicit task, not an assumption.** Both
  critiques (Codex's own self-critique of its "verify" rows, and Claude's
  critique of Codex) independently worried that low-level zone helpers
  (`lib/sites/associate.ts`, `community.ts`, `endorsements.ts`) might be
  reachable from some path that doesn't go through the gated server
  actions. Resolved by requiring an explicit grep/import sweep as a DoD
  item, keeping the low-level functions themselves gate-agnostic (so
  gate-on tests can still call them directly) rather than pushing the gate
  down into every layer.
- **Test strategy clarified, not left inconsistent.** Claude's draft said
  existing zone tests "pass unchanged" in one place and "set
  `ZONES_ENABLED=true`" in another — Codex's critique correctly called this
  contradictory. Resolved: any test whose *expected outcome* depends on
  zone behavior (matching a zone, creating a zone, zone-aware display) sets
  `ZONES_ENABLED=true` in its own setup and is now explicitly a "gate-on
  legacy" test; tests of pure, gate-agnostic helpers (`canSeeZone`,
  `zoneRadiusForKind`, boundary validation) are genuinely unchanged.
- **E2E scope resolved pragmatically.** Gate-on E2E would require a second
  CI job running the dev server with a different env — real infrastructure
  cost neither draft's DoD actually justified paying for. Resolved:
  `test/e2e/zones.spec.ts` is **repurposed**, not skipped or deleted, to
  assert the new default-off product behavior (no "Which spot?" step ever
  appears, a flight cannot land on a zone). The *old* UI-reachable
  zone-creation flow it used to test is superseded by the unit/integration
  gate-on suite, which is the layer that actually proves the underlying
  machinery — e2e's job is proving UI reachability, and there is
  intentionally no UI left to reach. Zone-specific scenarios inside
  `test/e2e/boundaries.spec.ts` and `test/e2e/community.spec.ts` get the
  same treatment: convert to asserting absence, don't duplicate gate-on
  coverage that already exists at the integration level.
- **Copy-level acceptance criterion adopted.** Codex's DoD item ("no
  client-rendered copy uses 'spot' or 'zone' in the default pilot flow") is
  sharper than Claude's implicit "the components aren't rendered" — kept,
  refined per Claude's critique's own correction (a raw grep would false-
  positive on things like "spotlight"; scope it to actual rendered dialog/
  button copy, verified by manual QA + reading the diff, not an automated
  grep gate).
- **Multi-endpoint edge case named explicitly.** A flight has *four* zone
  columns (takeoff id/name, landing id/name), independently. Both critiques
  flagged that neither draft's Use Cases explicitly tested a flight with
  different zone states on each endpoint. Added as an explicit test case.
- **Orphaned-state edge cases named.** A zone-bound flight whose parent site
  is private to the current viewer, or (a degenerate, operator-intervention
  state) a zone id with no resolvable parent site — both need an explicit
  test proving the existing `canSeeSite`/fail-closed behavior still applies
  after zone suppression, not a new assumption.

## Rejected ideas, with reasoning

- **Passing `zonesEnabled` deep into `lib/sites/associate.ts`'s low-level
  zone mutators.** Considered (Codex's Open Question 3), rejected in favor
  of action-layer gating only, WITH the explicit import-graph audit above
  as the safety net. Pushing the gate into low-level functions would make
  them harder to call directly from gate-on legacy tests — exactly the
  tests this sprint depends on for its reversibility proof.
- **A hard compile-time constant instead of an env var.** Neither draft
  seriously proposed this, and the existing `SITE_BOUNDARY_MATCHING`
  precedent settles it — env-read, fresh per call, flippable without a
  code change.
- **Four separate PRs (Codex's phasing) as a hard requirement.** Kept as
  logical phases within the implementation section (useful for review
  structure and for `sprint-execute`'s own phase-by-phase validation
  discipline) but not mandated as four separately-merged PRs — the actual
  changes are small, mechanical, and low-risk per-file; splitting adds
  merge ceremony without a corresponding safety gain, which was Claude's
  original point and Codex's critique didn't actually rebut it, only
  flagged that phasing helps *review*, which phased sections within one
  PR's implementation already provide.
