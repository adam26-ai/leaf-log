# Unified sites: implementation and rollout

This is the first implementation of [the architecture proposal](site-architecture-proposal.md). It covers the shared Site model and editor, manual and CSV creation, IGC attachment, truthful location labels, provenance, import undo, and a previewable historical conversion.

## Decisions used

- One Site record, with a nullable coordinate pair. Adding a pin keeps its ID.
- Mapped/unmapped completeness; “Name only” only without location evidence.
- Automatically created sites are private. Publishing requires an explicit editor save.
- Import groups use a maximum pairwise diameter of 150 m for takeoff and 300 m for landing, separately from the existing 600/900 m matching radii.
- Existing public-site contributors can use the full editor, including pin and usage changes. Visibility remains owner-controlled.
- Ambiguity preserves source data and produces review rather than a guessed match.

## Main implementation boundaries

- `lib/sites/model.ts`: common draft validation shape and location-state helpers.
- `lib/sites/resolution.ts`: pure matching/grouping policy, shared by preview and commit.
- `lib/sites/editor.ts`: atomic full-site validation, authorization, version checks, limits, and audit.
- `components/flight/site-editor.tsx`: the full editor, also embedded as an unsaved draft in entry/import forms.
- `lib/logbook/locations.ts`: resolution orchestration, revision signatures, private site creation, enrichment receipts, and provenance.
- `lib/logbook/service.ts`: atomic entry/import writes and cautious site cleanup on undo.
- `lib/sites/migrate.ts`: explicit conversion of historical names, using the same policy and cache writer.

Database constraints prevent half-pins, out-of-range coordinates, public sites without pins, and boundaries without pins. The additive migration preserves existing endpoint coordinates and IDs. Flight positions and site pins are exported in distinct columns.

Cache-only name refreshes preserve flight edit timestamps. This prevents a shared-site rename from looking like a personal flight edit or incorrectly excluding a flight from import undo. Original location evidence is owner-only in flight-detail reads.

## Rollout

1. Review and apply the normal Prisma schema migration, then deploy the matching application build. Test migrations use isolated local schemas; they do not migrate the interactive or production logbook.
2. Preview historical conversion for one pilot:

   ```text
   node --import tsx scripts/migrate-site-locations.ts --owner=<pilot-id>
   ```

3. Inspect the counts for mapped, unmapped, reused, and review outcomes. Apply only that reviewed preview:

   ```text
   node --import tsx scripts/migrate-site-locations.ts --owner=<pilot-id> --apply --expected=<preview-signature>
   ```

4. The transaction refuses a changed preview. Rerunning after a successful conversion finds no remaining eligible endpoints. Existing IDs, cleared selections, measurements, and flight timestamps survive.
5. Inspect location-review cases through the ordinary full editor. Repeat the reviewed conversion per pilot as appropriate.

The historical conversion has not been run against the user's existing logbook. No production deployment is included in this change.

## Validation

- Full regression suite: 97 files, 812 tests passed.
- Eight browser scenarios passed against an isolated database and a production build: full site editing from CSV flights, standalone creation and visibility, site management and pagination, delayed loading, manual entry and IGC attachment, CSV review and undo, and logbook filters.
- Mobile screenshots were inspected for the full editor and site management; the browser checks also verify no horizontal overflow.
- Type checking, linting for changed source files, and patch whitespace checks passed.

## Remaining architecture work

These parts of the broader proposal remain separate follow-up work:

- Persistent confirmed aliases and richer site identity evidence.
- User-facing merge, split, archive, and personal-copy workflows with their own previews and undo.
- A dedicated grouped import-site review screen; the current preview lists proposed groups, with full editing through each flight's review form.
- Full public geometry revision history and a restoration interface; public edits currently retain the existing audit summary model.
- A scalable paginated global site directory and migration operator dashboard.

This first implementation does not make automatic historical reassignments or treat these remaining tools as prerequisites for editing a name-only site.
