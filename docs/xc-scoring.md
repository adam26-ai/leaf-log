# XC scoring

Uploads and IGC reprocessing score valid original fixes between the detected takeoff and landing. No declared task or turnpoints are required. `igc-xc-score` (LGPL-3.0-or-later) runs in an isolated server worker using XContest rules and high-precision WGS84 distances.

- Open distance: start, at most three turnpoints, finish; 1 point/km.
- Free triangle: closing gap below 20%; 1.2 points/km (1.4 below 5%).
- FAI triangle: additionally each side is at least 28% of the perimeter; 1.4 points/km (1.6 below 5%).
- Triangle credited distance subtracts the closing gap. The highest points total wins, but the UI displays its actual credited distance, not points expressed as distance.

Each category gets a 1.5-second optimization slice. Results that are not proven optimal carry an approximation indicator. A 15-second worker limit and memory limit protect uploads; failure leaves XC unavailable with a warning rather than rejecting the flight. No sampled or interpolated turnpoints are introduced. Saved JSON includes alternatives, turnpoints, timestamps, closure, rules version, and optimality.

The logbook's green shading uses credited XC distance, falling back to the old takeoff/landing displacement for flights awaiting reprocessing. Existing flights can be updated with `pnpm db:reprocess-igc -- --all` (or `--flight-id <id>`).

References: https://www.xcontest.org/world/en/rules/ and https://github.com/mmomtchev/igc-xc-score
