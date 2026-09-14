import { createSiteFromFlight, expectSiteVisibility, uploadFlight } from "./helpers";
import { test, expect, type Page } from "./fixtures";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { makeIgc, type SynthFix } from "@/test/igc/make-igc";

import { DEV_MAGIC_LINK_FILE as LINK_FILE } from "@/lib/dev-magic-link";

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

async function createPublicFlight(page: Page) {
  const suffix = String(Date.now());
  const aHandle = `commA${suffix}`.slice(0, 18);
  const lat = 33.0 + (Number(suffix) % 5000) * 0.001;
  const lon = -147;
  await signUp(page, `comm_a_${suffix}@test.local`, aHandle, "Community A");
  // Set up each scenario through the real owner workflow.
  await page.goto("/upload");
  await uploadFlight(page, {
    name: "comm-a.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(lat, lon, 1),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  const flightUrl = page.url();

  const siteName = `E2E Community Ridge ${suffix}`;
  await createSiteFromFlight(page, siteName, "public");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  await page.goto(`${flightUrl}/edit`);
  await page.getByRole("button", { name: "Public", exact: true }).click();
  await expect(page.getByRole("button", { name: "Public", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto(flightUrl);

  return { suffix, flightUrl, siteName };
}

test("a non-owner renames a public site while visibility remains owner-only", async ({ page, newContext }) => {
  const { suffix, flightUrl, siteName } = await createPublicFlight(page);
  const bHandle = `commB${suffix}`.slice(0, 18);
  // Pilot B: a completely separate context, viewing pilot A's public flight
  // — the label must be clickable even though this isn't B's own flight.
  const bContext = await newContext();
  const bPage = await bContext.newPage();
  await signUp(bPage, `comm_b_${suffix}@test.local`, bHandle, "Community B");
  await bPage.goto(flightUrl);
  await expect(bPage.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  const newName = `${siteName} (renamed)`;
  const siteButton = bPage.locator("h1 button");
  await expect(siteButton).toBeEnabled({ timeout: 10_000 });
  await siteButton.click();
  await expect(bPage.getByText("Public site — community owned")).toBeVisible({ timeout: 5_000 });
  await bPage.getByRole("button", { name: "Edit site", exact: true }).click();
  const editor = bPage.getByRole("dialog", { name: "Site details" });
  await expectSiteVisibility(editor, "public");
  await editor.getByRole("button", { name: "Private", exact: true }).click();
  await expect(editor.getByRole("status").filter({ hasText: "Only the site owner can change visibility." })).toBeVisible();
  await expectSiteVisibility(editor, "public");
  const nameInput = editor.getByLabel("Name", { exact: true });
  await nameInput.fill(newName);
  await editor.getByRole("button", { name: "Save site", exact: true }).click();
  // The rename must be visible LIVE, with no reload — both the dialog's own
  // header and the underlying flight's h1 (via SiteNameControl's onRenamed
  // callback). A prior version of this dialog updated neither until reload.
  await expect(editor.getByRole("button", { name: "Save site", exact: true })).toHaveCount(0);
  await expect(bPage.locator("h2").getByText(newName, { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(bPage.getByRole("heading", { level: 1 })).toHaveText(newName, { timeout: 5_000 });
  await bPage.getByRole("button", { name: "Close", exact: true }).click();

  // Still true after a reload, and for pilot A too — whose own cached
  // flight-header name follows the same live site row.
  await bPage.reload();
  await expect(bPage.getByRole("heading", { level: 1 })).toHaveText(newName, { timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(newName, { timeout: 10_000 });

  await bContext.close();
});

test("an independent pilot endorses a public site and the endorsement persists for its owner", async ({ page, newContext }) => {
  const { suffix, flightUrl, siteName } = await createPublicFlight(page);
  // The owner can leave the flight while the other pilot uses it. Release the
  // idle replay's WebGL resources; keep the signed-in context for verification.
  await page.goto("/logbook");
  const cContext = await newContext();
  const cPage = await cContext.newPage();
  await signUp(cPage, `comm_c_${suffix}@test.local`, `commC${suffix}`.slice(0, 18), "Community C");
  await cPage.goto(flightUrl);
  await expect(cPage.getByRole("heading", { level: 1 })).toHaveText(siteName);
  await cPage.getByRole("heading", { level: 1 }).getByRole("button").click();
  const dialog = cPage.getByRole("dialog", { name: "Site details" });
  await expect(dialog.getByText("0 endorsements")).toBeVisible();
  await dialog.getByRole("button", { name: "Endorse", exact: true }).click();
  await expect(dialog.getByText("1 endorsement", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Endorsed/ })).toBeVisible();
  await cPage.reload();
  await cPage.getByRole("heading", { level: 1 }).getByRole("button").click();
  await expect(cPage.getByRole("button", { name: /Endorsed/ })).toBeVisible();
  await cContext.close();
  await page.goto(flightUrl);
  await page.getByRole("heading", { level: 1 }).getByRole("button").click();
  await page.getByRole("button", { name: "Community & history", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Site details" }).getByText("1 endorsement", { exact: true })).toBeVisible();
});
