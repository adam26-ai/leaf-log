# Manual flights and CSV logbook import

Pilots can use **Add flight** for an IGC upload or one manual entry. **Settings → Logbook → Import an existing logbook** offers a CSV template, example, import review, and import history.

Use one CSV row per flight. Date is required; other values can remain blank. Unknown duration still counts as a flight but adds no airtime, and the logbook identifies incomplete airtime totals. Reported XC distance needs a category: Open distance, FAI triangle, or Free triangle. It participates in personal bests for that category and carries a “reported” label. It does not create XC points or route geometry.

The template uses YYYY-MM-DD dates and durations in minutes. Import can also interpret numeric month/day/year or day/month/year dates, decimal hours, seconds, and hours:minutes[:seconds]. Altitude, distance, and vertical speed have explicit unit choices, with optional per-row unit columns. Altitudes are above mean sea level. A takeoff time requires a time zone or UTC offset; ambiguous daylight-saving times require an explicit offset. Date-only entries never acquire a fabricated midnight takeoff.

The optional `total_climbs` column is the sum of all altitude gained during the flight, in the chosen altitude unit. Leave it blank if unknown. Older templates using `height_gained` are still accepted.

Review happens before saving:

1. Choose a CSV (comma, semicolon, or tab separated; up to 5,000 flights and 2 MB).
2. Match columns and confirm date, duration, and unit interpretation.
3. Normalize wing and site names across incoming rows. Existing logbook names and the shared site directory are not renamed. Select a known site to use its coordinates, or add coordinates to individual entries. Unmatched names are not geocoded automatically.
4. Edit or skip rows and review possible duplicates. Optional blanks are warnings. Invalid values and unacknowledged duplicates block the selected rows from importing. Select visibility (private by default) and confirm the final summary.

Imports save atomically. Retries use a request ID, and an already-imported file is recognized by its content hash. A receipt tracks the batch and original update timestamps. Undo removes unchanged entries, retaining flights with edits, attached recordings, photos, kudos, or instructor activity. Individual flights can always be removed through their normal edit page.

## Exporting a logbook

**Export logbook** is available on the logbook page and in **Settings → Logbook**. Choose **Download CSV** for all of the signed-in pilot's flights, including manual/imported entries, private flights, and flights still processing or failed. Current logbook filters do not limit exports.

The UTF-8 CSV uses the import template's columns and explicit metric units, plus flight IDs, visibility/source/status, UTC timestamps, exact duration in seconds, track/straight distances, recorded XC results, and flight/launch tags. Reported XC remains separate from recorded XC. Unknown values stay blank. Spreadsheet formula prefixes in text fields are escaped with an apostrophe. CSV import limits still apply when reimporting an export; export-only columns are ignored by the importer.

The `igc_filename` column matches the filename inside **Download IGC ZIP** and individual IGC downloads. Names use the flight's local date and unique ID, because original upload filenames are not stored. Flights without stored recordings have a blank filename and are omitted from the ZIP. Original bytes, including recorder signatures, are preserved even for unreadable flights. An empty logbook produces a header-only CSV and an empty ZIP. Downloads are private, uncached, and streamed; recordings are loaded one at a time.

## Recorded and unrecorded flights

`Flight.recordingKind` distinguishes `igc` from `logbook`; `source` separately records web upload, device push, manual entry, or CSV import. Existing flights remain `igc`. Logbook entries have no `FlightData`, no IGC hash, and `xcStatus: not_recorded`. Ready entries participate in totals and personal bests. Replay companions, background scoring, replay generation, and bulk IGC reprocessing exclude unrecorded entries.

Pilot identity always comes from the owning Leaf Log profile. The optional pilot name in an IGC is read-only recording information, shown in the edit page's collapsed Recording details section alongside recorder and original wing information. Missing names are omitted. The old `Flight.pilot` value is retained as metadata; if it differs from the original file, Recording details shows it as a previously saved label. Wing edits never change this label or the raw IGC. Manual/CSV forms have no pilot field.

The flight detail page displays entered metrics, notes, photos, and a site map when coordinates are known. It has no playback controls. Private sites use the same name authorization as recorded flights; a private site's approximate map anchor is hidden from viewers without access.

Owners can edit manual/imported fields or attach an IGC from the edit page. Attachment compares the entered and recorded measurements first, then updates the same flight ID after checking its revision and the file hash. Recorded metrics and endpoint coordinates replace entered measurements; notes, photos, visibility, chosen site names, wing, and reported XC remain. Blank wings/sites may be filled from the recording. The raw bytes are preserved and XC analysis is queued. Reattaching the same file is idempotent; another flight's existing IGC cannot be attached again for that pilot.

The database migration is additive apart from making `igcSha256` nullable. Deploy the migration before deploying the application. Unit/integration tests use an isolated local schema, and browser tests use their own server and schema.
