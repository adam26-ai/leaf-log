# Leaf Log — Architecture (Milestone 1)

Deployed on **Railway**: Next.js app + a Railway **Postgres** plugin, accessed via
**Prisma**. Auth is **NextAuth v5** (email magic-link via Resend). There is no
Supabase and no DB RLS — privacy is enforced at the application layer.

## The ingestion seam

There is exactly one ingestion path: `ingestFlight({ source, ownerId, bytes })`
in `lib/ingest/ingest-flight.ts`. The M1 web upload (`POST /api/upload`) is its
first caller; the future Leaf **device-push** API (`POST /api/ingest`) will be its
second, calling the same core with `source='device_push'`. Parsing, derivation,
artifact building, site lookup, and persistence never know how the bytes arrived.

```
client drag-drop ─┐
                  ├─► POST /api/upload ─┐
(future) device ──┘   (authn, guards)   ├─► ingestFlight()
                       POST /api/ingest ┘        │
   1. sha256 + dedupe (ownerId, hash)            │
   2. parseIgc(bytes)        (tolerant; never throws)
   3. deriveMetrics()        (smoothed climb/sink, gain threshold, baro→gps, tz)
   4. findSite(takeoff/landing)  ── bbox + haversine ──► Site
   5. buildTrackArtifact()
   6. ONE transaction: Flight (scalars + site refs) + FlightData (rawIgc bytea,
      track jsonb). Atomic — a failure rolls back; no orphans.
```

Files live **in Postgres**: raw IGC as `bytea`, the derived track artifact as
`jsonb`, both on `FlightData` (kept off the `Flight` row so logbook/profile lists
stay fast).

## Privacy model (application layer)

This app has **no RLS** — the **viewer-scoped repo** (`lib/flights/repo.ts`) IS the
enforcement, and every flight read goes through it:

- `getFlightForViewer(id, viewerId)` returns a flight only if it is public OR owned
  by the viewer. Used by the flight page and the track route.
- `listPublicFlights(ownerId)` powers public profiles (public + ready only).
- `listOwnFlights(ownerId)` powers the owner's logbook.
- Public profile aggregate stats are computed from **public flights only**.
- The track route (`GET /api/flights/[id]/track`) calls `getFlightForViewer` before
  returning the artifact. Raw IGC is never served.

Proven by `test/privacy.integration.test.ts` (anon / non-owner / owner) and the
Playwright happy-path.

## Site + zone privacy seam (SPRINT-004, extended two levels deep by SPRINT-005, boundaries added by SPRINT-006)

Sites are the app's first shared, user-generated content: a public site is
authored by one pilot and lands in **every** pilot's logbook. That mandates a
second, narrower privacy seam alongside the flight one above — the same "no
RLS, enforcement lives in one repo layer" shape, applied to `Site` and, since
SPRINT-005, to `Zone` (a specific launch/landing spot *within* a site, e.g.
"Mission Ridge — North Launch") one level down.

> **As of SPRINT-008, zones are hidden from the product surface** (see
> [Zones hidden from the product surface](#zones-hidden-from-the-product-surface-sprint-008)
> below) — everything in this section describes the `Zone` model,
> matching, and privacy rules exactly as they still exist and still run;
> only pilot-facing *reachability* changed.

- `Flight.{takeoff,landing}{Site,Zone}{Id,Name}` (eight columns) are a
  **cache**, not the source of truth. `Site`/`Zone` (`ownerId`, `visibility`)
  are authoritative whenever their id is non-null. The cached **site** name
  is the historical fallback when the site id is null (e.g. a deleted site);
  the cached **zone** name has no such fallback — `deleteZone` explicitly
  nulls it, because a deleted spot has nothing to remember, unlike a deleted
  place.
- `resolveLocationFields()` in `lib/flights/repo.ts` re-verifies **every**
  non-null site id AND zone id on a page against the live rows for the
  current viewer — not just rows whose cached name happens to be null —
  before either reaches any caller. **Stripping the parent always strips the
  child**, applied as a single early return rather than a condition repeated
  per surface: a readable zone with an unreadable parent is impossible by
  construction. This is what lets a public flight bound to a private site
  (or a private zone under a public site) render "Unknown site" / the
  bare site name to everyone but the row's owner.
- **Zone visibility is independent of its parent's; effective visibility is
  the conjunction**: `canSeeSite(site, viewer) AND canSeeSite(zone, viewer)`
  (`lib/sites/visibility.ts`'s `canSeeZone`). This is deliberate, not an
  oversight — it's what lets a private spot exist under an otherwise-public
  site ("everyone knows Mission Ridge; my own launch spot is mine"). The
  inverse (a public zone under a private site) is incoherent, since the
  roll-up label renders the parent's name — refused at the point a pilot
  tries to create it, and independently neutralized by the read-time
  conjunction if such a row is ever reached anyway.
- `lib/sites/associate.ts`'s `locationCachePatch` is the **only** thing
  allowed to write those eight columns (an automated audit,
  `lib/sites/write-audit.test.ts`, fails the build if any other file both
  writes `Flight` and assigns a `*SiteName`/`*ZoneName` value — including
  via raw SQL, which the site-visibility-transition writer uses to
  recompute every zone cache under a promoted/demoted site in one
  correlated statement). Ingest re-reads a matched site *and* zone **inside**
  its create transaction and re-verifies both are still visible to the
  owner; a zone that's since been demoted or deleted degrades the cache to
  site-only, never to nothing.
- Site AND zone read scoping (`siteVisibleWhere`/`zoneVisibleWhere`,
  `lib/sites/repo.ts` and `lib/sites/visibility.ts`) is fail-closed: unknown
  visibility ⇒ private; no viewer ⇒ public only; an orphaned private row (a
  null owner) is visible to **nobody**, owner-shaped viewer included.
- Write-time and read-time scoping are deliberately separate. Ingest and the
  "name this site" flow bind within `public ∪ the owner's own private`
  rows, at both levels; display always re-scopes to whoever is actually
  looking.
- Matching is zone-first at a tighter radius (300 m takeoff / 400 m landing,
  vs. the site radius's 600 m / 900 m) with the site pass **always** running
  as a fallback — whether or not the winning site has zones. A bare site (no
  zones at all) matches and displays exactly as SPRINT-004 produces, with
  zero behavioural change; naming a zone only ever adds precision, never
  removes a match a pilot already had.
- A site's own owner may also rename/unpublish/delete a zone a *different*
  pilot contributed under their site (`lib/sites/associate.ts`'s
  `findZoneEditableBy`) — a deliberately scoped exception to the
  no-pilot-moderation stance SPRINT-004 held, justified because it grants no
  capability the site owner didn't already have in aggregate (they can
  already demote/delete the whole site, taking every zone with it); this
  just makes that existing power targetable at one zone. `deleteSite`/
  `unpublishOwnSite` are additionally guarded against orphaning a zone
  another pilot owns, independent of whether a flight currently references
  it — protecting the *contribution*, not just live references.

Proven by `test/sites.integration.test.ts`: an owner/friend/stranger/anonymous
× (site visibility × zone visibility, all four combinations including the
incoherent one) × flight-visibility matrix (asserted on the flight gate,
logbook, profile list, feed, and every other list function), an extended
leak sweep, stale-row defence tests at both levels (including a
mismatched-parent zone id), and transition tests proving a site
demote/re-promote cycle never has to touch a zone's own `visibility` column.

A genuine Postgres limitation surfaced building this: deleting a site whose
flight is bound to both the site directly and a zone under it hits two FK
cascade paths (`Flight.takeoffSiteId` SET NULL, and `Zone`'s CASCADE
indirectly triggering `Flight.takeoffZoneId` SET NULL) converging on the
same row — empirically an FK violation rather than a resolved order.
`deleteSite` works around it by explicitly nulling the zone id/name for
affected flights *before* the site delete, so the native zone cascade has
nothing left to touch.

### Custom boundaries (SPRINT-006)

`Site` and `Zone` each carry an optional `boundary` (`jsonb`, a versioned
GeoJSON `Polygon` envelope) plus four derived bbox `Float` columns and a
`boundaryUpdatedById` attribution column. **A boundary is geometry, never
identity** — it changes which row a flight endpoint matches, and nothing
else. No new `Flight` column, no new visibility dimension, no change to
`canSeeSite`/`canSeeZone`/`resolveLocationFields`/`locationCachePatch`; the
privacy seam described above is entirely unmodified, which SPRINT-006's test
suite proves by re-running the SPRINT-004/005 matrix against
boundary-bearing rows and asserting identical results.

- A boundary **replaces** the circle for the row that has one (never a
  union) — `lib/sites/geo.ts`'s `locationMatches` is the single composition
  point for "boundary if present, else circle," used by `findLocation`,
  `suggestNearbyLocations`, and `reassociateOwnFlights` alike, so the rule
  can't drift between call sites. Every matched row — circle or boundary —
  gets a real `distanceM` (haversine to its own anchor), so ranking never
  needed a "boundary beats circle" tier; a 3 km ridge boundary intentionally
  does not out-rank a genuinely nearer, unrelated site.
- The DB prefilter is a union: the existing circle-bbox predicate `OR`ed
  with a boundary-bbox predicate testing the row's own bbox columns against
  the query point (`lib/sites/geo.ts`'s `boundaryPrefilterWhere`) — still
  exactly two round trips per endpoint, unchanged from SPRINT-005. NULL bbox
  columns never satisfy the boundary branch, so it only ever returns
  boundary-bearing rows.
- A malformed stored boundary (a future validator bug, a hand-edit) fails
  **closed** at match time — the row is skipped and logged, never thrown
  into ingest, never silently re-checked against the circle (which would
  undo a pilot's deliberate tightening).
- The write path (`lib/sites/associate.ts`'s `setSiteBoundary`/
  `setZoneBoundary`/`clearSiteBoundary`/`clearZoneBoundary`) reuses the
  existing ownership model exactly — a zone's own owner, or the parent
  site's owner via the same `findZoneEditableBy` SPRINT-005 established —
  and, unlike rename/delete, is **never** refused because another pilot's
  flight references the row (a boundary edit destroys nothing; the worst
  case is a future flight matching differently). A widened boundary
  retroactively re-associates the drawer's **own** previously-unmatched
  flights via the existing `reassociateOwnFlights`, capped and logged the
  same way SPRINT-005's zone-naming flow already is.
- **The owner-scoped picker** (`listOwnedSitesForBoundaryEditing`/
  `listOwnedZonesForBoundaryEditing`) is the sprint's one deliberate
  departure from "never accept an id from the client": it lets a pilot edit
  a boundary on any site/zone they own or edit-control with **no flight
  bound to the target row at all** — closing a reachability gap where the
  editor could otherwise only be reached from an already-bound flight,
  which made expanding an off-radius site unreachable in practice. Every
  picker-sourced id is re-verified against ownership from scratch before
  any read or write trusts it, the same posture `findZoneEditableBy`
  already has for the bound-flight path.
- A `SITE_BOUNDARY_MATCHING=off` environment flag (read fresh in
  `lib/sites/lookup.ts`, not cached) reverts every row to circle-only
  matching with no data change and no redeploy — a rollback lever for a
  change that lands on the ingest hot path.
- Zone boundary size is deliberately **not** capped near the old
  300–400 m circle scale (a stakeholder decision, not an oversight): a
  large public zone boundary can out-rank nearby sites via the zone-first
  short-circuit, an accepted risk mitigated by the editor showing the
  current circle and nearby visible geometry while drawing, a per-caller
  daily edit cap, and the one-command `boundary-clear` remedy.
- `scripts/admin-sites.ts` gains `boundary-clear`/`zone-boundary-clear`
  (writing no `Flight` column, so — like `merge`/`rename` — they stay
  entirely outside `write-audit.test.ts`'s cache-writer allowlist) and a
  boundary-preservation guard on `merge`/`zone-merge`: a merge that would
  silently drop a source boundary onto a boundary-less target is refused
  unless run with `--force`, which carries the boundary across instead.

### Community ownership for public sites & zones (SPRINT-007)

A public `Site`/`Zone` stops being editable by only its `ownerId` — any
signed-in, **onboarded** pilot (has a `Profile` row, not merely an
authenticated `User`) may rename it or redraw its boundary. Private rows are
completely unaffected: still owner-only, exactly as SPRINT-004/005/006.
`ownerId` itself doesn't change shape or meaning — it stays as creator/
provenance, keeps driving publish/unpublish authority, and keeps anchoring
the delete guard.

- **The append-only log, not a last-writer column.** `LocationAuditEntry`
  (nullable `siteId?`/`zoneId?` + a raw-SQL `num_nonnulls = 1` CHECK — same
  Prisma-v6-can't-express-this precedent as the boundary bbox CHECK) records
  every consequential mutation: `create`, `published`, `renamed`,
  `boundary_set`, `boundary_cleared`, `merge`. **Written only while the row
  is public at the time of the mutation** (`lib/sites/audit.ts`'s
  `writeAuditEntry` is a no-op for a private target) — the one rule that
  fully closes the private→public disclosure gap: a private row's edit
  history is never recorded, so there's nothing to leak when it's later
  published. `boundaryUpdatedById` (SPRINT-006) is unchanged and stays
  alongside the log as the fast last-writer lookup.
- **The contributor roster is derived, not materialized** — a `GROUP BY
  actorId` over the audit log (`lib/sites/contributors.ts`), always
  consistent with the log by construction, no second write to drift out of
  sync. A pilot whose flight was merely auto-matched to a site never
  appears; only a deliberate edit counts.
- **Endorsements** (`SiteEndorsement`/`ZoneEndorsement`) mirror `Kudo`'s
  shape and toggle mechanic exactly, with two deliberate differences: no
  self-endorsement restriction (the composite PK is what actually prevents
  double-voting), and zone gating checks **effective** visibility (zone AND
  parent site both public — the same conjunction `canSeeZone` uses
  elsewhere), not the zone's own `visibility` column in isolation. Pure
  display signal — no effect on `findLocation` ranking or matching.
- **Edit-control** (`lib/sites/associate.ts`'s `canCommunityEditSite`/
  `canCommunityEditZone`) gates `renameSite`/`renameZone`/
  `setSiteBoundary`/`setZoneBoundary`/`clearSiteBoundary`/
  `clearZoneBoundary`: the row's owner (any visibility), or — for a
  PUBLIC/effectively-public row only — any onboarded pilot.
  `setSiteVisibility`/`setZoneVisibility`/`deleteSite`/`deleteZone`/
  `unpublishOwnSite`/`unpublishOwnZone` stay owner-only, unchanged.
  `DAILY_COMMUNITY_EDIT_CAP` (20/caller/day) generalizes SPRINT-006's
  boundary-only cap to also cover renames, now sourced directly from the
  audit log rather than a separate counting query.
- **`hasCommunityFootprint`** extends the existing delete/unpublish guards:
  once another pilot has made a *real* edit (an audit entry with a
  different actor), ordinary creator delete/demote is refused — routed to
  operator remedy instead. A bare endorsement, with no edit behind it, does
  **not** count — only actual contributions do.
- **UI reachability was the sprint's own biggest gap**, caught only in
  cross-critique during planning: `SiteNameControl` was owner-only before
  this sprint (plain text for anyone but the flight's own owner), which
  would have made community editing unreachable — a stranger has no flight
  of their own bound to a site they didn't create. The label is now
  clickable for **any** viewer (including anonymous, read-only) whenever
  the underlying site/zone is public, opening a new
  `LocationCommunityDialog` — separate from the existing `NameSiteDialog`,
  which stays flight-owner-only for "which site does *my* flight point to."
  Editing a public row's own name/boundary and binding a site to one's own
  flight are two different actions now, not one.
- `scripts/admin-sites.ts merge`/`zone-merge` re-point the losing row's
  audit entries and endorsements onto the survivor (an `UPDATE`, not a
  cascade-and-lose) before the delete, deduping any endorsement that would
  collide with an existing composite-PK row on the target. New `audit`/
  `zone-audit` commands print a row's full history, most recent first.

### Zones hidden from the product surface (SPRINT-008)

Zones got "too complicated" (the user's own words) after three sprints of
added surface area (two-level hierarchy, boundaries, community ownership) —
SPRINT-008 hides the zone level from pilots while keeping every zone-aware
code path, and every row, exactly as it was. **This is a hide, not a
delete**: zero schema migration, zero data touched. Reversing it later is a
re-exposure pass (flip the gate, confirm the preserved gate-on test suites
still pass), not a reconstruction.

- **One centralized, fail-closed, default-off gate**: `zonesEnabled()`
  (`lib/sites/zones-enabled.ts`) reads `process.env.ZONES_ENABLED` fresh on
  every call — `true` only for the literal string `"true"`, everything else
  (including absent, the production default) means hidden. Same operational
  shape as SPRINT-006's `boundaryMatchingEnabled()` kill switch.
- **Matching**: `findLocation` (`lib/sites/lookup.ts`) skips the `Zone`
  candidates query entirely when disabled — not merely discarding the
  result, no query at all. A flight endpoint always resolves to a site.
- **Display**: `lib/flights/repo.ts`'s `resolveEndpoint` suppresses
  `zoneId`/`zoneName` for every viewer, including a flight's own owner, on
  an endpoint bound to a zone *before* this sprint — the stored `Flight`
  columns are untouched, only what this function returns changes.
- **Creation**: `createOrAttachSiteFromFlight` (`lib/sites/repo.ts`) rejects
  a `zone` input outright; `suggestNearbyLocations` skips its zone query and
  no longer lets a now-hidden zone's proximity pull an otherwise-unqualified
  site into the reuse-first suggestions.
- **UI client gate plumbing.** A client component can't read
  `process.env` — `FlightHeader` computes `zonesEnabled()` server-side and
  threads it as a prop through `SiteNameControl` into `NameSiteDialog`,
  which needs it structurally (not just data-driven): the dialog's initial
  step, whether choosing/creating a site submits immediately vs. advances
  to a "Which spot?" step, and whether `ZoneStep` renders at all, are all
  client-side decisions the stripped data alone can't make. This gap — a
  client component needing the gate as an explicit prop, not inferring it
  from already-hidden data — was the one thing the sprint's cross-critique
  caught that neither independent planning draft fully solved alone.
- **Server actions reject, don't just hide.** Every zone-parallel action
  across `site-action.ts`/`boundary-action.ts`/`community-action.ts`
  rejects or null-returns when disabled, with the same generic
  ("Zones are not available.") error every other hidden/nonexistent-row
  path in this app already uses — the real boundary is the server action,
  not the UI's decision not to offer the affordance.
- **Operator tooling is the one deliberate exemption.** `scripts/
  admin-sites.ts`'s `zone-*` commands stay fully functional regardless of
  the gate (anchoring decision 6) — a zone hidden from the product can
  still need an operator rename/force-private/merge while it waits.
- **Tests are split, not dropped.** Every pre-SPRINT-008 zone-outcome test
  that would only pass under the old always-on behavior sets
  `ZONES_ENABLED=true` in its own setup and becomes explicit "gate-on
  legacy" coverage — the concrete proof that reversibility is real, not
  just claimed, and the guard against a future re-enable discovering the
  hidden machinery has rotted. New "default-off" tests prove the shipped
  hidden behavior. Tests of pure gate-agnostic helpers (`canSeeZone`,
  boundary validation, the audit/contributor/endorsement library functions)
  are untouched either way.

## Auth

NextAuth v5 with the Prisma adapter and a custom email magic-link provider. JWT
sessions so the edge `proxy.ts` can read auth without a DB call (it imports only
the edge-safe `lib/auth.config.ts`, never Prisma). In production the link is sent
via Resend; in dev it's written to `/tmp/leaf-magic-link.txt` + logged.

## IGC correctness notes

- Tolerant parser: A/H/B records, `HFDTE` (+ two-digit year), UTC midnight
  rollover, sub-metre coord decoding, null-island/range rejection, zero/stuck
  baro treated as absent.
- Vario (`max climb/sink`) is computed over a ~3 s smoothing window and cumulative
  gain uses a noise threshold — raw 1 s GPS deltas would otherwise produce garbage.
- Times are stored UTC; the flight's local timezone + offset (from takeoff coords)
  drive local-time display.

## Deferred (documented, not built in M1)

- Launch-coordinate privacy zones (obfuscation on public flights).
- Community feed / following / kudos.
- Device-push API + device-auth model.
- Fuzzy near-duplicate detection; moving large blobs to object storage if they
  outgrow Postgres.
