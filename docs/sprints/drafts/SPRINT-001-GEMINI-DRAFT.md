# Sprint 001: Milestone 1 — Logbook Foundation

## Overview
This sprint establishes the core multi-user platform for **Leaf Log**. We will build the "ingestion-to-presentation" pipeline: allowing pilots to sign up, upload IGC files, and view them on a polished, brand-aligned flight page. The focus is on a high-quality "vertical slice" that provides immediate value to individual pilots while laying the architectural groundwork for a future device-push API and community social features.

## Use Cases
- **Pilot Onboarding:** Create an account and set up a public profile.
- **Manual Ingestion:** Drag-and-drop an IGC file to upload.
- **Flight Processing:** Automatic server-side parsing, metric derivation, and site lookup.
- **Personal Logbook:** A private list of all flights with summary stats.
- **Flight Detail:** A beautiful view of a single flight (map + barograph + metrics).
- **Privacy Control:** Toggle flights between `private` (default) and `public`.
- **Public Sharing:** Visitors can view a pilot's public profile and public flights.

## Architecture

### Tech Stack Strategy (Solo Dev / High Velocity)
- **Framework:** **Next.js (App Router)** + **TypeScript**. Best-in-class DX for a solo dev; React Server Components (RSC) simplify data fetching; API routes provide the "clean seam" for future device-push.
- **Styling:** **Vanilla CSS + CSS Modules**. Provides the precision needed to hit the `DESIGN.md` "Leaf" aesthetic without the friction of Tailwind's utility-soup for custom branding.
- **Database:** **PostgreSQL** via **Supabase**. Built-in PostGIS support for site lookups and a robust, low-ops auth/storage solution.
- **Authentication:** **Supabase Auth**. Seamless integration with the DB and future device-auth patterns.
- **Object Storage:** **Supabase Storage**. S3-compatible, easy to use for raw IGC files.
- **Maps:** **MapLibre GL JS** + **Protomaps** (or Maptiler). Open-source focus, high performance for IGC tracks, and easier to keep "on-brand" than Google Maps.
- **Charts:** **Recharts**. Clean, React-native, and easy to style for the barograph.

### Data Flow Diagram (ASCII)
```text
[ Pilot ] --(Drag-drop IGC)--> [ Next.js Frontend ]
                                      |
                                [ Next.js API Route ]
                                      |
             +------------------------+------------------------+
             |                        |                        |
    [ Supabase Storage ]      [ Parsing Service ]      [ Supabase Auth ]
    (Raw .igc blob)           (Derive Metrics)         (Identity)
             |                        |
             +-----------+------------+
                         |
                 [ Supabase DB (PG) ]
                 (Flight, Pilot, Site)
                         |
        [ Next.js Page (RSC) ] --(Render)--> [ MapLibre / Recharts ]
```

### Data Model
- **Profiles:** `id (uuid, fk auth.users)`, `username`, `display_name`, `bio`, `avatar_url`.
- **Flights:** `id (uuid)`, `pilot_id (fk Profiles)`, `igc_path (storage key)`, `visibility (enum: private, public)`, `date`, `takeoff_time`, `duration_sec`, `max_alt_m`, `alt_gain_m`, `max_climb_ms`, `max_sink_ms`, `distance_km`, `site_id (fk Sites)`.
- **Tracks:** `flight_id (fk Flights)`, `points (jsonb: [[lat, lng, alt, time, baro], ...])`. Stored separately or as a large JSON column for fast map rendering.
- **Sites:** `id (uuid)`, `name`, `coords (geography: point)`, `type (takeoff/landing)`. Seeded from a curated set (e.g., ParaglidingEarth export).

## Implementation (Phased)

### Phase 1: Foundation & Auth (Runnable Vertical Slice: Logged-in State)
- **Files:** `layout.tsx`, `page.tsx` (Dashboard), `auth/` components, `lib/supabase.ts`.
- **Tasks:**
    - [ ] Initialize Next.js project with `DESIGN.md` CSS variables and Roboto fonts.
    - [ ] Configure Supabase project (Auth, DB, Storage).
    - [ ] Implement "Join the Leaf Community" signup/login page.
    - [ ] Create basic Pilot Dashboard (empty state).

### Phase 2: Ingestion & Parsing (Runnable Vertical Slice: Upload → List)
- **Files:** `components/UploadZone.tsx`, `api/ingest/route.ts`, `lib/igc-parser.ts`.
- **Tasks:**
    - [ ] Build drag-and-drop upload component.
    - [ ] Write `igc-parser.ts`: Robust, line-by-line B-record extraction (handling UTC rollover).
    - [ ] Implement Ingestion API: Receive file → Save to Storage → Parse → Save to DB.
    - [ ] Create "My Logbook" list view with basic summary cards.

### Phase 3: The Flight Page (The "Wow" Factor)
- **Files:** `flights/[id]/page.tsx`, `components/FlightMap.tsx`, `components/Barograph.tsx`.
- **Tasks:**
    - [ ] Implement `FlightMap` using MapLibre: 3px amber track line, takeoff/landing icons.
    - [ ] Implement `Barograph` using Recharts: Shaded area chart with "Leaf Green" accents.
    - [ ] Design Metric Tiles: Big, bold Roboto Condensed numbers with the amber 3px accent bar motif.
    - [ ] Implement Site Lookup: Simple nearest-neighbor PostGIS query against a seeded `Sites` table.

### Phase 4: Privacy & Public Profiles
- **Files:** `pilots/[username]/page.tsx`, `middleware.ts` (Privacy enforcement).
- **Tasks:**
    - [ ] Add `visibility` toggle to the flight detail page.
    - [ ] Build the Public Profile page: Only show `public` flights.
    - [ ] Ensure RLS (Row Level Security) in Supabase blocks unauthorized access to private IGC tracks.

## Files Summary
| Path | Responsibility |
|---|---|
| `app/globals.css` | Design tokens (amber, green, Roboto) and base resets. |
| `lib/igc-parser.ts` | The core "brain" — converts text to metrics/JSON tracks. |
| `app/api/ingest/route.ts` | The "clean seam" for web and future device-push. |
| `components/FlightMap.tsx` | High-performance MapLibre rendering of the track. |
| `supabase/seed.sql` | Initial site dataset and schema definitions. |

## Definition of Done
- A pilot can sign up and upload a valid IGC file.
- The flight page renders a map, barograph, and correct metrics (verified against reference tools).
- The site name is correctly identified for at least 3 major test sites.
- Private flights are invisible to logged-out users; public flights are visible.
- The UI matches the `DESIGN.md` specs (amber bars, Roboto Condensed, soft corners).
- **Zero** linting/type errors and unit tests pass for the parser.

## Risks & Mitigations
| Risk | Mitigation |
|---|---|
| IGC parsing edge cases (e.g. midnight rollover) | Use a suite of fixture IGCs; unit test the parser heavily. |
| Map tile costs | Start with Protomaps (self-hosted or cheap) or MapTiler free tier. |
| Site lookup accuracy | Use a curated takeoff dataset (e.g. ParaglidingEarth) + a 500m "snap" radius. |
| Performance with large tracks | Downsample tracks for the map/chart if points > 5000. |

## Security Considerations
- **Row Level Security (RLS):** Absolute requirement in Supabase to prevent "ID guessing" of private flights.
- **IGC Validation:** Sanitize file inputs; limit file size (e.g., 2MB) to prevent DoS via massive text files.
- **Auth:** Use secure HTTP-only cookies for session management (default in Supabase/Next.js).

## Dependencies
- `next`, `supabase/supabase-js`, `maplibre-gl`, `recharts`, `date-fns`, `lucide-react`.

## Open Questions Resolved
- **Stack:** Next.js + Supabase (Velocity + PostGIS + Integrated Auth).
- **Parsing:** Custom lightweight TS parser (allows specific Leaf-optimizations and zero external C-dependencies). Runs in the API route.
- **Site Lookup:** Seeded PostGIS table; nearest-neighbor search with a distance threshold.
- **Data Model:** Derived metrics in DB for fast listing; raw track in JSONB for rendering.
