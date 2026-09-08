# XC scoring

Uploads and IGC reprocessing score valid original fixes between the detected takeoff and landing. No declared task or turnpoints are required. `igc-xc-score` (LGPL-3.0-or-later) runs in an isolated server worker using XContest rules and high-precision WGS84 distances.

- Open distance: start, at most three turnpoints, finish; 1 point/km.
- Free triangle: closing gap below 20%; 1.2 points/km (1.4 below 5%).
- FAI triangle: additionally each side is at least 28% of the perimeter; 1.4 points/km (1.6 below 5%).
- Triangle credited distance subtracts the closing gap. The highest points total wins, but the UI displays its actual credited distance, not points expressed as distance.

Each category gets a 1.5-second optimization slice. Results that are not proven optimal carry an approximation indicator. A 15-second worker limit and 256 MB JavaScript old-generation heap limit bound scoring (the heap limit is not a total-process memory cap). The worker reports partial results after each category; on timeout, completed categories are retained with an approximation indicator. No sampled or interpolated turnpoints are introduced. Saved JSON includes alternatives, turnpoints, timestamps, closure, rules version, and optimality.

Uploads save the flight and `xcStatus=queued` atomically, then return without waiting for scoring. Reprocessing also enqueues rather than starting workers directly. Node server instrumentation starts a background consumer; production builds do not start it. A PostgreSQL transaction advisory lock permits only one queue scorer across all instances sharing that database. Scoring holds one database connection for up to the 30-second transaction limit; other connections remain available to requests. The next worker starts only after the previous worker terminates. On server interruption the transaction rolls back, leaving the job queued for the next server start. The server must be running to drain jobs, including those queued by the CLI.

Successful jobs become `ready`; errors become `failed` with `xcError`, leaving the flight itself available. Reprocess a failed flight to retry. Existing unscored flights are not automatically backfilled. Visible logbook/feed/replay pages poll by refreshing server data every five seconds only while scores are pending, showing “Calculating…” without interrupting playback.

The logbook's green shading uses credited XC distance, falling back to the old takeoff/landing displacement for flights awaiting reprocessing. Existing flights can be updated with `pnpm db:reprocess-igc -- --all` (or `--flight-id <id>`).

References: https://www.xcontest.org/world/en/rules/ and https://github.com/mmomtchev/igc-xc-score
