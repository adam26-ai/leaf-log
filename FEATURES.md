# Feature Ideas

Track potential feature ideas for future sprints.

## Short Flight URL IDs
- **Area:** Routing / data model (flight identifiers)
- **Description:** Replace the long cuid flight identifiers in URLs (`/flights/<id>`)
  with compact short ids of **no more than 4 characters** (`[a-z0-9]`) so flight links
  are short, clean, and easy to share. Applies to URL-visible entities — Flight today;
  profiles are already addressed by `@handle` and other models can stay on cuid.
- **Priority:** Medium
- **Notes:** avionics-planner does exactly this via a Prisma `$extends` create/upsert/
  createMany interceptor that injects a 4-char id when none is supplied, retrying on a
  P2002 collision up to 5× (caller-supplied id always wins). Space is 36^4 ≈ 1.68M, so
  collisions are effectively nil at this scale. Keep `@default(cuid())` in the schema so
  `prisma db push`/migrations still work and override at the JS layer. Only `Flight` needs
  it (FlightData is keyed by the flight FK). Decide whether to backfill existing flights
  (avionics rewrote long cuids in a maintenance-mode script) or accept that old long-id
  bookmarks 404 — fine at this early stage.

## 3D Flight Visualization
- **Area:** Flight detail page (flight viz)
- **Description:** Let pilots view a flight in 3D, not just the current 2D map track. So
  much of paragliding is vertical — thermalling, climbs, glides — and a 3D replay of the
  track conveys the altitude story far better than a flat line plus a separate barograph.
- **Priority:** Medium
- **Notes:** The track artifact already stores per-fix lon/lat + altitude, so the data is
  there (may want a richer/less-downsampled series for smooth 3D). Options: MapLibre GL
  globe/terrain with an elevated line + extrusions, deck.gl (`TripsLayer`/`PathLayer` with
  elevation), or CesiumJS for true terrain-draped 3D (heavier). Consider an animated replay
  with a time scrubber and climb/sink coloring. Sits alongside, not replacing, the 2D map +
  barograph. Related: VISION.md lists "3D replay" as a deferred later-milestone item.

## Selectable Map Layers (incl. Satellite)
- **Area:** Flight detail page (2D map + 3D replay basemap)
- **Description:** Let pilots switch the basemap between styles — at minimum a
  **satellite/aerial imagery** view alongside the current monochrome map, and ideally
  others (terrain/topo, streets). Satellite especially helps relate a flight to the real
  landscape (ridges, LZs, terrain features).
- **Priority:** Medium
- **Notes:** A small layer switcher control on the flight map / 3D replay. The current
  basemap is keyless OpenFreeMap "positron" (`components/flight/map-style.ts`); satellite
  imagery generally needs a tile provider — keyless-ish options include Esri World Imagery
  (attribution required) or a MapTiler/Mapbox satellite style (`NEXT_PUBLIC_MAPTILER_KEY`
  already scaffolded). Should apply to both the 2D map and the 3D replay (the 3D view drapes
  the basemap over terrain, so satellite-over-terrain would look great). Persist the choice
  (localStorage) so it sticks across flights.

## Linked Hover: Barograph ↔ Map
- **Area:** Flight detail page (barograph + 2D map / 3D replay)
- **Description:** Sync a cursor between the altitude profile (barograph) and the map.
  Hovering a point on the barograph highlights the matching location on the currently
  viewed map (2D or 3D), and hovering a point on the map track highlights the matching
  point on the barograph. Bidirectional and time-synchronized.
- **Priority:** Medium
- **Notes:** Lift a shared "active time" (or sample index) into the `FlightViz` parent so
  both children read/write it (`components/flight/flight-viz.tsx`, `barograph.tsx`,
  `track-map.tsx`, `flight-replay-3d.tsx`). Recharts exposes hover via `onMouseMove`
  (activeLabel/tooltip); MapLibre/deck.gl via nearest-sample to the hovered lng/lat (deck
  `onHover`/`pickObject`). Render a marker at the active time on the map (reuse the 3D
  glider / a 2D dot) and a reference cursor on the barograph. The 3D replay already tracks a
  current time, so this generalizes that to hover-driven scrubbing.

## Live Instrument Readout at Selected Point
- **Area:** Flight detail page (active-point readout)
- **Description:** Show live flight-instrument readings for the point currently selected or
  hovered in the map / profile view — like a mini instrument panel. Similar to the summary
  metric tiles at the top, but instead of whole-flight stats it shows the values at that
  instant: altitude, climb/sink (vario), ground speed, time, and coordinates.
- **Priority:** Medium
- **Notes:** Driven by the same shared "active time"/sample index as [Linked Hover:
  Barograph ↔ Map]. The data is already available — the replay path
  (`/api/flights/[id]/replay`, `lib/igc/replay.ts`) has per-sample `alt`, `t`, and `vario`;
  derive ground speed from consecutive sample positions/time. Render a compact readout
  panel/overlay near the map (mirror the metric-tile styling) that updates on hover and
  during 3D playback. While playing the replay it doubles as a live instrument display.
