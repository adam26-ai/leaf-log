import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const LINK_FILE = "/tmp/leaf-magic-link.txt";
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

test("sign up → upload → view → share → logged-out view", async ({ page, context }) => {
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
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles(IGC_PATH);

  // 5. Land on the flight page with real metrics. Sites are fully
  // community-driven (no curated seed), so a first-ever flight here reads
  // "Unknown site" until a pilot names it — that's the correct, honest state.
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  const flightUrl = page.url();
  await expect(page.getByText("Airtime")).toBeVisible();
  await expect(page.getByText("Max altitude")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unknown site" })).toBeVisible();

  // 6. Share it publicly via the visibility control (Private → Public).
  await page.getByRole("button", { name: "Public" }).click();
  await expect(page.getByRole("button", { name: "Public" })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 10_000 },
  );

  // 7. A logged-out visitor can see the now-public flight.
  const anon = await context.browser()!.newContext();
  const anonPage = await anon.newPage();
  const res = await anonPage.goto(flightUrl);
  expect(res?.status()).toBe(200);
  await expect(anonPage.getByText("Airtime")).toBeVisible();
  await anon.close();
});
