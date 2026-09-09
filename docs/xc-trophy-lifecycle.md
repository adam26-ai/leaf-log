# XC scoring and personal-best lifecycle

Implemented September 8, 2026.

## What the pilot sees

The logbook has one compact calculation notice above its filters. Calculate missing XC includes unscored, failed, unsupported and partially scored flights across the owner's entire logbook, including flights hidden by filters. Repair flight data handles outdated measurements separately. Neither action starts on page load.

Each flight has a small contextual action when needed. Replay XC uses the same two-line metric footprint in every state: completed scores have no status line, a small spinner sits beside saved distances during processing, and Calculate/Retry occupies the distance position when no score exists. The adjacent indicator (≈ for best-found scores) opens a popover with details and Improve/Complete/Retry actions; it overlays the map without moving it and dismisses on outside interaction or Escape. Waiting and running work refresh visible pages every five seconds. Missing original files stop with an explanation, without an endless retry button.

The trophy popup uses medal/category pills. XC awards are marked provisional when any flight has incomplete analysis; the logbook explains that rankings use scored flights and can change as processing finishes. Ranking always uses the full personal logbook, independently of filters and flight visibility.

Completed calculations, including best-found scores, leave no status line or empty status spacing beneath logbook rows. Best-found explanations and the optional Improve XC action remain available in the replay's XC popover.

## Scenarios

| Scenario | Behavior |
| --- | --- |
| New usable web upload or device push | Save measurements/artifacts and queue XC automatically, atomically. Duration, MSL altitude and gain from launch need no Calculate click. |
| Existing current measurements and completed XC | Use saved results immediately; recompute medal ranks on each logbook render. |
| Existing unscored or older-format XC | Calculate XC / Update XC individually, or Calculate missing XC for the backlog. Preserve valid saved candidates during scoring. |
| Legacy missing/outdated measurements or artifacts | Repair flight data rebuilds derived fields and artifacts from the original IGC, then scores XC. Preserve pilot-edited names, sites, wing and notes. Old scores are invalidated when repairing the underlying flight window. |
| Queued / running | Show Waiting / Calculating (or Repairing data). Queuing is owner-scoped and idempotent. Pages can be closed while the Node server continues processing. |
| Interrupted scoring | Retry XC; keep previous saved scores. User-facing failures explain the interruption without exposing internal errors. |
| Partial scoring | Save candidates and category coverage independently. Complete XC continues unchecked categories with a longer search budget. |
| All categories checked, nonoptimal candidates | Best found; valid distances count toward trophies. Improve XC runs a longer search and retains the better candidate per scoring rule. |
| Complete search without a route | No eligible route, with explanation. Insufficient GPS fixes are distinguished from a search with no eligible scoring route. An unresolved search with no candidate remains partial. |
| Missing original IGC | Unavailable with reason; no calculation/repair loop. Previously valid results remain readable. |
| Original has no usable GPS track | Unreadable / unavailable; no trophies fabricated. Legacy files can first be tried with the current parser through Repair. |
| Missing altitude in an otherwise usable track | Store missing altitude as null; exclude affected altitude awards, retain duration/XC, and explain unavailable launch altitude. |
| Identical file uploaded again by the same owner | Already uploaded · View flight links to the existing record. No automatic recomputation. |
| Different bytes representing the same flight | Still a separate upload. Deduplication is exact-byte/per-owner, not semantic. |
| Server restarts during work | Reclaim stale running leases after two minutes and retain job mode. Durable waiting jobs resume on startup. Long waits explain that processing resumes when the server is available. |
| Edit, deletion, newly completed score | Next logbook render recomputes medals from current data. Site/wing/name edits alone require no rescoring. |
| Future parser/scorer change | Bump metrics/scoring versions deliberately. A metrics version change offers Repair; a scoring version change offers Update XC. No unbounded automatic backfill on page load. |

## Storage and queue

- `metricsVersion = 1` and a persisted `launchAltM` identify current measurements. Migration reuses compatible parser-2 data with track/replay artifacts; other legacy rows remain repairable. New ingestion and CLI reprocessing write the same altitude/version fields.
- XC JSON retains the version-1 route format and adds `scoringVersion = 2`, `completedCategories`, `complete`, and `emptyReason`. This separates an absent triangle from a category not yet checked. Unsupported checkpoints are not reused.
- Each category includes all its XContest scoring-rule variants. Searches use original valid GPS fixes inside the detected airborne window, with worker memory/time bounds. Normal jobs allow 15 seconds total; completion/improvement can use 45 seconds. Category coverage means every rule was evaluated, not that every nonempty candidate is mathematically optimal.
- A short PostgreSQL advisory-locked transaction recovers stale leases and claims one job. It commits before parsing/scoring, making running status visible and avoiding a long scoring transaction. A running job blocks additional consumers across processes. Completion and repair writes require the same start-time lease, so an obsolete worker cannot overwrite a replacement job.
- Repair persists measurements and both artifacts atomically before scoring. A later XC failure does not discard the repaired measurements. Existing scores survive ordinary scoring retries; repairs intentionally invalidate scores tied to outdated measurements.

## Validation

Unit/component coverage checks classification, category checkpoints, preservation of better scores, owner-only and bulk actions, queue leases/recovery, repair behavior, missing originals, ranking coverage, and compact controls. A real PostgreSQL/worker integration test races consumers against a stale legacy repair and verifies saved artifacts, measurements, XC coverage and preserved pilot edits. Mobile/desktop browser checks cover layout, replay loading and access to bulk actions with the trophy filter enabled.
