import { createSiteFromFlight, setSiteKind, setSiteVisibility, uploadFlight } from "./helpers";
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

/**
 * A synthetic flight far from every curated site, so "Unknown site" is
 * reachable. `runOffset` spreads each test run across a wide swath of empty
 * ocean/desert so repeated local runs against a persistent dev Postgres
 * never collide with a site an earlier run already created there — CI gets
 * a fresh DB every time, but a developer re-running `pnpm e2e` locally
 * doesn't. `seed` (1 or 2 within one run) shifts both the coordinate and the
 * whole track shape so the two calls in a run produce genuinely distinct IGC
 * bytes (dedupe is by exact bytes) while still landing within the 600 m
 * takeoff match radius of each other.
 */
function remoteFlightIgc(runOffset: number, seed: number): Buffer {
  const startLat = -40.0 + (runOffset % 5000) * 0.01; // South Pacific, empty of curated sites
  const startLon = -170.0 + seed * 0.0001;
  const fixes: SynthFix[] = [];
  let t = 36000 + seed; // vary the timestamp too
  let alt = 1200 + seed;

  for (let i = 0; i < 10; i++) {
    fixes.push({ tSec: t, lat: startLat, lon: startLon, baro: alt, gps: alt + 5 });
    t += 1;
  }
  const R = 0.0008;
  let lat = startLat;
  let lon = startLon;
  for (let i = 0; i < 80; i++) {
    alt += 3;
    const cx = startLon + i * 0.00012;
    lat = startLat + R * Math.sin(i / 4);
    lon = cx + R * Math.cos(i / 4);
    fixes.push({ tSec: t, lat, lon, baro: alt, gps: alt + 5 });
    t += 1;
  }
  for (let i = 0; i < 80; i++) {
    alt -= 2;
    lon += 0.00018;
    fixes.push({ tSec: t, lat, lon, baro: alt, gps: alt + 5 });
    t += 1;
  }

  return Buffer.from(makeIgc({ glider: "Test Wing", fixes }));
}

async function signUp(page: Page) {
  const suffix = `${Date.now()}`;
  const email = `sites_e2e_${suffix}@test.local`;
  const handle = `se2e${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

  // 1. Sign up and onboard.
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  const link = await getMagicLink();
  await page.goto(link);
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Sites E2E Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  return suffix;
}

test("a standalone site saves its pin and persists public and private visibility", async ({ page }) => {
  const suffix = await signUp(page);
  // A site can be created independently, without borrowing an IGC.
  await page.goto("/settings/sites");
  await expect(page.getByRole("heading", { level: 1, name: "Sites" })).toBeVisible();
  const standaloneName = `E2E Standalone Ridge ${suffix}`;
  const editor = page.getByRole('dialog', { name: 'Site details' });
  await page.getByRole('button', { name: 'Create a site', exact: true }).click();
  await editor.getByLabel('Name', { exact: true }).fill(standaloneName);
  await editor.getByLabel('Pin latitude').fill('35');
  await editor.getByLabel('Pin longitude').fill('15');
  await editor.getByRole('button', { name: 'Save site', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const siteRow = page.getByRole('button', { name: new RegExp(standaloneName) });
  await expect(siteRow.getByLabel('Private', { exact: true })).toBeVisible();
  for (const visibility of ['public', 'private'] as const) {
    await page.getByRole('button', { name: 'Edit site', exact: true }).click();
    await setSiteVisibility(editor, visibility);
    await editor.getByRole('button', { name: 'Save site', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.reload();
    await expect(siteRow.getByLabel(visibility === 'public' ? 'Public' : 'Private', { exact: true })).toBeVisible();
  }

});

test("a site with a nearby namesake can change to takeoff and landing", async ({ page }) => {
  const suffix = await signUp(page);
  await page.goto("/settings/sites");
  const name = `Namesake Ridge ${suffix}`;
  const editor = page.getByRole("dialog", { name: "Site details" });

  await page.getByRole("button", { name: "Create a site", exact: true }).click();
  await editor.getByLabel("Name", { exact: true }).fill(name);
  await editor.getByLabel("Pin latitude").fill("35");
  await editor.getByLabel("Pin longitude").fill("15");
  await editor.getByRole("button", { name: "Save site", exact: true }).click();
  await expect(editor).toHaveCount(0);

  await page.getByRole("button", { name: "Create a site", exact: true }).click();
  await editor.getByLabel("Name", { exact: true }).fill(name);
  await setSiteKind(editor, "landing");
  await editor.getByLabel("Pin latitude").fill("35.0001");
  await editor.getByLabel("Pin longitude").fill("15");
  await editor.getByRole("button", { name: "Save site", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const rows = page.getByRole("region", { name: "Sites list" }).getByRole("button", { name: new RegExp(name) });
  await expect(rows).toHaveCount(2);

  await rows.first().click();
  await page.getByRole("button", { name: "Edit site", exact: true }).click();
  const firstKind = await editor.getByRole("combobox", { name: "Used for", exact: true }).inputValue();
  if (firstKind !== "takeoff") {
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await rows.nth(1).click();
    await page.getByRole("button", { name: "Edit site", exact: true }).click();
  }
  await expect(editor.getByRole("combobox", { name: "Used for", exact: true })).toHaveValue("takeoff");
  await setSiteKind(editor, "both");
  await editor.getByRole("button", { name: "Save site", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.reload();
  await expect(rows).toHaveCount(2);
  const persistedKinds = [];
  for (let index = 0; index < 2; index++) {
    await rows.nth(index).click();
    await page.getByRole("button", { name: "Edit site", exact: true }).click();
    persistedKinds.push(await editor.getByRole("combobox", { name: "Used for", exact: true }).inputValue());
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  expect(persistedKinds.sort()).toEqual(["both", "landing"]);

  await page.getByRole("button", { name: "Create a site", exact: true }).click();
  await editor.getByLabel("Name", { exact: true }).fill(name);
  await setSiteKind(editor, "both");
  await editor.getByLabel("Pin latitude").fill("35");
  await editor.getByLabel("Pin longitude").fill("15");
  await editor.getByRole("button", { name: "Save site", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("already has a nearby map pin");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(name);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("unknown site -> name it public -> a distinct second flight nearby auto-associates", async ({ page }) => {
  const suffix = await signUp(page);
  // 2. Upload a flight far from every curated site -> "Unknown site".
  await page.goto("/upload");
  await uploadFlight(page, { name: "remote1.igc", mimeType: "text/plain", buffer: remoteFlightIgc(Number(suffix), 1) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Site not identified");

  // 3. Name it, public, in place — no navigation. SPRINT-008: zones are
  // hidden from the product, so "Next" saves and closes the dialog
  // directly — the SPRINT-004 one-step flow this always was.
  const siteName = `E2E Desert Ridge ${suffix}`;
  await createSiteFromFlight(page, siteName, "public");

  // 4. A distinct second IGC nearby (same pilot) auto-associates on upload —
  // no interaction with the naming dialog at all.
  await page.goto("/upload");
  await uploadFlight(page, { name: "remote2.igc", mimeType: "text/plain", buffer: remoteFlightIgc(Number(suffix), 2) });
  await page.getByRole("button", { name: "Keep this uploaded flight" }).click();
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });
});
