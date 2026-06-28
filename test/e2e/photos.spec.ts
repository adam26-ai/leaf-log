import { test, expect } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const LINK_FILE = "/tmp/leaf-magic-link.txt";
const IGC_PATH = process.env.E2E_IGC ?? join(process.cwd(), "test/e2e/.fixture.igc");
const JPEG = join(process.cwd(), "test/photos/fixtures/exif-sample.jpg");
const HEIC = join(process.cwd(), "test/photos/fixtures/tiled-sample.heic");

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

test("owner uploads photos (incl. HEIC) → gallery thumbnails serve", async ({ page }) => {
  const suffix = `${Date.now()}`;
  rmSync(LINK_FILE, { force: true });

  // Sign in + onboard.
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(`photo_${suffix}@test.local`);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await page.goto(await getMagicLink());
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(`photo${suffix}`.slice(0, 18));
  await page.locator('input[name="display_name"]').fill("Photo Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  // Upload an IGC to get a flight.
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles(IGC_PATH);
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });

  // Upload photos: a JPEG and a tiled HEIC (exercises heic-convert in the route).
  await page.locator('input[type="file"]').setInputFiles([JPEG, HEIC]);

  // Two thumbnails appear in the gallery, both served (decoded) successfully.
  const thumbs = page.locator('img[src*="/photos/"]');
  await expect(thumbs).toHaveCount(2, { timeout: 30_000 });
  for (let i = 0; i < 2; i++) {
    await expect
      .poll(() => thumbs.nth(i).evaluate((img: HTMLImageElement) => img.naturalWidth), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
  }

  // The lightbox opens and the full image loads.
  await thumbs.first().click();
  const big = page.locator('img[src*="variant=display"]');
  await expect(big).toBeVisible();
  await expect
    .poll(() => big.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
});
