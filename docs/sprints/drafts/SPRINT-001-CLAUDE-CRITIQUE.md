# Sprint 001 Draft Critique (Claude)

Critique of the two competing Milestone‑1 drafts against `SPRINT-001-INTENT.md`,
`VISION.md` ("private‑first, Strava for the rest of us"), and `DESIGN.md`.

Both drafts converge on the same core stack — **Next.js App Router + TypeScript +
Supabase (Auth/Postgres/Storage) + MapLibre + Recharts** — so the stack is not the
differentiator. The drafts diverge on *thoroughness*, *data modeling*, *where privacy
is enforced*, and *how site lookup is done*. The Codex draft is a near‑complete
engineering plan; the Gemini draft is a crisp vertical‑slice outline that is faster to
read but leaves the dangerous details unspecified.

---

## Draft A — Codex (`SPRINT-001-CODEX-DRAFT.md`)

### Strengths
- **The ingestion seam is modeled correctly, not just named.** `ingestFlight({ source,
  userId, file })` separates parse/derive from transport, so the future device‑push path
  reuses the *core* rather than an HTTP route. This directly satisfies the intent's
  "don't paint us into a corner" constraint. (Gemini calls an API route "the clean seam,"
  which couples ingestion to HTTP.)
- **Data model is production‑grade.** Separate `flight_assets` table, `status`
  (`uploaded|processing|ready|failed`) + `failure_reason`, `parse_warnings jsonb`,
  `parser_version`, and `igc_sha256` with a `(owner_id, igc_sha256)` unique index for
  per‑pilot dedup. The `parser_version` + raw‑file‑first storage gives a reprocessing
  path when the parser is later fixed — a real operational win.
- **Privacy enforced at the data layer, as the intent demands.** RLS on all user tables,
  private buckets, derived track served through an authorized server route that checks
  `owner OR visibility='public'`, and an explicit rule that **raw IGC is never public even
  for public flights** (public pages get sanitized derived data only).
- **Honest site lookup.** Stores both `site_id` *and* denormalized `site_name` so old
  flights stay readable if site data changes; "Unknown site" instead of a guessed town;
  attribution/`license`/`source_url` columns; repeatable import + manual‑correction path.
- **Separate `takeoff_site_id` and `landing_site_id`** — correctly recognizes a flight has
  two distinct sites.
- **Concrete cut lines** ("never cut private‑by‑default; cut profile polish before parser
  correctness") give the solo dev a defensible descope order.
- **Output‑escaping of IGC header fields** is called out — closes a real stored‑XSS vector
  (pilot/glider names in H‑records are attacker‑controlled text).

### Weaknesses
- **Phase 0–5 is a lot for a solo dev "M1."** Six phases, ~50 files enumerated, a deploy
  doc, rate limiting, audit timestamps. Real risk the sprint over‑runs before the vertical
  slice is demonstrably working. There's no "thinnest runnable slice by end of week 1"
  marker the way Gemini front‑loads a logged‑in slice.
- **Derived track stored as a JSON blob in object storage** is cleaner for size, but every
  flight view now requires an authorized fetch round‑trip to storage *and* the route that
  guards it. For a logged‑out public view this is more moving parts than reading a
  public‑RLS Postgres row. Defensible, but the added auth surface is the place a privacy
  bug will hide.
- **Defers PostGIS and indexes sites on `(lat, lon)` btree.** A composite btree on two
  independent range columns only really uses the `lat` prefix; the bounding‑box query
  degrades to a lat‑slice scan. Fine at seed scale, but it's presented as a deliberate
  spatial design when it's actually the weaker spatial approach (see Gemini).
- **`(owner_id, igc_sha256)` dedup is exact‑bytes only.** A re‑exported / re‑signed copy of
  the same flight (different G‑record, trailing whitespace) sails past it. Not necessarily
  wrong for M1, but the plan presents hashing as *the* dedup answer without naming the gap.

### Gaps in risk analysis
- **No timezone/local‑time risk.** Everything is `timestamptz` (UTC). A flight page that
  shows takeoff at "13:00" in UTC for a pilot who launched at 06:00 local is a credibility
  bug for a logbook. Not in the risks table or the plan.
- **No metric‑noise risk.** "IGC edge cases create incorrect metrics" is listed, but the
  *specific* and near‑guaranteed failure — raw 1 s GPS deltas producing absurd max
  climb/sink and inflated cumulative altitude gain without smoothing/thresholding — is not
  identified (see edge cases below).
- **ParaglidingEarth licensing is hand‑waved.** "Where licensing/permission permits" with
  no fallback if it *doesn't*. PGE's bulk data terms are genuinely unclear; if the answer
  is "no," the named‑site feature has no data source and there is no Plan B in the risk
  table beyond "manual seed."
- **No auth‑deliverability risk.** Chooses magic‑link/email sign‑in; email deliverability
  and the friction of no‑password onboarding for "beginner pilots" is unmentioned.

### Missing edge cases
- **IGC:** vario smoothing window for max climb/sink (raw 1 s deltas are unusable);
  cumulative‑gain noise threshold; `HFDTE` two‑digit‑year century handling; A/V fix‑validity
  filtering (mentions "invalid fixes" but not the 2D/3D `A`/`V` flag specifically);
  baro‑vs‑GPS choice for *absolute* max altitude (IGC pressure altitude is ISA‑referenced to
  1013.25, not QNH); I‑record extension awareness. It does handle midnight rollover, missing
  baro, zero‑movement, malformed, and large files well.
- **Privacy:** **no takeoff‑point obfuscation / "privacy zones."** A public flight publishes
  exact takeoff coordinates, which for many pilots is effectively their home/local launch.
  For a self‑described *private‑first* product this is the one privacy gap that matters and
  it isn't named (even as a deferred future item). The "avoid collecting precise home
  location" note sits oddly next to publishing precise takeoff coords.
- **Site lookup:** no `kind` filtering (a takeoff coord could match a landing‑only site even
  though the column exists); 2 km / 3 km thresholds can mislabel in dense areas (Alps) where
  multiple launches sit within 2 km; no altitude disambiguation for stacked sites.

### Definition‑of‑Done completeness
Strong and well‑mapped to the success criteria (privacy denial for *non‑owners* explicitly
included; design tokens enumerated; deploy + env docs as exit criteria). Gaps:
- **Site‑lookup quality is untestable as written** — "matched when a confident match exists"
  is unfalsifiable. Needs a concrete bar (Gemini's "≥3 known sites correctly named").
- Numeric metric‑accuracy verification lives in the Phase‑5 checklist but isn't restated as
  a DoD acceptance criterion.
- No accessibility/contrast bar for amber‑on‑white, no stated mobile acceptance in the DoD
  (only in a phase checklist).

---

## Draft B — Gemini (`SPRINT-001-GEMINI-DRAFT.md`)

### Strengths
- **Readable and sequenced for momentum.** Four phases, each an explicitly "runnable
  vertical slice" (logged‑in → upload→list → flight page → privacy). For a solo dev this
  ordering is psychologically and practically better than a 6‑phase plan.
- **PostGIS from day one** with `geography(point)` and nearest‑neighbor search. This is the
  *correct* spatial primitive — a GiST KNN index gives accurate, fast nearest‑site lookup
  rather than a lat‑prefixed btree scan. On the one feature both drafts treat as core, this
  is the better engineering call.
- **Concrete, testable DoD items**: "site correctly identified for ≥3 major test sites,"
  "verified against reference tools," "zero linting/type errors." These are pass/fail; Codex
  has more coverage but some vaguer criteria.
- **Explicit downsample rule** (">5000 points → downsample for map/chart") — a numeric perf
  contract Codex only implies.
- **Brand voice surfaces in the plan** ("Join the Leaf Community" CTA), a small sign it read
  `VISION.md`/`DESIGN.md` for tone, not just tokens.
- **CSS Modules argument is legitimate**, not lazy: bespoke brand work genuinely fights
  Tailwind utility‑soup, and the design language is specific. This is a real, defensible
  divergence rather than an error.

### Weaknesses
- **Privacy is enforced in the wrong layer.** `middleware.ts (Privacy enforcement)` plus
  "RLS blocks unauthorized access." Middleware is a routing/edge concern and is the classic
  place authorization gets *bypassed* (route handlers, server actions, direct asset URLs).
  The intent explicitly says enforce visibility **at the data layer, not just the UI** —
  this draft leans on a layer that is closer to UI than data.
- **Single `site_id` on Flights cannot represent takeoff *and* landing sites.** This is a
  concrete data‑model defect given the intent's "reverse‑lookup takeoff *and* landing." It
  would need a schema change to fix later.
- **No denormalized site name, no attribution/license columns** on `Sites`. Historical
  flights lose their site label if a row changes, and there's no place to store the
  ParaglidingEarth source/license the plan depends on — a compliance gap baked into the
  schema.
- **Tracks stored as JSONB rows in Postgres.** Large per‑flight JSON in the DB inflates row
  size, backups, and egress, and pulls big blobs through RLS on every render. Object storage
  (Codex) is the better home for this payload.
- **2 MB upload cap may reject legitimate files.** A long XC flight at 1 s cadence can exceed
  2 MB of ASCII; Codex's 5 MB is safer. The cap is justified only as DoS protection, not
  sized against real Leaf files.
- **No parser robustness story.** "Robust line‑by‑line B‑record extraction" is the whole
  parsing spec. No `status='failed'`, no `parse_warnings`, no `parser_version`, no
  reprocessing path, no fail‑closed behavior. For the highest‑uncertainty part of the
  product this is under‑specified.

### Gaps in risk analysis
- **No privacy‑leak risk row at all.** For a private‑first product, omitting privacy from the
  risk table (it appears only as a one‑line Security note) badly under‑weights the single
  highest‑impact failure mode. Codex rates this "High" with mitigations; Gemini effectively
  doesn't rank it.
- **No parse‑failure / malformed‑crash risk.** "Edge cases → unit test heavily" is the only
  nod; there's no mitigation for "the request must never crash" or for surfacing failure to
  the user.
- **No licensing risk** for the site dataset it depends on.
- **No vendor/serverless‑timeout risk** for synchronous parsing in a Vercel function (Codex
  flags this and offers a worker fallback).

### Missing edge cases
- **IGC:** mentions only UTC rollover. Silent on missing baro altitude, zero‑movement
  "flights," non‑Leaf recorders, truncation, fix‑validity flag, `HFDTE` parsing, and the
  climb/sink smoothing + cumulative‑gain noise problem (same blind spot as Codex).
- **Privacy:** same missing takeoff‑point obfuscation as Codex, *plus* it doesn't state that
  raw IGC stays private on public flights, doesn't specify Storage bucket policies (only DB
  RLS), and doesn't enumerate the non‑owner‑logged‑in ID‑guessing case in its tests — its
  DoD only covers "logged‑out."
- **Site lookup:** 500 m snap radius is likely *too tight* (first valid fix can sit
  100–500 m from the catalogued launch point), inverting Codex's too‑loose 2 km problem;
  no "Unknown site" honesty rule; no manual‑correction path.

### Definition‑of‑Done completeness
Good where it's concrete (reference‑tool verification, ≥3 named sites, zero type errors), but
materially thinner:
- **Privacy DoD covers only logged‑out users**, not authenticated non‑owners — i.e. it omits
  the actual attack (another pilot guessing a flight ID). Codex covers this.
- No "private by default" assertion, no raw‑IGC durability criterion, no duplicate‑upload
  handling, no parse‑failure UX, no deploy/env‑docs exit criteria, no parser‑edge‑case
  fixture breadth requirement.

---

## Cross‑cutting gaps both drafts share
1. **Climb/sink + altitude‑gain noise.** Neither specifies a vario smoothing window (~2–3 s)
   or a cumulative‑gain threshold. Without it, max climb/sink and "height gained" will be
   numerically wrong on real GPS data — and these are headline metric tiles. This is the most
   important *correctness* gap in both.
2. **Local‑time display.** Both store UTC and neither plans the conversion (site coords →
   timezone, or stored UTC offset) needed to show a pilot their flight in local time.
3. **Takeoff‑point privacy ("privacy zones").** Both publish exact launch coordinates on
   public flights with no obfuscation option — the one privacy concept a "private‑first"
   logbook most plausibly needs, absent from both even as a deferred item.
4. **ParaglidingEarth licensing as a hard dependency** with no confirmed‑legal fallback if
   the terms don't permit redistribution.

---

## What to steal from each — synthesis verdict

**Base the sprint on the Codex draft.** It is the more complete and more correct plan, and
it gets the two things the intent stresses most — the *source‑agnostic ingestion seam* and
*data‑layer privacy* — substantially right, where Gemini gets the seam half‑right and puts
privacy in the wrong layer.

**Steal from Codex (keep as the spine):**
- `ingestFlight({ source })` seam decoupled from HTTP.
- The richer schema: `flight_assets`, `status`/`failure_reason`, `parse_warnings`,
  `parser_version`, sha‑256 dedup, **separate takeoff/landing site IDs**, and denormalized
  `site_name` + attribution/license columns.
- Privacy enforced at the data layer: RLS + private buckets + authorized track route;
  raw IGC never public; explicit non‑owner denial tests.
- IGC header output‑escaping; "Unknown site" honesty; explicit descope/cut lines.

**Steal from Gemini (graft in):**
- **PostGIS `geography` + GiST KNN** for site lookup — replace Codex's deferred‑PostGIS
  `(lat,lon)` btree. This is the better call on a core feature and there's no reason to ship
  the weaker spatial index first.
- **Concrete, testable DoD phrasing** — fold "≥3 known sites correctly named" and
  "verified against a reference tool" into Codex's DoD to make site‑lookup and metric
  accuracy falsifiable.
- **The explicit downsample threshold** (>5000 points) as a stated perf contract.
- **The vertical‑slice cadence** — front‑load Codex's Phase 0/1 into a single "runnable
  logged‑in slice" milestone so there's a demoable app early, trimming Codex's six phases
  toward Gemini's four.

**Fix in both (must‑add before execution):** climb/sink + altitude‑gain smoothing spec;
local‑time display plan; a takeoff‑point privacy‑zone decision (even if "deferred,
documented"); and a confirmed‑legal site‑data source (or a manual seed Plan B) before
named‑site is treated as in‑scope.

**Reconcile the one genuine tie:** Tailwind (Codex) vs CSS Modules (Gemini) is a real
preference, not a correctness issue — both can hit `DESIGN.md` via CSS variables/tokens.
Pick on solo‑dev velocity (Tailwind ships faster) unless the team wants the bespoke‑brand
control CSS Modules gives; either is acceptable. Resolve the upload cap toward **5 MB**
(Codex) over 2 MB (Gemini) — sized to real files, still DoS‑safe.
