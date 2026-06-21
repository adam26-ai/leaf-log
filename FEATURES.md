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
