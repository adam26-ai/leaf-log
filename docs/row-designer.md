# Flight row designer

With the local development server running, open `/dev/row-designer`.
This development-only workshop uses synthetic flight content and Leaf Log's
avatar, friend badge and trophy components. It does not modify actual flights
or apply settings to the Feed or Logbook. Production returns 404 for this route.

1. Choose the Feed or Logbook draft. Each is saved separately in this browser.
2. Set the simulated row width with the slider, input or common-width buttons.
   The preview preserves that exact width; scroll horizontally if it exceeds
   the available window. Compare mode renders three widths with the same recipe.
3. Allocate columns in pixels, percentage of the inner row width, or flexible
   shares of remaining space. Set minimum widths, gaps and hide thresholds.
   Hidden or absent columns release their width and gaps. Fixed allocations are
   not silently shrunk; an over-budget layout is reported.
   Avatar and Pilot stay outside the colored flight card. Their widths, gaps and
   thresholds still count toward the whole row. Side padding applies to the
   colored card; columns can be reordered within the identity or flight group.
4. Click a column's name or preview to edit its individual elements. Change font
   or icon size, top spacing, alignment, arrangement and individual hide thresholds.
   Date & time also offers **Two lines: date / time & duration**: Day & Date
   above Time · Duration, with an adjustable gap between the two lines.
   Use the arrows to reorder columns. Drag a divider or use its arrow keys to set
   a pixel width (Shift changes the keyboard step from 1 to 10 pixels).
5. Test long names, absent friends, and zero through three trophies. A hide
   threshold is measured against the whole row, including pilot and kudos.
   Zero means never hide; the element remains visible at the threshold itself.
6. Export JSON to retain or share a recipe. Paste exported JSON and import it to
   replace the selected draft. Reset restores only that draft's starting values.

Starting drafts intentionally show every available element without automatic
hide thresholds. The Logbook draft starts with pilot and kudos columns disabled.
These are design starting points, not exact copies of the current live layouts.
Use the exported recipe as the specification for subsequent list implementation.

The reusable layout calculation and recipe validation live in `lib/row-design.ts`.
Only focused model tests, type checking, lint and local interactive checks are
needed while iterating on this tool; follow `AGENTS.md` for commit/PR testing.
