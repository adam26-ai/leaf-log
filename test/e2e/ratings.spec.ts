import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";

const LINK_FILE = "/tmp/leaf-magic-link.txt";

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

test("a signed-in pilot can open /ratings and see their P2/P3/P4 progress", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const email = `e2e_ratings_${suffix}@test.local`;
  const handle = `e2erate${suffix}`.slice(0, 18);
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
  await page.locator('input[name="display_name"]').fill("E2E Ratings Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  // 4. Navigate to /ratings via the nav link and confirm it renders cleanly.
  const res = await page.goto("/ratings");
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: /ratings progress/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /P2/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /P3/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /P4/ })).toBeVisible();
});
