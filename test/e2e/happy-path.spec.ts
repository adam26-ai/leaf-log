import { test, expect } from "./fixtures";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEV_MAGIC_LINK_FILE as LINK_FILE } from "@/lib/dev-magic-link";
import { expectSignedOutHeader, selectTrackDiagnosticRenderer, waitForMapReady } from "./helpers";

const IGC_PATH = process.env.E2E_IGC ?? join(process.cwd(), "test/e2e/.fixture.igc");

/** Poll the dev magic-link file written by sendMagicLink's dev fallback. */
async function getMagicLink(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    if (existsSync(LINK_FILE)) {
      const s = readFileSync(LINK_FILE, "utf8").trim();
      if (s.startsWith("http")) return s;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("magic link file never appeared");
}

test("sign up → upload → view → share → logged-out view", async ({ page, newContext }) => {
  const suffix = `${Date.now()}`;
  const email = `e2e_${suffix}@test.local`;
  const handle = `e2e${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

  // 1. Request a magic link.
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();

  // 2. Follow the magic link.
  const link = await getMagicLink();
  await page.goto(link);

  // 2b. "Keep me signed in?" interstitial (between the link and onboarding).
  await page.getByRole("button", { name: /keep me signed in/i }).click();

  // 3. Onboarding.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("E2E Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  // 4. Upload a flight.
  await page.goto("/upload", { waitUntil: "networkidle" });
  // Use the picker so the client has hydrated before dispatching a file change.
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(IGC_PATH);

  // 5. Land on the flight page with real metrics. Sites are fully
  // community-driven (no curated seed), so a first-ever flight here reads
  // "Site not identified" until a pilot names it — that's the correct, honest state.
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  const flightUrl = page.url();
  await expect(page.getByText("Airtime")).toBeVisible();
  await expect(page.getByText("Max altitude")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Site not identified" })).toBeVisible();

  // 6. Share through the real edit UI and wait for persistence.
  await page.goto(`${flightUrl}/edit`);
  await page.getByRole("button", { name: "Public", exact: true }).click();
  await expect(page.getByRole("button", { name: "Public", exact: true })).toHaveAttribute("aria-pressed", "true");

  // 7. A logged-out visitor can see the now-public flight.
  const anon = await newContext();
  const anonPage = await anon.newPage();
  const res = await anonPage.goto(`${flightUrl}?trackDebug=1`);
  expect(res?.status()).toBe(200);
  await expect(anonPage.getByText("Airtime")).toBeVisible();
  await expectSignedOutHeader(anonPage);
  // The server-rendered header can be visible while the replay's WebGL map is
  // still starting. Let its first frame finish before testing link navigation.
  await waitForMapReady(anonPage.locator(".flight-replay-map"));
  await expect(anonPage.locator(".flight-replay-map")).toHaveAttribute("data-track-renderer", "path2");
  await expect(anonPage.getByRole("group", { name: "Track renderer diagnostic" }).getByRole("button")).toHaveCount(3);
  await expect(anonPage.locator('[data-gpu-report="ready"]')).toBeAttached();
  await expect(anonPage.getByText("Device report", { exact: true })).toBeVisible();
  await selectTrackDiagnosticRenderer(anonPage, "256-point path", "path256");
  await selectTrackDiagnosticRenderer(anonPage, "Colored segments", "lines");
  await selectTrackDiagnosticRenderer(anonPage, "2-point path", "path2");
  const fallbackResponse = await anonPage.goto(`${flightUrl}?trackLineFallback=1`);
  expect(fallbackResponse?.status()).toBe(200);
  await waitForMapReady(anonPage.locator(".flight-replay-map"));
  await expect(anonPage.locator(".flight-replay-map")).toHaveAttribute("data-track-renderer", "line-fallback");
  await expect(anonPage.getByRole("group", { name: "Track renderer diagnostic" })).toHaveCount(0);
  const depthFallbackResponse = await anonPage.goto(`${flightUrl}?trackLineFallbackDepth=1`);
  expect(depthFallbackResponse?.status()).toBe(200);
  await waitForMapReady(anonPage.locator(".flight-replay-map"));
  await expect(anonPage.locator(".flight-replay-map")).toHaveAttribute("data-track-renderer", "line-fallback-depth");
  await expect(anonPage.getByRole("group", { name: "Track renderer diagnostic" })).toHaveCount(0);
  await anonPage.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(anonPage).toHaveURL(/\/sign-in/);
  await anon.close();
});

test("unfinished signup can switch email and sign out", async ({ page }) => {
  const suffix = Date.now();
  const wrongEmail = `wrong_${suffix}@test.local`;
  const rightEmail = `right_${suffix}@test.local`;

  rmSync(LINK_FILE, { force: true });
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(wrongEmail);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await getMagicLink());
  await expect(page.getByText(wrongEmail)).toBeVisible();
  await page.getByRole("button", { name: "Keep me signed in" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByText(wrongEmail)).toBeVisible();

  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/sign-in/);

  rmSync(LINK_FILE, { force: true });
  await page.getByPlaceholder("you@example.com").fill(rightEmail);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await page.goto(await getMagicLink());
  await page.getByRole("button", { name: "Just this time" }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByText(rightEmail)).toBeVisible();
  await expect(page.getByText(wrongEmail)).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/sign-in/);
});
