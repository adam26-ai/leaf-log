# Testing and CI reliability

## Safari / WebKit context recovery

Set `LEAF_E2E_BROWSER=webkit` to select Playwright's Desktop Safari project;
Chromium remains the default. Install WebKit with `pnpm exec playwright install
webkit` (add `--with-deps` on Linux). With the local test database configured,
run these focused scenarios from PowerShell:

```powershell
$env:LEAF_E2E_BROWSER = "webkit"
pnpm exec playwright test map-context.spec.ts sites.spec.ts --grep "WebGL context loss|site map browses"
Remove-Item Env:LEAF_E2E_BROWSER
```

Playwright's WebKit is a useful Safari compatibility check, but Linux WebKit
does not reproduce macOS Safari's exact version or GPU driver. Verify the
affected Mac as well when investigating device-specific GPU failures.

The context-loss regressions use `WEBGL_lose_context` on the real MapLibre
canvas. Before the fixes, switching replay pilots failed with
`this.style.getLayer` and selecting a site failed with `this.style.getSource`,
because MapLibre clears its style during context loss. The scenarios select
pilots, map pins and list rows while the context is lost, then restore it and
check rendering and selection. The Sites scenario also checks raster tile
pixels, zoom and drag navigation. Only third-party tile data is a fixture;
it does not verify live tile-provider availability. The replay recreates its
deck.gl overlay after restoration, retaining the selected pilot and camera.
These checks establish recovery behavior, not why a particular GPU lost its
context.

One focused Linux WebKit run also failed the existing mobile-width assertion
immediately after resizing the Sites page; an isolated follow-up passed. The
scenario now attaches overflowing-element measurements if it repeats. This
intermittent assertion remains unresolved; keep its width check intact.

## Follow-up: PR 109 merge, October 6, 2026

The [PR run](https://github.com/adam26-ai/leaf-log/actions/runs/37497706178)
passed, but the [merge run](https://github.com/adam26-ai/leaf-log/actions/runs/37543102100)
again exhausted the replay context-loss scenario's budget before injection.
The Fixed preference loaded, but checking the friend avatar took 20.9 seconds
and clicking it took another 15 seconds. The loss helper started at 51.4 seconds;
its map lookup finished just before the deadline, without executing the loss
evaluation. The unbound-handle error appeared during timed-out teardown.

Inject real context loss immediately after initial map readiness and the saved
Fixed-camera assertion. Then click friend, owner and friend while the context
is lost, checking each selection before restoration. This preserves all avatar
selection assertions and adds the primary-to-friend transition during loss,
without spending the pre-loss budget entering Follow. Restore the real context
and retain the selected-friend, Follow-camera, rendering and page-error checks.
Authentication, uploads, friendship visibility and the renderer remain real;
no retries, skips or deadline increases are added.

The focused scenario then exposed a real MapLibre error during a native
mouseout event: terrain-coordinate drawing tried to read shaderPreludeCode
from the destroyed projection. Remove terrain through setTerrain(null) in a
capture-phase canvas context-loss listener, before MapLibre clears its style.
This leaves native coordinate events usable during loss; the existing restored
style initialization reinstalls terrain and the deck.gl overlay.
The shared loss helper explicitly moves the native pointer onto and off the
lost canvas, and injects loss/restoration without acquiring an element handle.
The final locator assertion checks Follow mode and selected friend together,
avoiding separate browser round trips during restoration's terrain rendering.

The final focused replay scenario passed in Linux Chromium (31.6 seconds) and
WebKit (17.8 seconds). A separate WebKit Sites check still failed: one run
reported an internal /friends prefetch access-control error before context
loss; an isolated run then failed the initial raster-pixel assertion, with
successful fixture tile responses but transparent GPU samples and a blank
canvas. These failures precede the loss helper and remain unresolved. Keep the
page-error and raster assertions intact; Chromium passed both focused scenarios.

## Follow-up: PR 108, October 6, 2026

[Run 37424828718](https://github.com/adam26-ai/leaf-log/actions/runs/37424828718)
passed the gates job and 47 browser scenarios, but the replay context-loss
scenario exhausted its 60-second budget before injecting loss. The trace shows
31.6 seconds for the initial friend takeoff avatar click and another 7.4 seconds
confirming selection. The loss helper started at 48.4 seconds, but its map lookup
stalled and its browser evaluation never ran. No page exceptions were recorded.
These stalls are consistent with Follow-camera software rendering; the trace
does not establish a renderer crash or a missing context-loss event.

Arrange the owner's saved Fixed-camera preference before opening the replay,
and assert it loads. Takeoff avatar clicks still enter Follow; assert that mode
and the selected friend after restoration. Keep authenticated uploads,
friends-only visibility, real avatar clicks, actual WebGL loss/restoration and
the selected-pilot assertions. No retries, skips or longer deadlines are added.

## Follow-up: PR 106, October 5, 2026

The merged [run 37400970638](https://github.com/adam26-ai/leaf-log/actions/runs/37400970638)
passed both jobs and all 45 browser scenarios. Its preceding
[PR run](https://github.com/adam26-ai/leaf-log/actions/runs/37400852428)
failed the profile-drag assertion: the trace's attribute read returned playback
time 74 after 5.32 seconds, beyond the five-second `expect.poll` deadline.
The same failure occurred after PR 105. Use locator assertions for the initial
nonzero value and subsequent change, then retain the numeric forward-movement
check and the release check. Keep real pointer capture and map rendering.

The [PR 105 merge run](https://github.com/adam26-ai/leaf-log/actions/runs/37334469829)
also exhausted the upload/edit scenario while waiting for Tandem on the editor.
The trace remained on the replay page after clicking Edit flight, despite a
successful editor response. Wait for the replay's first render before clicking
and assert the editor URL before changing flight types. Persistence, duplicate
handling and ratings-field synchronization assertions remain in that workflow.

Hosted CI and the disposable Linux check use `scripts/configure-swiftshader.mjs`
to set four software-renderer workers beside Chromium's renderer libraries.
This removes a configuration difference; the traces establish browser stalls,
but do not prove renderer worker count caused them. No retries, skips or longer
deadlines are added.

## Follow-up: PR 105, October 5, 2026

[Run 37275688301](https://github.com/adam26-ai/leaf-log/actions/runs/37275688301)
failed in two independent places. Type checking, lint, and 970 tests passed;
the production build failed resolving Roboto Condensed through Turbopack's
Google-font import mapping (`next/font/google queries have exactly one entry`).
The app now bundles the three Roboto families with their upstream licenses and
uses `next/font/local`, so builds do not depend on Google's generated CSS.

Both drag browser scenarios exhausted their deadlines while opening the camera
menu, before their drag assertions. The trace includes a 12-second hover stability
wait and then a stalled Fixed-button lookup. Arrange the existing saved Fixed
camera preference in the isolated database before navigating, and assert that
the UI loaded it. These tests measure drag ownership; menu interactions belong
in camera-control coverage. Keep the real renderer, terrain, authentication,
uploaded flight, and drag assertions. Do not increase deadlines or add retries.

## Follow-up: PR 97, September 20, 2026

[Run 35497196270](https://github.com/adam26-ai/leaf-log/actions/runs/35497196270)
passed 34 browser scenarios but exhausted the happy-path test's 60-second budget.
The trace and failure snapshot show the public Sign in link present; the final
click was cancelled as the test timed out, not rejected by a changed selector.
That scenario also exercised the GPU canary, three diagnostic renderers, and a
second replay load with forced depth fallback after signup/upload/sharing.
Renderer diagnostics and forced fallback now have independent scenarios with
real authenticated IGC ingestion and an arranged public flight. Each uses a fresh
anonymous context and retains the real WebGL pipeline and all renderer assertions.
The happy path still covers UI signup, upload, sharing, public replay readiness,
and Sign in navigation. The fallback scenario also retains its navigation check.
No retries, skips, or longer deadlines were added.

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
Endorsements are checked after reload and by the owner in separate scenarios.
The owner view waits for the replay and existing site map to finish their first
render before opening community details; its endorsement is arranged from a
different profile in the isolated database. The dialog paints the community
summary before mounting its area map, so WebGL startup cannot hold up the first
count display. The mutation/reload scenario still uses a second signed-in pilot
and the real endorsement action.
The logged-out happy-path check also waits for the replay's first rendered frame
before clicking the sign-in link. A Linux trace showed the link was visible and
its route returned HTTP 200, yet clicking during map startup left the flight
page in place beyond the assertion window.
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
The next hosted [run](https://github.com/adam26-ai/leaf-log/actions/runs/34914960772)
passed 30 scenarios but exposed a remaining readiness race in endorsement:
the action response completed in 37 ms while map startup delayed its display.
The endorsement workflow now waits for actual replay and site-map rendering
before interacting. `waitForMapReady` uses the maps' `data-render-ready` signal,
set by MapLibre's idle event after terrain/overlay initialization, within the
existing test deadline. A hydrated heading or a visible map control does not
mean WebGL has rendered its first frame. This adds no sleep, retry, or timeout.
The following hosted [run](https://github.com/adam26-ai/leaf-log/actions/runs/34916637807)
passed community but exposed flight-type save feedback disappearing on refresh.
The server tree keyed the editor by mutable flags, remounting it as soon as the
saved flags arrived. It now keys by flight identity and reconciles changed
server values without discarding success feedback or unrelated unsaved edits.
The component regression renders and refreshes the actual server section tree
so reintroducing a mutable key is caught before browser CI.
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

## When to run tests

- During ordinary code changes and local preview iteration, do not run the full
  suite unless explicitly requested. Use focused tests or lightweight checks
  relevant to the change when useful. This includes work on a branch with an
  existing PR; local edits alone are not a PR update request.
- Before a commit, ask whether tests should run and whether the user wants
  focused tests or the full suite. Honor an answer already given for that commit.
- When submitting or updating a PR, run the full suite by default after the final
  edits. A combined commit-and-PR request uses this default without an additional
  testing question. If the user explicitly asks to skip tests, honor that request
  and disclose the missing validation in the PR.
- Full-suite commands are for explicit requests and PR submission, not each small
  change: `pnpm check`, `pnpm check:linux`, unfiltered `pnpm test`, and the entire
  browser suite. Report only checks actually completed.

## Default pre-PR check

On Windows/macOS, run `pnpm check:linux` before submitting browser or CI changes.
This runs the full `pnpm check` inside Linux; a second native run is not
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

For flight-track rendering reports, open a flight with `?trackDebug=1`, expand
**Device report**, and use **Copy diagnostics**. The report includes the
production-path canary result, its stock-line control and production pixel
counts, whether the result came from the live test or session cache, and the
automatic renderer decision. `?trackLineFallbackDepth=1` forces the fallback;
`?trackLineFallbackDepth=0` forces production. These overrides skip the canary
and are intended only for comparison and recovery.

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
