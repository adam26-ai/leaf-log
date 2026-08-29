# Bugs

Track known bugs to fix later.

## New Site Overview Shows Topography, Not Editable Satellite View
- **Page/Area:** Flight page site-naming dialog (`components/flight/name-site-dialog.tsx`) —
  the site-overview step shown when you reopen a flight to view a site you just defined
- **Description:** Right after defining a new site, reopening it should let you immediately
  see satellite imagery and draw/adjust its boundary. Instead it lands on a read-only
  overview map rendered in a topographic/monochrome style, with no editing controls at all —
  reaching the satellite view and boundary editor takes one more click.
- **Steps to reproduce:** 1. Upload a flight whose takeoff lands at an unmatched location.
  2. Name it as a new site (public or private). 3. Reopen the flight and click the site name
  again. 4. Observe the overview map.
- **Expected:** The map shown right after defining/reopening a new site uses satellite
  imagery and offers the boundary-editing interface directly, with no extra click.
- **Actual:** The overview map (`SiteAreaMap`) is hardcoded to the monochrome basemap and is
  read-only by design — its own docstring says "No editing affordance of any kind; that's
  the boundary editor's job, reached separately via 'Edit boundary.'" Only after clicking
  through to `SiteEditStep` does the pilot reach `BoundaryEditor`, which already defaults to
  `styleFor("satellite")` and lets you draw the shape.
- **Root cause:** `components/flight/site-area-map.tsx` line 79 hardcodes
  `style: styleFor("monochrome")` instead of `styleFor("satellite")`, and the component is
  intentionally read-only — `NameSiteDialog`'s step machine (`site-overview` → `site-edit`)
  requires an extra step to reach `components/flight/boundary-editor.tsx`, which is where the
  actual satellite + edit experience already lives.
