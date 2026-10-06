<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Testing workflow

- **Code changes and local previews:** Do not run the full test suite by default.
  Use only focused tests or lightweight checks relevant to the change, when
  useful. Do not run `pnpm check`, `pnpm check:linux`, unfiltered `pnpm test`, or
  the entire browser suite during ordinary iteration unless the user explicitly
  requests it. An existing PR does not turn every local edit into a PR submission.
- **Commits:** Before committing, ask whether the user wants tests run and, if
  so, whether they want focused tests or the full suite. Do not start tests just
  because a commit was requested. Honor an answer already given for that commit.
- **PR submission or update:** Default to running the full suite after the final
  code/test edits and before submitting or updating the PR. This also applies
  when the request combines committing with PR submission; no separate testing
  confirmation is needed unless the user's instructions are unclear. Honor an
  explicit request to skip tests and disclose the missing validation in the PR.
- For the full suite, run `pnpm check`. It runs both CI jobs using `.node-version`;
  `pnpm test` alone excludes browser
  coverage. If a prerequisite prevents completion, explicitly report the missing
  checks rather than claiming a full pass.
- On Windows/macOS, use `pnpm check:linux` for the full check above when changing
  browser tests or CI. It runs `pnpm check` in Linux with disposable Docker
  services and the renderer's CPU budget; a Windows browser pass alone has
  missed CI failures.
- For shared UI changes, update `test/e2e/helpers.ts` and inspect all callers as
  well as component tests. Preserve behavior, persistence, and authorization
  assertions when changing locators.
- Diagnose the first failed assertion using the Playwright report/trace. Do not
  add retries, skips, or longer timeouts to hide deterministic failures.
- See `docs/testing.md` for database isolation, local setup, and the CI audit.

## Pull request submission

- When the user requests a pull request, push the branch and create or update the
  pull request without asking for an additional confirmation. Prefer GitHub CLI
  over browser automation.
