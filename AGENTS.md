<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Testing before PR submission

- Run `pnpm check` after the final code/test edits before submitting or updating a
  PR. It runs both CI jobs using `.node-version`; `pnpm test` alone excludes browser
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
