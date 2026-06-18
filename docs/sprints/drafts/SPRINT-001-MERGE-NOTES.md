# Sprint 001 — Merge Notes

How the final `SPRINT-001.md` was synthesized from three independent drafts
(Claude/opus-4.8, Codex/gpt-5.5, Gemini), three cross-critiques, and the human interview.

## Convergence (all three drafts agreed — adopted as the spine)

- **Next.js App Router + TypeScript**, server-side parsing in a Node runtime.
- **Supabase** (Postgres + Auth + Storage) on **Vercel**.
- **MapLibre GL JS** for the track map (open renderer, no vendor lock).
- **In-house tolerant TS IGC parser** behind a **source-agnostic ingestion core** so the
  future Leaf device-push API reuses the same path. (Claude/Codex model this as a real
  `ingest()` function; Gemini coupled it to an HTTP route — we take the function form.)
- **Private by default**, enforced via **RLS** at the data layer.

## Draft strengths

- **Claude** — most complete; the `ingest()` seam, the object-storage track-artifact split,
  two-layer privacy, and the headless-parser-first phasing.
- **Codex** — best data model: `flight_assets`, `status`/`failure_reason`, `parse_warnings`,
  `parser_version`, sha-256 dedup, **separate takeoff/landing sites**, license/attribution
  columns; IGC header output-escaping; concrete cut lines; OpenAIP CC BY-NC license caution.
- **Gemini** — best execution shape: tight 4-phase vertical-slice cadence; **PostGIS KNN**
  from day one (the correct spatial primitive); concrete/testable DoD ("≥3 known sites");
  explicit >5000-point downsample contract.

## Critiques accepted (folded into the final)

- **Climb/sink + altitude-gain noise** (all three missed/under-specified): raw 1 s GPS
  deltas produce garbage max-climb/sink and inflated gain. → Added a **smoothing-window +
  noise-threshold** spec to the derivation. *Biggest correctness fix.*
- **Local-time display** (UTC-only in all drafts): → derive timezone from takeoff
  coordinates and show local time; store UTC + offset.
- **Drizzle-vs-RLS bypass** (Codex): a privileged ORM connection silently bypasses RLS. →
  **Dropped Drizzle for M1.** User-facing data access goes through the RLS-respecting
  Supabase client (forwards the user JWT); the **service-role client is confined to the
  ingest core**. Keeps RLS authoritative and reduces solo-dev footguns.
- **Partial-ingestion cleanup** (Codex): failure between storage write and DB insert orphans
  objects. → Ordered, idempotent ingest with cleanup-on-failure + a `status` lifecycle.
- **Visibility-toggle signed-URL race** (Codex): private→public→private can leave a live
  signed URL. → Short-lived signed URLs + serve private artifacts through an authorizing
  route, not long-lived links.
- **Public-stats privacy** (Codex): aggregate stats on public profiles must be computed from
  **public flights only** for non-owners.
- **Single `site_id` defect** (both reviewers, re: Gemini): → separate takeoff & landing
  site references with denormalized names.
- **Testable DoD** (Gemini): folded "≥3 known sites named" and "verified against a
  second-source viewer" into the DoD so site-lookup and metric accuracy are falsifiable.
- **Upload cap**: resolved to **5 MB** (Codex) over 2 MB (Gemini) — sized to real long-XC
  files, still DoS-safe.

## Critiques noted but deferred (documented, not built in M1)

- **Takeoff-point privacy zones** — per interview: **defer + document** as a known gap and
  near-term feature. Raw IGC always stays private; only derived data appears on public pages.
- **Near-duplicate detection** beyond exact sha-256 — M1 keeps exact-bytes dedup; fuzzy
  dedup is a later concern.
- **Background-job/queue ingestion** — M1 parses synchronously (files are small); the
  `ingest()` seam lets us move to a worker later without touching callers.

## Interview decisions (Paolo)

1. **Scope** → *tighter vertical slice first*: named-site lookup + deep polish are the
   trailing, cuttable phase.
2. **Styling** → *Tailwind + design tokens + shadcn/ui* (re-skinned to `DESIGN.md`).
3. **Sign-in** → *email magic-link only* for M1; Google/Apple OAuth deferred.
4. **Launch privacy** → *defer + document* (above).

## Orchestrator decisions (taken with rationale, not interviewed)

- **Sites query**: PostGIS `geography` + GiST **KNN** (Gemini) over Codex's deferred-PostGIS
  btree — Supabase ships PostGIS; KNN is the right primitive for a core feature.
- **Track storage**: versioned `track.json` artifact in **private object storage** (units,
  altSource, downsample metadata) — not JSONB rows in Postgres.
- **Barograph**: **Recharts** (React-native, easy to brand) on **downsampled** data
  (≤~2000 pts); revisit uPlot only if perf demands.
- **Named-site data**: best-effort with a **manual-seed Plan B**; store `source_url`/`license`;
  confirm ParaglidingEarth bulk terms during the sprint before treating breadth as in-scope.

## Not done

- Ledger sync (`scripts/ledger.py`) — N/A on a greenfield repo with no ledger tooling.
