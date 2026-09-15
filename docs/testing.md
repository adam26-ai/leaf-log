# Testing and CI reliability

## Follow-up: PR 74, September 14, 2026

[Run 34898317777](https://github.com/adam26-ai/leaf-log/actions/runs/34898317777)
passed the gates job but failed two browser workflows after passing locally.
The downloaded report and traces show:

- Community: the third pilot's site dialog remained loading. Secondary contexts
  bypassed the upload helper's map routes: the second and third pilots requested
  78 and 37 live OpenFreeMap resources respectively. Server actions returned in
  tens of milliseconds while browser interactions took seconds.
- Photos: both thumbnail URLs returned HTTP 200, but the browser stalled during
  the image inspection. This was not evidence of a failed upload or photo API.
  The test also inspected lazy images without bringing the gallery into view.
- Local browser configuration only *allowed* SwiftShader; it could still select
  hardware acceleration. Local checks now explicitly select ANGLE/SwiftShader
  to exercise the same rendering path as CI.

All browser specs import `test` from `test/e2e/fixtures.ts`. It installs map data
fixtures at context creation, before navigation, for primary pages, popups and
secondary pilots. Use its `newContext` fixture for independent users; sessions
are closed even after failed assertions. Lint rejects direct test imports and
direct context creation in specs. Keep real authentication, uploads, database
access, MapLibre/deck.gl rendering, and terrain enabled.

Only third-party style and terrain requests have default fixtures. Place-search
tests provide their own geocoding responses using page routes. Unexpected
external HTTP requests are blocked and fail the test, with addresses in a
`browser-diagnostics` report attachment alongside failed requests, HTTP errors
and browser exceptions. The policy does not blanket-mock application endpoints
or treat expected authorization responses (such as 404) as test failures.

Photo checks scroll each lazy thumbnail into view, verify actual image decoding,
and open both the JPEG and HEIC in the lightbox. Rename permissions and endorsement
persistence are independent browser scenarios. Each signs in through the UI,
uses the authenticated upload API to ingest a real IGC, and seeds its initial
public site relationship in the isolated database. Rename, visibility denial,
endorsement and persistence checks all use the real UI and server actions.
Upload and site-creation UI are covered by the dedicated browser workflows.
Inactive pilot pages stay on the logbook instead of rendering extra replays.
Endorsements are checked after reload and by the owner.
Standalone site creation/visibility and flight auto-association are separate
scenarios as well, rather than sharing one deadline for unrelated workflows.
Boundary scenarios also arrange an existing uploaded flight and site before
exercising geometry. They retain the real editor gestures, validation, reloads,
saved-shape checks, and subsequent-flight association; site/zone scenarios cover
the complete site-creation UI. This avoids repeating unrelated creation steps
and renderer startup in every geometry regression.
Do not remove these checks or
disable WebGL to make a browser failure disappear.

The follow-up [run 34903108397](https://github.com/adam26-ai/leaf-log/actions/runs/34903108397)
passed photos but exposed six dialog failures with full GPU emulation. The first
failure reproduced in a two-CPU Linux container: server actions returned quickly
while ordinary browser assertions stalled. Disabling continuous trace screenshots
did not fix it. Selecting [Chromium's documented](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md) `swiftshader-webgl` fallback
instead of full `swiftshader` GPU emulation passed the same scenario with normal
tracing. Keep trace screenshots, DOM snapshots, network records and failure PNGs.
The new Linux check below makes this platform difference reproducible locally.
Playwright uses the `chromium` channel's full browser headless mode, matching
normal Chrome/Edge more closely than the separate headless shell. A later shell
trace showed the endorsement response finishing in 51 ms while the browser
failed to display it within five seconds; both community scenarios passed in
full Chromium with the same software WebGL and tracing. See
[Playwright's browser modes](https://playwright.dev/docs/browsers#chromium-new-headless-mode).
The community dialog also loads its map and summary in one server request and
returns the updated summary with an endorsement mutation. Next.js queues client
Server Actions, so separate reads created a waterfall around expensive map
startup. Component coverage checks pending state, the returned count, and failed
loads/mutations, while browser coverage verifies persistence across users.
Endorsement mutations do not invalidate logbook/feed pages: their counts are
read uncached by the dialog, so refreshing those page trees adds unnecessary
work to the mutation response. Renames still invalidate those pages because
their displayed site labels change.
Likewise, the flight site chooser loads the authorized creation draft with its
initial data. Opening the full editor does not start another queued read; saving
still validates the flight revision and authorization on the server. The delayed
lookup browser regression asserts that choosing and creating use a single read.

## Audit: September 13, 2026 (Pacific time)

The 25 most recent workflow runs contained 8 failures, all in Playwright; the
typecheck/lint/unit/integration/build job passed in every one of those failed runs.
The failures are concentrated in browser coverage, not a generally broken CI
service. Main passed throughout this sample, after follow-up fixes on PR branches.

| Run | Evidence |
| --- | --- |
| [PR 70](https://github.com/adam26-ai/leaf-log/actions/runs/34804030540) | 11 browser failures. Eight stop in the shared site-creation helper because it expects a visibility select, now replaced with pressed buttons. Another visibility assertion and two old site-row text assertions fail independently. Later interactions in those tests also needed updating. |
| [PR 69 initial run](https://github.com/adam26-ai/leaf-log/actions/runs/34784155599) | Nine failures after the site workflow changed: old naming actions and the old “Unknown site” label. The follow-up run passed. |
| [Site visibility](https://github.com/adam26-ai/leaf-log/actions/runs/34768474023) | Site dialog never becomes ready. A follow-up switched the test server from development mode to an isolated production build and passed. Keep that fix. |
| [Flight site experience](https://github.com/adam26-ai/leaf-log/actions/runs/34702592251) | Three waits for the site naming form expire. |
| [Import polish, first](https://github.com/adam26-ai/leaf-log/actions/runs/34643116114), [second](https://github.com/adam26-ai/leaf-log/actions/runs/34644870802) | Upload/navigation and stale UI assertions, then a boundary editor timeout. |
| [Import, earlier](https://github.com/adam26-ai/leaf-log/actions/runs/34460074102), [later](https://github.com/adam26-ai/leaf-log/actions/runs/34525249508) | Site dialog readiness/reopening failures. |

The current failures are deterministic test/UI drift, not justification for
retries or longer global timeouts. Logs alone cannot prove the precise cause of
every historical timeout. Development rebuilds, hydration and expensive WebGL
rendering are relevant to that history; the isolated production server and
hydration-aware controls already address part of it.

After correcting the stale selectors, the full local run exposed a product
regression: the flight header keyed its site control by the mutable site name,
so a server refresh after a community rename remounted it and dismissed the
dialog. The fix keeps the control mounted and reconciles refreshed names without
discarding dialog state. Component regression tests and the complete community
browser workflow cover this. A boundary drag check also mixed geographic distance
with a fixed pixel threshold; it now drags by a known screen distance and waits
for the marker to reach the pointer while asserting no extra vertex is inserted.

## Required pre-PR check

On Windows/macOS, run `pnpm check:linux` before submitting browser or CI changes.
This runs the required full `pnpm check` inside Linux; a second native run is not
required. It uses Docker's Playwright image matching the installed lockfile
version, Node from `.node-version`, Ubuntu 24.04 (matching CI), four CPUs, and its
own disposable PostgreSQL service. It copies tracked and non-ignored source
files including working edits, installs Linux dependencies, and runs the same
`pnpm check`. Local `.env.local`, databases and Windows dependencies are not
shared. Reports are retained in `test-results/linux-ci/<run-id>/`; containers
are removed on completion. `pnpm check:linux e2e` runs just the browser job while
iterating, and `pnpm check:linux gates` runs the other job. Docker must be running.
The container is pinned to CPUs 0–3, matching the standard Linux runner for this
[public repository](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
A CPU quota alone permits bursts across all host cores followed by throttling;
see [Docker's CPU resource controls](https://docs.docker.com/engine/containers/resource_constraints/).
SwiftShader also needs an explicit four-worker setting inside the disposable
container: its [CPU detection](https://github.com/google/marl/blob/main/src/thread.cpp)
uses the host's online CPU count rather than container affinity. Chromium reads
`SwiftShader.ini` beside its renderer library during startup. The Linux check
writes it there without touching the host's installed browsers.

1. Use `.node-version`, install with `pnpm install --frozen-lockfile`, start local
   PostgreSQL, and configure `.env.local` (see README).
2. Install Chromium with `pnpm exec playwright install chromium` (`--with-deps`
   on Linux when system libraries are missing).
   On Windows, stop the local development server before checking: Prisma client
   generation cannot replace a native engine DLL while the server has it open.
3. Run `pnpm check` after the final edits. This includes both CI jobs. Report the
   result and any checks not run; unit tests alone are not a full pass.
4. For shared UI changes, inspect the E2E helpers and all their callers. Use
   focused browser runs while iterating, then run the complete suite before
   submission. Mocked component tests do not validate the real browser workflow.

CI and the local check command use Node 24.14.0, generate Prisma explicitly,
reject `.only`, require the local database, and preserve failures. No retries
are configured. Each suite migrates and drops its own random schema, and runs
files serially because of the shared XC queue, magic-link file, and public sites.
Do not enable workers/sharding until those shared resources are isolated per
worker. Test setup, not a redundant migration of the public schema in CI, owns
the migration check. Do not run two browser suites simultaneously on port 3100.

## Browser assertions and diagnostics

- Shared site creation and visibility interactions live in `test/e2e/helpers.ts`.
  Assert both selected and unselected visibility states. For non-owners, attempt
  the change and check that visibility stays unchanged with the explanation.
- Locate site rows by site name within the Sites list, then assert the visibility
  icon's accessible label and flight count separately. Avoid matching a whole
  row's incidental text layout. Keep persistence and authorization assertions.
- Wait for observable UI readiness; avoid sleeps and direct hidden-input uploads
  before hydration. Keep production server isolation and software WebGL enabled.
- CI retains HTML reports, JUnit results, and failure traces/screenshots for seven
  days. Download the `playwright-report` artifact and open its report; the
  `vitest-report` artifact contains unit/integration results. Check the first
  failed assertion before changing timeouts. Job time limits stop hung runs.

The runtime mismatch (local Node 24 versus CI Node 20), missing HTML reporter,
and lack of a full pre-PR command were process gaps, not the direct cause of
PR 70's stale selectors. These changes make local verification reproducible and
failures easier to inspect. Required branch checks should stay enabled; weakening
them would conceal regressions rather than prevent failed submissions.
