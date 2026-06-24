# Sprint 002 Codex Critique: Claude Draft

## Strengths

- Correctly keeps the core architecture aligned with Leaf Log's existing seams: Postgres-owned files, a light metadata row plus heavy byte row, thin routes, app-layer privacy via `getFlightForViewer`, and pure placement logic under `lib/photos/`.
- Makes the right v1 storage call. Postgres with downscaled derivatives is the pragmatic choice here; object storage would add signed URLs, bucket policy, lifecycle, and delete consistency before there is evidence of photo volume.
- Separates photo metadata from image bytes, which protects list/gallery queries from accidentally dragging `bytea` through the flight page.
- Puts EXIF parsing and time-to-track matching in pure, unit-testable code. That is the right boundary for the most error-prone part of the feature.
- Explicitly requires authorizing image serve routes and EXIF stripping. That directly addresses the largest privacy failure modes for uploaded photos.
- Keeps 3D pins out of v1 and treats HEIC as a follow-up. That is the right instinct for scope control.
- The PR ordering is broadly workable: model and pure placement first, server core next, UI after, map pins last.

## Weaknesses

- The draft understates the feature by calling it "mostly assembly of proven seams." The hard parts are not just EXIF-to-UTC matching. The image pipeline, multipart memory behavior, privacy-safe byte serving, idempotent dedupe, MapLibre layer lifecycle, and mobile photo formats are all real failure surfaces.
- The supported input formats are inconsistent. The overview says owners select JPEGs, the core accepts `{jpeg, png}`, and the risk section says v1 accepts JPEG/PNG while HEIC is rejected. The sprint intent says JPEG upload only. PNG adds unclear EXIF behavior, orientation ambiguity, and more test surface without obvious product value.
- The data model is too thin in the wrong places and too speculative in others. It includes `caption?` and `sortIndex` even though captions/reordering are stretch, but omits useful v1 fields like `originalFilename`, per-variant dimensions/byte lengths, `altM`, `placementFailureReason`, stored EXIF local time/offset diagnostics, `updatedAt`, and a constrained enum for placement source.
- The serve-route shape `GET /api/photos/[photoId]/[variant]` can be made safe, but it is less defensive than nesting under the flight: `/api/flights/[id]/photos/[photoId]`. The nested route naturally verifies both parent visibility and `photo.flightId === id`, avoids direct photo ID routes as the primary contract, and makes wrong-flight photo fetches easy to test.
- The placement algorithm is under-specified around invalid GPS. It says EXIF GPS overrides timestamp placement, but does not require finite coordinates, range checks, or a flight-bounds sanity check. A stale phone GPS fix can pin a photo miles away even when timestamp interpolation would be correct.
- The timezone plan is directionally right but too casual. `utc = local - offset` is easy to get wrong in JavaScript if `DateTimeOriginal` is parsed through `new Date()` or server-local timezone rules. The draft should require parsing naive date/time components and constructing UTC from components. It also does not say what happens when `flight.localUtcOffsetMinutes` is null.
- The `OffsetTimeOriginal` policy needs a decision. Claude uses `utcOffsetMin ?? flight.localUtcOffsetMinutes`; the Codex draft made the better call by storing EXIF offset for diagnostics but preferring the flight offset for v1 consistency unless tests prove otherwise. Camera offsets are not always reliable, and the flight offset is derived from the actual flight context.
- Orientation handling is missing. Re-encoding strips EXIF, but unless `sharp.rotate()` is called before resizing, portrait photos can be stored sideways. Width/height fields must describe the post-rotation derivatives, not the raw file.
- Duplicate detection is too hand-wavy. "sha256 dedupe within the flight" needs a unique index or transactional check, otherwise concurrent uploads can insert duplicates. It should define whether the hash is over original bytes or sanitized display bytes. Exact-byte dedupe is useful, but it will not catch the same photo with metadata edits or different export settings.
- Large upload handling is not concrete enough. The draft mentions size/count caps and "stream/guard memory," but Next multipart parsing and `sharp` decode can still buffer significant memory. The plan should require strict batch caps, sequential or bounded-concurrency processing, zero-byte rejection, decoded-dimension limits, and partial-success semantics.
- The UI scope creeps. A lightbox and `caption?` appear in the draft while captions and richer viewing are supposed to be stretch/deferred. A basic gallery with authorized thumbnails is enough for v1.
- MapLibre integration is underspecified. A GeoJSON source/layer is the right primitive, but custom layers are wiped on `setStyle()`. The Codex draft made the better call by explicitly requiring photo source/layer re-add after basemap changes.

## Gaps In Risk Analysis

- EXIF timezone ambiguity is named, but not decomposed. Missing `OffsetTimeOriginal`, wrong device offset, daylight-saving boundaries, flights crossing timezone boundaries, null flight offset, camera clocks set wrong, and server-timezone leakage during parsing all need explicit handling or tests.
- HEIC is identified, but the user impact is understated. iPhones commonly produce HEIC by default, so v1 needs a clear rejection path, client `accept` hints, a useful per-file error, and at least one test/fixture proving HEIC does not crash the upload path.
- No risk entry covers orientation/rotation. This is common enough that it belongs in risk analysis, not as an implementation afterthought.
- No risk entry covers stale or bogus EXIF GPS. GPS should be validated against inflated flight bounds or nearest-route distance, then fall back to timestamp placement if invalid.
- No risk entry covers duplicate/idempotency races. Two tabs, retrying a failed request, or concurrent batch uploads can bypass an application-only dedupe check.
- No risk entry covers MapLibre marker performance or lifecycle. The draft uses a GeoJSON layer, which is good, but many pins may still need clustering/caps, and popup thumbnails should avoid loading many display images at once.
- No risk entry covers memory pressure from large uploads. File-size caps are necessary but not sufficient because decoded image dimensions and concurrent `sharp` work drive memory.
- No risk entry covers image bombs or malicious-but-valid payloads. The security section says validate MIME by content and re-encode, but the sprint should also cap decoded dimensions and handle `sharp` failures per file.
- No risk entry covers cache semantics after visibility changes. `Cache-Control: private` helps, but public/private toggles and direct image URLs need a conservative v1 caching policy.
- No risk entry covers partial batch behavior. One corrupt file should not roll back nine good files, but request-level invalidity should fail consistently.

## Missing Edge Cases

- EXIF time:
  - `DateTimeOriginal` parsed as server-local time by accident.
  - Missing `OffsetTimeOriginal` with valid flight offset.
  - Present but misleading `OffsetTimeOriginal`.
  - Null `flight.localUtcOffsetMinutes`.
  - Negative, zero, and positive UTC offsets.
  - Boundary timestamps exactly at takeoff and landing.
  - Timestamps before takeoff or after landing; do not clamp to endpoints.
  - Camera clock wrong by minutes/hours; leave unpinned rather than confidently wrong.
- EXIF GPS:
  - GPS lat/lon outside valid ranges or non-finite.
  - GPS point outside inflated flight bounds.
  - GPS present but timestamp absent.
  - GPS altitude present and usable.
  - GPS rejected, then timestamp fallback succeeds.
- Image input:
  - HEIC/HEIF upload rejected cleanly.
  - PNG decision resolved; preferably reject in v1.
  - Zero-byte file.
  - MIME mismatch between extension, browser content type, and sniffed type.
  - Very large pixel dimensions with modest byte size.
  - Corrupt JPEG that `exifr` or `sharp` cannot parse.
  - EXIF orientation values requiring rotation.
  - Re-encoded derivatives inspected to prove EXIF is absent.
- Storage and concurrency:
  - Same original uploaded twice in one batch.
  - Same original uploaded concurrently in two requests.
  - Per-flight cap reached mid-batch.
  - Delete while list or serve is in flight.
  - Flight deletion cascades both metadata and bytes.
- Authorization:
  - Anonymous/public viewer can list and fetch public-flight photos.
  - Anonymous and non-owner get `404` for private list and serve.
  - Public non-owner cannot upload or delete on someone else's public flight.
  - Photo ID from flight A cannot be fetched through flight B's route.
  - Delete route returns `404` rather than disclosing ownership/existence.
- Map/UI:
  - Basemap/style change after photos load re-adds the photo layer.
  - Many pinned photos do not create DOM marker churn.
  - Hover popup loads the thumbnail, not the display image.
  - Unpinned photos still appear in the gallery.
  - Owner sees useful unpinned status; non-owner does not need internal failure reasons.

## Definition Of Done Completeness

Claude's DoD covers the headline happy path, unpinned gallery behavior, basic privacy, unit tests, one e2e, and no new infrastructure. It is a solid start, but it is not complete enough for this feature's risk profile.

Missing DoD items:

- Uploaded photos are stored only as sanitized derivatives; no original bytes are retained.
- Served derivative bytes are verified to contain no EXIF metadata.
- Orientation is normalized and stored dimensions match the rendered derivatives.
- JPEG-only v1 scope is explicit, with HEIC/PNG rejection behavior tested.
- Upload/delete are owner-only; public non-owners cannot mutate photos.
- Public flight photos are listable/fetchable by anonymous viewers.
- Direct image serve route verifies parent flight visibility and flight/photo match.
- Dedupe is enforced transactionally, preferably with a unique constraint.
- Batch upload has partial-success behavior and per-file errors.
- File count, per-flight count, byte-size, and decoded-dimension caps are specified.
- Map photo layer survives basemap/style changes.
- Delete is included in DoD if the sprint includes a delete route.
- Full gates from `CLAUDE.md` are named: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm e2e`.

## Where The Codex Draft Made Better Calls

- JPEG-only v1 is cleaner than Claude's JPEG/PNG ambiguity.
- Codex's Prisma sketch has better operational metadata: per-variant dimensions and byte lengths, original filename, placement diagnostics, EXIF local/offset fields, and `updatedAt`.
- Codex explicitly defers captions, reordering, lightbox/fullscreen, originals, object storage, HEIC, and 3D pins. Claude lets lightbox and caption fields leak into v1.
- Codex requires `sharp.rotate()` and states not to call `withMetadata()`. Claude only says re-encode/strip, which misses the orientation trap.
- Codex requires parsing EXIF local datetime as naive components and gives a concrete UTC conversion example. Claude's formula is correct in spirit but not precise enough to prevent server-timezone bugs.
- Codex handles missing flight offset by leaving timestamp-only photos unpinned with a reason. Claude does not define that failure mode.
- Codex validates EXIF GPS against inflated flight bounds and falls back to timestamp placement. Claude trusts GPS too readily.
- Codex names concrete caps: 12 MB input, 10 files per batch, 40 photos per flight, 2048 px display, 420 px thumbnail. Claude leaves caps open, which weakens implementation and testing.
- Codex's nested read route is safer and easier to reason about than global `/api/photos/[photoId]/[variant]`.
- Codex explicitly tests wrong-flight photo access, served-byte EXIF absence, partial batch failure, anonymous public reads, and owner-only mutation.
- Codex calls out MapLibre style changes wiping custom layers. Claude omits that known local issue.

## Prioritized Changes For The Final Sprint

1. Lock v1 scope to JPEG upload only, sanitized display/thumb derivatives only, no originals, no captions, no reordering, no lightbox requirement, no 3D pins, no HEIC.
2. Use a stronger data model: metadata row plus byte row, per-variant dimensions/byte lengths, original filename, placement source/failure reason, EXIF diagnostics, optional `altM`, and a transactional unique dedupe key per flight.
3. Make EXIF time handling precise: parse naive local components, prefer `flight.localUtcOffsetMinutes` for v1, handle null offset as unpinned, and unit-test offsets/boundaries/out-of-window cases.
4. Normalize and harden image processing: sniff JPEG, reject zero-byte/corrupt/oversized/huge-dimension files, call `sharp.rotate()`, strip metadata, process with bounded concurrency, and return per-file results.
5. Use parent-scoped photo routes or otherwise require an explicit flight/photo match check on every list, serve, and delete path; all unauthorized/missing cases return `404`.
6. Validate GPS before trusting it. Use inflated flight bounds for v1 and fall back to timestamp interpolation when GPS is invalid.
7. Add concrete upload caps and make them part of DoD and tests: input size, batch count, per-flight count, display/thumb dimensions, and cache headers.
8. Require MapLibre photo layers to be re-added after style changes, and keep pins as a GeoJSON layer with thumbnail-only hover previews.
9. Expand DoD to include delete, public-read privacy, no-EXIF byte inspection, duplicate/concurrent upload protection, partial batch failure, orientation, HEIC rejection, and all `CLAUDE.md` validation gates.
