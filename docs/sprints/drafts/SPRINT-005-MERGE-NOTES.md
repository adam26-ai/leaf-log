# SPRINT-005 Merge Notes

Synthesis of [`SPRINT-005-CLAUDE-DRAFT.md`](./SPRINT-005-CLAUDE-DRAFT.md),
[`SPRINT-005-CODEX-DRAFT.md`](./SPRINT-005-CODEX-DRAFT.md), their cross-critiques
([`SPRINT-005-CODEX-CRITIQUE.md`](./SPRINT-005-CODEX-CRITIQUE.md) — Claude critiquing
Codex; [`SPRINT-005-CLAUDE-CRITIQUE.md`](./SPRINT-005-CLAUDE-CRITIQUE.md) — Codex
critiquing Claude), and one round of stakeholder interview, into
[`../SPRINT-005.md`](../SPRINT-005.md).

## Base draft

**Claude's draft is the structural base.** Both critiques agree it is the stronger of
the two: Codex's critique of it calls it "a strong draft" that "clearly understands
SPRINT-005 is an extension... not a replacement," with weaknesses confined to
"second-order invariants the draft introduces but does not fully close." Claude's
critique of the Codex draft found a **blocking structural contradiction** in the
matching design (§2.1/§2.2 below) — not a second-order gap. The merged doc keeps
Claude's schema shape, matching algorithm, read-path firewall, and PR sequencing, and
imports specific fixes and one full architectural idea from Codex's draft and both
critiques.

## The two decisions sent to interview

1. **Zone visibility: independent vs. inherited from parent.** Claude's draft made
   zone visibility its own column with effective visibility as the conjunction with
   the parent (`canSeeSite(site) AND canSeeZone(zone)`) — enabling "public site,
   private spot," the case the sprint's seed prompt used as its own motivating
   example. Codex's draft inherited visibility entirely from the parent — simpler,
   and it closes an entire bug class, but cannot express that case at all.
   **Decision: independent, with the conjunction.** The stakeholder chose to keep the
   capability that motivated the sprint and accept the complexity cost, which the
   merge closes with three concrete fixes (below) rather than by simplifying away.
2. **Cross-owner zone moderation.** Both drafts let a pilot add a zone under another
   pilot's public site (needed so a shared site's map of spots can grow past its
   original namer). Codex's critique of its own draft (§2.6) found the resulting gap:
   neither the zone's creator (once someone else's flight references it) nor the
   site's owner could fix a bad zone — only the operator script could.
   **Decision: the site owner also gets rename/delete power over zones under their
   own site**, in addition to the zone creator's own undo. This is new pilot-over-pilot
   power beyond SPRINT-004's stance (a deliberate, discussed exception, not a drift),
   justified because the site owner already controls the *whole* site's visibility —
   this only makes that existing power finer-grained, not categorically new.

## Valid critiques accepted

From Claude's critique of the Codex draft (blocking or high-value; drove the choice of
base draft):

- **§2.1/§2.2 — the site-fallback exclusion rule was broken and regressed the
  intent's own "no dead ends" success criterion.** Codex's model excluded a site from
  fallback matching the moment *any* endpoint-compatible zone existed under it,
  regardless of that zone's distance — so naming one zone could silently un-label
  every other pilot's nearby flight. **Rejected**; the merge keeps Claude's model,
  where the site-radius pass always runs as a fallback, independent of whether the
  site has zones. Both critiques converge that this is correct.
- **§2.4 — `reassociateOwnFlights` needs to upgrade already-site-bound flights, not
  only unmatched ones**, when a new sibling zone is created — otherwise the pilot's
  own back-catalog at that site stays split between "Mission Ridge" and "Mission
  Ridge — North Launch" forever, which is close to the sprint's headline scenario.
  Claude's draft already implements this correctly; kept as-is, called out explicitly
  in the merged PR3 section since Codex's critique shows how easy it is to miss.

From Codex's critique of the Claude draft (accepted, all fixed in the merge):

- **`Zone.kind` was never set on create**, defaulting to `"unknown"`, which
  `kindMatches` never matches — a newly created zone would silently never auto-match
  future flights. **Fixed**: zone creation sets `kind` from the endpoint; explicit
  opposite-endpoint reuse widens it to `"both"` (mirroring the existing `Site.kind`
  widening rule), never narrows.
- **Deleted-zone cache was ambiguous** — could render a stale "Site — Zone" label for
  a zone that no longer exists. **Fixed** by adopting the critique's own suggested
  resolution: `deleteZone` explicitly nulls the cached zone name (not just the id via
  `SetNull`), so the historical-fallback cache is reserved purely for the
  `siteId IS NULL` case, exactly matching SPRINT-004's precedent — no hybrid state.
- **`@@unique([siteId, normalizedName])` let a hidden private zone block a visible
  public zone name**, and risked leaking the private zone's existence via `P2002`.
  **Fixed**: the DB-level uniqueness is scoped to public zones only (a Postgres
  partial unique index, raw SQL alongside the existing CHECK constraints — Prisma v6
  can't express it in-schema). Private zone creation falls back to the same
  in-transaction re-probe SPRINT-004 already uses for sites; public zone creation
  keeps the hard, cheap `P2002`-based concurrency guarantee.
- **Site deletion could cascade-delete another pilot's zone with no guard noticing** —
  `referencedByOthers` only counts *flights*, not zone ownership, so a contributed
  zone with no flight bound yet (or between ingest events) could vanish silently.
  **Fixed**: `deleteSite`'s guard is extended to also refuse while any zone under the
  site is owned by a different pilot, regardless of flight references. This also
  closes the identical gap Codex's own critique found in its own draft (§2.7),
  confirming it's a real property of the two-level model, not an artifact of either
  draft's specific schema choice.
- **The "public zone under private site" state's behavior was described three
  different ways** across the Overview, PR1, and DoD. **Fixed** with one canonical
  rule, stated once: refused at the UX/validation layer at *create* time only — never
  a DB constraint — because a site's temporary demotion must not touch its zones' own
  `visibility` values (the read-time conjunction already neutralizes them, and
  re-promotion should restore prior zone visibility with no extra bookkeeping; a
  cross-table CHECK here would fight that legitimate lifecycle the same way SPRINT-004
  rejected a "private ⇒ owned" CHECK).
- **`listOwnFlightsByIds` bypasses the read-path resolver.** Verified against the
  shipped code (`lib/flights/repo.ts:287-296`) — true, it returns raw `LIST_SELECT`
  rows. **Fixed**: routed through the resolver like every other list function, closing
  the DoD's "every display read" claim rather than carving out an exception.

Both critiques independently flagged **cross-site match shadowing** (a zone under a
different, farther-off site's centre beating a nearer bare site) as a residual
collision risk. **Not fixed away** — folded into the existing "radius collision
between adjacent zones" accepted risk, with the cross-site case named explicitly and
a dedicated test added, matching SPRINT-004's own precedent of accepting bounded,
tested, operator-remediable collision risk rather than adding matching complexity to
eliminate it entirely.

## Interview refinements applied

Both decisions above (independent zone visibility; site-owner zone moderation) are
folded directly into the Overview's anchoring decisions, the undo/operator-remedy
section, and the Definition of Done — not treated as addenda.

## Rejected

- Codex's draft's simpler inherited-visibility model — superseded by the interview
  decision, not by a technical flaw in the idea itself; it remains the right call *if*
  the "private spot under public site" capability is ever cut for scope reasons in a
  future sprint.
- Codex critique's suggestion of a composite-FK (`@@unique([id, siteId])` +
  `Flight(zoneId, siteId) → Zone(id, siteId)`) to enforce `zone.siteId = flight.siteId`
  at the DB level. Sound reasoning, but Claude's original rejection of it stands: a
  composite FK's `SetNull` would null *both* columns together, detaching a flight's
  site binding the moment its zone is deleted — contradicting the "deleting a zone
  leaves a working bare site" requirement. Kept as application-layer-enforced,
  single-writer, with a hand-written-violating-row test, exactly as originally
  proposed.
