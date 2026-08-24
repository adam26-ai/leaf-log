import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { makeIgc, type SynthFix } from "@/test/igc/make-igc";

const LINK_FILE = "/tmp/leaf-magic-link.txt";

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

async function signUp(page: Page, email: string, handle: string, displayName: string) {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  await page.goto(await getMagicLink());
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill(displayName);
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });
}

function remoteFlightIgc(lat: number, lon: number, seed: number): Buffer {
  const fixes: SynthFix[] = [];
  let t = 60000 + seed;
  let alt = 1200 + seed;
  for (let i = 0; i < 10; i++) {
    fixes.push({ tSec: t, lat, lon, baro: alt, gps: alt + 5 });
    t += 1;
  }
  for (let i = 0; i < 40; i++) {
    alt += 4;
    fixes.push({ tSec: t, lat, lon: lon + i * 0.00002, baro: alt, gps: alt + 5 });
    t += 1;
  }
  return Buffer.from(makeIgc({ glider: "Test Wing", fixes }));
}

test("SPRINT-007: a non-owner reaches, renames, and endorses a public site from someone else's flight", async ({
  page,
  browser,
}) => {
  const suffix = `${Date.now()}`;
  const aHandle = `commA${suffix}`.slice(0, 18);
  const bHandle = `commB${suffix}`.slice(0, 18);
  const cHandle = `commC${suffix}`.slice(0, 18);
  const lat = 33.0 + (Number(suffix) % 5000) * 0.001;
  const lon = -180.0 + 33.0;

  await signUp(page, `comm_a_${suffix}@test.local`, aHandle, "Community A");

  // Pilot A: upload, name the site PUBLIC, make the flight itself public.
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles({
    name: "comm-a.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(lat, lon, 1),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  const flightUrl = page.url();

  const siteName = `E2E Community Ridge ${suffix}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator('input[placeholder="e.g. North Launch"]').waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: /Skip.*just the site/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  await page.getByRole("button", { name: "Public" }).click();
  await expect(page.getByRole("button", { name: "Public" })).toHaveAttribute("aria-pressed", "true");

  // Pilot B: a completely separate context, viewing pilot A's public flight
  // — the label must be clickable even though this isn't B's own flight.
  const bContext = await browser.newContext();
  const bPage = await bContext.newPage();
  await signUp(bPage, `comm_b_${suffix}@test.local`, bHandle, "Community B");
  await bPage.goto(flightUrl);
  await expect(bPage.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  const newName = `${siteName} (renamed)`;
  await bPage.locator("h1 button").click();
  await expect(bPage.getByText("Public site — community owned")).toBeVisible({ timeout: 5_000 });
  await bPage.getByRole("button", { name: "Rename", exact: true }).click();
  const nameInput = bPage.locator("input[maxlength='60']");
  await nameInput.fill(newName);
  await bPage.getByRole("button", { name: "Save name" }).click();
  // The rename must be visible LIVE, with no reload — both the dialog's own
  // header and the underlying flight's h1 (via SiteNameControl's onRenamed
  // callback). A prior version of this dialog updated neither until reload.
  await expect(bPage.getByRole("button", { name: "Save name" })).not.toBeVisible({ timeout: 5_000 });
  await expect(bPage.locator("h2").getByText(newName, { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(bPage.getByRole("heading", { level: 1 })).toHaveText(newName, { timeout: 5_000 });
  await bPage.getByRole("button", { name: "Close", exact: true }).click();

  // Still true after a reload, and for pilot A too — whose own cached
  // flight-header name follows the same live site row.
  await bPage.reload();
  await expect(bPage.getByRole("heading", { level: 1 })).toHaveText(newName, { timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(newName, { timeout: 10_000 });

  // Pilot C endorses it — a third, independent viewer.
  const cContext = await browser.newContext();
  const cPage = await cContext.newPage();
  await signUp(cPage, `comm_c_${suffix}@test.local`, cHandle, "Community C");
  await cPage.goto(flightUrl);
  await expect(cPage.getByRole("heading", { level: 1 })).toHaveText(newName, { timeout: 10_000 });
  await cPage.locator("h1 button").click();
  await expect(cPage.getByText("0 endorsements")).toBeVisible({ timeout: 5_000 });
  await cPage.getByRole("button", { name: "Endorse", exact: true }).click();
  await expect(cPage.getByText("1 endorsement", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(cPage.getByRole("button", { name: /Endorsed/ })).toBeVisible();

  await cContext.close();
  await bContext.close();
});

test("SPRINT-007: the flight OWNER can also reach community info and endorse their own public site", async ({
  page,
}) => {
  // Clicking the h1 as the flight's own owner opens the bind-a-site flow
  // (NameSiteDialog), not the new community dialog directly — without a
  // dedicated entry point there, an owner would have no way to reach
  // contributors/history/endorse for their OWN site at all.
  const suffix = `${Date.now()}`;
  const handle = `commOwn${suffix}`.slice(0, 18);

  await signUp(page, `comm_owner_${suffix}@test.local`, handle, "Community Owner");
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles({
    name: "comm-owner.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(20.0 + (Number(suffix) % 5000) * 0.001, -175.0, 1),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });

  const siteName = `E2E Owner Community Ridge ${suffix}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator('input[placeholder="e.g. North Launch"]').waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: /Skip.*just the site/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });
  await page.getByRole("button", { name: "Public" }).click();
  await expect(page.getByRole("button", { name: "Public" })).toHaveAttribute("aria-pressed", "true");

  // Re-open — already-bound site jumps straight to the zone step, which
  // must offer a community entry point alongside "Edit site boundary".
  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Site contributors & endorsements" }).click();
  await expect(page.getByText("Public site — community owned")).toBeVisible({ timeout: 5_000 });

  await page.getByRole("button", { name: "Endorse", exact: true }).click();
  await expect(page.getByText("1 endorsement", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: /Endorsed/ })).toBeVisible();
});
