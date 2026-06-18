Attempt 1 failed: You have exhausted your capacity on this model. Your quota will reset after 7s.. Retrying after 8937ms...
I will now write the critique of the two sprint drafts to `docs/sprints/drafts/SPRINT-001-GEMINI-CRITIQUE.md`.

# Critique: Leaf Log Sprint 001 Drafts (Claude vs. Codex)

This document evaluates the proposed plans for Milestone 1 of Leaf Log, comparing the **Claude** and **Codex** drafts against the project's vision, design requirements, and technical constraints.

---

## 1. Claude Draft: Critique

### Strengths
- **Architectural Foresight:** The `ingest(rawBytes, source, ownerId)` abstraction is the strongest architectural move. It perfectly anticipates the M2 device-push API without adding over-engineering now.
- **Privacy Model:** The "RLS as the floor, repository as the gate" approach is robust. Explicitly naming Row-Level Security (RLS) as a primary requirement ensures privacy isn't just a UI checkbox.
- **Artifact Strategy:** Splitting heavy point arrays into `track.json` in object storage while keeping scalars in Postgres is an excellent optimization for performance and cost.
- **Visual Fidelity:** Strongest adherence to `DESIGN.md`. It explicitly plans for the 3px amber accent-bar primitive and specific monochrome map styling.

### Weaknesses
- **Synchronous Risk:** While it mentions being "synchronous for M1," it underestimates the risk of Vercel function timeouts (10–15s on Hobby tier) when parsing larger 10k+ point IGC files and doing multiple storage/DB writes.
- **Complexity Overhead:** Drizzle + Supabase + Custom Repository + RLS might be slightly "heavy" for a solo dev in Phase 1, though it pays off in Phase 2.

### Gaps in Risk & Edge Cases
- **IGC Parsing:** Misses the "A-record manufacturer identification" requirement for custom Leaf-specific parsing logic vs. generic files.
- **Site Lookup:** The KNN radius threshold for takeoff (400m) and landing (700m) is a good start but doesn't account for "hike-and-fly" scenarios where a pilot might launch far from a known site but land at one.
- **Privacy:** Missing the edge case of "Private derived assets." If `track.json` is in a public bucket with a predictable ID, RLS on the DB doesn't protect the map data.

### Definition-of-Done (DoD) Completeness
- **High.** Covers the full lifecycle including public profiles and the ingestion seam. The "Privacy test in CI" is a critical addition.

---

## 2. Codex Draft: Critique

### Strengths
- **Pragmatic Geospatial:** The decision to avoid PostGIS for M1 and use a simple Haversine lookup in application code is a great "velocity first" move, keeping the DB setup simple.
- **Legal/Compliance Awareness:** Correctly identifies the risk of OpenAIP licensing and favors ParaglidingEarth with explicit attribution fields.
- **Error Handling:** More focus on "plain-language parse warnings" for the pilot, which aligns better with the "beginner/intermediate" persona.
- **Data Integrity:** Explicitly versions the parser output (`parser_version`), allowing for easy re-parsing of files if the derivation logic improves.

### Weaknesses
- **Tooling Choice:** Recharts for the barograph. While easy to use, Recharts (SVG-based) can struggle with 10k+ point flight tracks compared to Canvas-based solutions like uPlot.
- **Privacy Logic:** Relies more on "Next.js routes enforcing access" rather than the database-level RLS focus of Claude. This is slightly riskier for a "private-first" mandate.
- **Site Name Logic:** The decision to display "Unknown site" rather than a geocoded town is honest but might feel "broken" to a beginner pilot who expects *some* context (e.g., "Unknown site near Interlaken").

### Gaps in Risk & Edge Cases
- **Midnight Rollover:** Acknowledges it but doesn't specify *how* (HFDTE header check).
- **Duplicate Uploads:** Handles them at the DB level, but misses the "Partial Success" UX (e.g., if a user uploads 5 files and 2 are duplicates).
- **Site Reverse-Lookup:** Missing a strategy for "Official Leaf corrections" to the site dataset.

### Definition-of-Done (DoD) Completeness
- **Medium-High.** Strong on verification and ops documentation, but slightly less specific on the visual brand primitives compared to Claude.

---

## 3. Comparative Gap Analysis

| Feature | Missing in Both Drafts |
|---|---|
| **IGC A-Record** | Neither plan explicitly uses the `A` record to verify if a file *actually* came from a Leaf device (useful for future "Verified Leaf Flight" badges). |
| **Privacy / Site** | Neither handles "Site Privacy." Some sites are "sensitive" or "local-only." A private-first app should ideally let users hide the *site name* even if the flight is public. |
| **Storage Cleanup** | No plan for cleaning up orphaned `track.json` artifacts if a flight ingestion fails halfway or is deleted. |
| **Map Tiles** | Both rely on MapTiler free tier. Neither addresses the "offline" or "low-bandwidth" experience for pilots viewing logs in the mountains. |

---

## 4. Synthesis Verdict: What to Steal

### From Claude:
1. **The Ingestion Seam:** Adopt the `ingest()` core function immediately.
2. **The Artifact Pattern:** Keep point arrays out of Postgres; use `track.json` in object storage.
3. **RLS First:** Mandate Supabase RLS policies as the primary privacy enforcement.
4. **Brand Primitives:** Build the `AccentBar` and `SectionHeading` components as Phase 0 tasks.

### From Codex:
1. **Parser Versioning:** Include `parser_version` in the `flights` table to track derivation logic.
2. **License Tracking:** Include `source_url` and `license` in the `sites` table to ensure legal safety.
3. **Plain-Language Warnings:** Store `parse_warnings` as a JSONB column to communicate IGC issues to the pilot without failing the upload.
4. **Application-level Geo:** Start with Haversine/Bounding Box lookup to avoid PostGIS complexity until needed.

### Final Recommendation
The "Gemini" path should favor **Claude's architecture** (Supabase + RLS + track artifacts) but adopt **Codex's pragmatic data model** (parser versioning + licensed site fields). The single most critical addition for M1 should be a **synchronous-to-asynchronous transition plan** for the parser to prevent Vercel timeout issues on larger flights.
