# Sprint 001 Draft Critique

## Claude Draft

### Strengths

- Takes clear, concrete positions on every major open question: Next.js/TypeScript, Vercel, Supabase Postgres/PostGIS/Auth/Storage, Drizzle, MapLibre, uPlot, in-house parser, and ParaglidingEarth-backed site lookup.
- Strongest architectural contribution is the shared `ingest(rawBytes, source, ownerId)` core. That directly satisfies the intent to support web upload now without painting the future Leaf device-push API into a separate ingestion path.
- Treats privacy as a real platform invariant, not a UI feature. The combination of default-private schema, RLS, repository-level viewer scoping, explicit 404 behavior, and privacy tests is aligned with the brief.
- Correctly separates raw IGC storage, derived scalar metrics, and render artifacts. Keeping heavy point arrays out of primary list queries is a good call for logbook/profile performance.
- IGC parsing plan is unusually complete for a sprint draft: A/H/B records, `HFDTE`, UTC midnight rollover, baro-vs-GPS fallback, takeoff/landing detection, cumulative gain, climb/sink, track distances, malformed files, non-Leaf files, zero-movement flights, huge files, duplicate uploads, and second-source sanity checks.
- Phasing is pragmatic. It creates a headless parser/deriver phase before UI integration, then a vertical slice, then privacy hardening, then site lookup and polish. Site lookup can degrade to "Unknown site" without blocking the core upload-to-flight-page flow.
- Definition of Done is specific and testable. It includes all M1 success criteria, the full metric list, privacy behavior, parser fixtures, CI tests, deployment, and design alignment.
- Security section is concrete: service-role isolation, storage scoping, upload caps, no client-side service key, raw IGC privacy, and PII minimization for IGC headers.

### Weaknesses

- The plan is probably too large for one solo sprint unless the sprint is intentionally long. It includes full auth, onboarding, RLS, Drizzle migrations, parser fixtures, CLI tooling, MapLibre, uPlot, storage artifacts, multi-file upload, public profiles, Playwright, site seeding, brand polish, accessibility, deployment docs, and production smoke tests.
- It overcommits to implementation details before the codebase exists. Drizzle plus Supabase RLS plus Supabase Auth can work, but the draft does not spell out how authenticated database context will be preserved when querying through server-side Drizzle. If Drizzle uses a privileged Postgres connection, RLS can be bypassed unless the app explicitly sets claims or restricts service-role usage.
- The storage privacy model needs more detail. Track artifacts can reveal exact takeoff/landing and home flying patterns just as much as raw IGC files. The draft mentions signed URLs "or owner/public-scoped" but does not define the exact rule for private vs public artifact access.
- Synchronous ingestion is acceptable for M1, but the draft should draw a harder line around timeout behavior. "M1 parse is ms for ~10k points" may be true for parsing, but upload, storage write, site lookup, artifact write, and DB insert can still create partial-failure states.
- The site lookup plan leans on ParaglidingEarth without resolving access, licensing, data freshness, attribution, import format, or regional coverage. It flags these as remaining questions, but the M1 plan still depends on them for a named-site DoD item.
- The `tracks/{id}.json` artifact is under-specified. It needs a version, units, altitude source semantics, timestamps, downsampling method, and enough metadata to avoid breaking old flight pages after metric/render changes.
- Public profile stats are mentioned, but the privacy semantics of those stats are not fully pinned down. Public stats must be computed only from public flights for logged-out visitors, while owner views can use all flights.

### Gaps In Risk Analysis

- Does not explicitly cover partial ingestion rollback. Failure after raw upload but before DB insert, or after DB insert but before `track.json`, can leave orphaned storage objects or broken flight pages.
- Does not call out geolocation privacy risk from public tracks. A pilot can accidentally publish home/landing patterns, exact launch coordinates, or sensitive unofficial sites. A warning or future coordinate-obfuscation policy should at least be acknowledged.
- Does not identify RLS bypass as sharply as it should for a mixed Drizzle/Supabase setup. The risk row says service role bypass is possible, but the mitigation remains process-heavy unless the concrete client strategy is specified.
- Does not cover timezone/display-date confusion. IGC times are UTC, but pilots expect local flight dates/times. The parser can correctly handle UTC rollover while the UI still displays a surprising date if no local timezone/site timezone policy exists.
- Does not mention malicious-but-valid IGC payloads beyond size and text validation: extremely dense fixes, repeated timestamps, impossible jumps, negative altitudes, invalid hemisphere flags, huge extension fields, or pathological lines that pass loose parsing.
- Does not cover third-party tile/provider privacy. Public and private flight views may send coordinates or viewport bounds to MapTiler unless mitigated or accepted.
- Does not cover duplicate semantics beyond per-owner raw hash. The same flight uploaded with minor header edits, trimmed fixes, or device-generated duplicate files will evade exact hash dedupe.

### Missing Edge Cases

- IGC parsing:
  - B records with invalid `A/V` flags mixed into otherwise valid flights.
  - Missing or malformed `HFDTE`; two-digit year ambiguity.
  - Multiple date headers or logger-specific H-record variations.
  - Midnight rollover with long gaps, duplicate timestamps, or fixes sorted incorrectly.
  - Baro altitude present but zeroed, stuck, wildly noisy, or inconsistent with GPS altitude.
  - GPS coordinates at `0000000N/00000000E`, bad hemisphere markers, or out-of-range minutes.
  - Flights with pre-launch walking, cable-car/car movement, or post-landing retrieve movement that can fool sustained-movement detection.
  - Stationary hike-and-fly recordings where altitude changes but horizontal speed is low.
  - ENL/I/J extension fields and long records from non-Leaf recorders that should be ignored safely.
- Privacy enforcement:
  - Private `track.json` and raw IGC URL access, not just the flight row.
  - Public flight page must not expose raw IGC headers containing private pilot names, glider serials, or logger IDs beyond intentionally displayed fields.
  - Public profile aggregate stats must exclude private flights.
  - Visibility toggle race conditions: a previously issued signed artifact URL may remain valid after switching public to private.
  - Unauthorized update/delete attempts on another pilot's flight.
- Site reverse-lookup:
  - Multiple sites within threshold; type-specific takeoff vs landing choice.
  - Unknown or sparse regions where nearest known site is misleading.
  - Out-and-return or top-landing flights where takeoff and landing are effectively the same site.
  - Landings at official LZs far from takeoff; separate takeoff and landing thresholds need validation.
  - Sites with polygons/launch areas rather than a single point.
  - Cross-border sites, duplicate names, stale names, and imported coordinates with poor precision.

### Definition-of-Done Completeness

Claude's DoD is the more complete of the two drafts and mostly matches the brief. It covers signup, handle claim, upload, server-side parsing, flight detail, all requested metrics, site names with fallback, logbook, default-private sharing, logged-out public profile behavior, parser robustness, tests, Leaf branding, shared ingestion, and deployment.

The main missing DoD items are artifact-level privacy, partial-ingestion cleanup, public-stat privacy, and a site-data license/attribution acceptance check. The DoD should also require tests or checks for private raw IGC/track artifact access, not only private flight URL access.

## Gemini Draft

### Strengths

- Concise and easy to execute from. It identifies the core product path clearly: onboarding, upload, processing, logbook, flight detail, privacy toggle, and public sharing.
- Makes reasonable stack choices for a small team: Next.js, TypeScript, Supabase, PostGIS, Supabase Auth/Storage, MapLibre, and a custom TS parser.
- Keeps the implementation phases simple and understandable: foundation/auth, ingestion/list, flight page, privacy/public profiles.
- Correctly identifies several key risks: IGC parsing edge cases, map tile costs, site lookup accuracy, and large-track performance.
- Calls out RLS explicitly as an absolute requirement, which is essential for the private-first brief.
- Includes a DoD with the essential user-facing happy path: signup, upload, flight page, metrics, site lookup, private/public behavior, design match, lint/type checks, and parser tests.
- Avoids overbuilding community features or the device-push API, while still naming the API route as the future ingestion seam.

### Weaknesses

- It is too high-level for the risk level of this sprint. The brief says architecture uncertainty is high and IGC/site/privacy correctness are central; the Gemini draft often names components without defining the contracts or failure behavior.
- The ingestion seam is weaker than Claude's. `app/api/ingest/route.ts` is named as the future seam, but there is no explicit shared ingestion core that both web upload and device push will call. That leaves room for parsing/persistence logic to become route-specific.
- Privacy enforcement is under-specified. It says RLS blocks unauthorized access to private IGC tracks, but does not define policies for `flights`, `tracks`, storage objects, public profile queries, artifact URLs, or aggregate stats.
- The data model stores `Tracks.points` as JSONB "or as a large JSON column." That is a risky default for 5k-10k point flights and future growth. The brief explicitly notes object storage for raw files; a render artifact in storage is likely cleaner than large point arrays in Postgres.
- Recharts is a weaker charting pick for dense time-series flight data. It may be fine for downsampled data, but the draft does not require downsampling before rendering or define point caps for barograph performance.
- Styling choice is asserted but not defended. Vanilla CSS + CSS Modules can work, but the draft does not explain how it will maintain consistency across a multi-page app as UI complexity grows.
- The plan defers privacy until Phase 4, after upload/list/detail exist. Given "private by default" is foundational, schema defaults and read policies should be present as soon as flights exist, not added as a later hardening pass.
- It gives only one `site_id` on `Flights`, while the brief asks for reverse lookup of takeoff and landing coordinates to named sites. A single site cannot represent separate takeoff and landing sites or top-landing semantics cleanly.

### Gaps In Risk Analysis

- IGC parser risk is reduced to "midnight rollover" and fixtures. It omits altitude-source ambiguity, invalid fixes, malformed coordinates, takeoff/landing detection errors, non-Leaf logger differences, duplicate uploads, zero-movement files, and partial parses.
- Privacy leak risk is not treated as critical. The draft says RLS prevents ID guessing but does not discuss object storage leaks, public stats leakage, signed URL expiry, visibility toggles, or server routes accidentally using privileged clients.
- Site lookup risk focuses only on a 500m snap radius. It does not cover dataset licensing, refresh, regional gaps, multiple nearby launches, landing-site vs takeoff-site distinction, or misleading false positives.
- Does not address partial failure or transactional boundaries across storage, parser, DB, and site lookup.
- Does not mention upload abuse beyond a 2MB size cap. A malformed file can be small but computationally awkward or contain huge lines/extension fields.
- Does not address correctness validation for derived metrics beyond "verified against reference tools." It should specify which metrics require fixture assertions and tolerances.
- Does not call out local/UTC display risk, even though the intent highlights UTC and midnight rollover.
- Does not assess Supabase/PostGIS operational tradeoffs, storage policies, or migration lock-in despite choosing Supabase as an all-in-one backend.

### Missing Edge Cases

- IGC parsing:
  - Missing, malformed, duplicated, or ambiguous `HFDTE`.
  - UTC midnight rollover across one or more date boundaries.
  - Invalid `A/V` fixes and whether to exclude them from metrics.
  - Missing, zero, stuck, negative, or noisy barometric altitude; GPS fallback semantics.
  - Non-Leaf recorders with extra H/I/J extension records.
  - Truncated files ending mid-line or with no valid B records.
  - Repeated timestamps, out-of-order fixes, long gaps, and impossible speed jumps.
  - Zero-movement recordings and pre/post-flight ground movement.
  - Duplicate uploads by content hash and near-duplicate flights.
- Privacy enforcement:
  - Default `private` at the database schema level before any upload path exists.
  - RLS for `flights`, `tracks`, and profile/logbook queries, not just middleware.
  - Supabase Storage policies for raw IGC and derived track artifacts.
  - Public profile must exclude private flights and private-derived stats.
  - Private flight direct URL should return 404 or equivalent, including for another logged-in user.
  - Visibility changes must revoke or expire access to private artifacts.
  - API route authorization for toggling visibility and reading flight detail data.
- Site reverse-lookup:
  - Separate takeoff and landing site fields.
  - Threshold tuning by site type and terrain.
  - Multiple candidate sites within threshold, including launch and landing pairs with similar names.
  - No-data regions and "Unknown site" fallback.
  - Top-landing, out-and-return, and landing far from official LZ.
  - Dataset license, attribution, seed repeatability, and refresh path.

### Definition-of-Done Completeness

Gemini's DoD covers the headline demo but is incomplete against the sprint intent. It omits takeoff/landing times, straight-line distance, max sink, default-private at the schema level, personal logbook completeness, logged-out public profile URL behavior, durable raw IGC storage, shared ingestion-core readiness for device push, and explicit privacy tests.

It also says "correct metrics" without listing all required metrics or fixture edge cases. It should require parser tests for malformed/truncated IGC, missing baro, midnight rollover, zero movement, huge file, non-Leaf recorder, and duplicate upload. The site-name DoD of "at least 3 major test sites" is too weak; it should include threshold behavior, unknown fallback, and separate takeoff/landing handling.

## Synthesis Verdict: What To Steal

Steal from Claude:

- The explicit shared `ingest()` core and source-parameterized ingestion contract.
- The privacy model: default-private schema, RLS plus scoped repositories, explicit 404 behavior, and privacy tests.
- The object-storage split: raw IGC and render artifacts in storage, scalar metrics in Postgres.
- The detailed parser/deriver fixture plan and complete metric checklist.
- The phased vertical slice with site lookup gracefully degrading to "Unknown site."
- The DoD language around parser robustness, public/private behavior, and Leaf brand verification.

Steal from Gemini:

- The shorter, more communicable sprint shape. Claude's plan should be trimmed into Gemini's simpler phase narrative for execution.
- The instinct to keep M1 focused on the upload-to-presentation loop and not bury the team in too many ancillary files before the first runnable path.
- The simple risk table format, but populated with Claude-level specificity.
- The CSS Modules option is worth considering if the team wants maximum visual control and minimal design-system dependency, though it needs stronger conventions than the draft provides.

Final verdict: use Claude as the technical source of truth, but compress it before execution. Gemini is a good executive summary of the product slice, but it is not rigorous enough for the hard parts of this milestone: tolerant IGC parsing, artifact-level privacy, and trustworthy site reverse-lookup.
