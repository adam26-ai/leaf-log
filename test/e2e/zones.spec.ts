import { test, expect } from "@playwright/test";
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

/**
 * SPRINT-008: zones are hidden from the product surface by default
 * (ZONES_ENABLED unset/false, the production default) — this file asserts
 * that shipped default-off behavior. The pre-SPRINT-008 zone-matching/
 * "Which spot?"/"Current" scenarios this file used to cover now live as
 * "[gate-on legacy]" coverage in lib/sites/lookup.test.ts and
 * test/sites.integration.test.ts instead — this project deliberately runs
 * no gate-on E2E CI job (see docs/sprints/SPRINT-008.md), so there is no
 * e2e equivalent for them anymore, only unit/integration.
 *
 * A synthetic flight far from every other fixture in this repo's e2e/
 * integration coordinate space, so repeated local runs against a
 * persistent dev Postgres never collide.
 */
function remoteFlightIgc(runOffset: number, offset: number, seed: number): Buffer {
  const startLat = -32.0 + offset + (runOffset % 5000) * 0.01;
  const startLon = -162.0 + seed * 0.0001;
  const fixes: SynthFix[] = [];
  let t = 40000 + seed;
  let alt = 1300 + seed;

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

test("naming a site submits directly — no 'Which spot?' step is ever reachable", async ({ page }) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}nozone`;
  const email = `zones_e2e_nozone_${suffix}@test.local`;
  const handle = `zen${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  const link = await getMagicLink();
  await page.goto(link);
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Zones E2E No-Zone Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  // Unknown site.
  await page.goto("/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "nozone1.igc", mimeType: "text/plain", buffer: remoteFlightIgc(runOffset, 0, 1) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unknown site");

  // Name the site — with zones hidden, entering a name and clicking the
  // submit button saves and closes the dialog directly. No "Which spot?"
  // step, no "Skip — just the site" button (there's nothing to skip).
  const siteName = `E2E No-Zone Ridge ${suffix}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.locator('input[placeholder="e.g. North Launch"]')).not.toBeVisible({ timeout: 3_000 });
  await expect(page.getByText(/Which .* spot\?/i)).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Skip.*just the site/i })).not.toBeVisible();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  // A distinct second IGC nearby auto-associates to the site, same as ever.
  await page.goto("/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "nozone2.igc", mimeType: "text/plain", buffer: remoteFlightIgc(runOffset, 0, 2) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });
});

test("re-opening an already-named site never shows a zone step, and the boundary picker has no 'My spots' section", async ({
  page,
}) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}reopen`;
  const email = `zones_e2e_reopen_${suffix}@test.local`;
  const handle = `zer${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  const link = await getMagicLink();
  await page.goto(link);
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Zones E2E Reopen Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  await page.goto("/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "reopen1.igc", mimeType: "text/plain", buffer: remoteFlightIgc(runOffset, 5, 1) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });

  const siteName = `E2E Reopen Ridge ${suffix}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  // Re-open on the already-site-bound flight — lands on the read-only
  // site-overview step (SPRINT-008), never a zone step.
  await page.locator("h1 button").click();
  const dialog = page.locator(".fixed.inset-0");
  await dialog.getByRole("heading", { name: siteName }).waitFor({ timeout: 5_000 });
  const overviewText = await dialog.innerText();
  expect(overviewText.match(/\bspot\b/gi) ?? []).toEqual([]);
  expect(overviewText.match(/\bzone\b/gi) ?? []).toEqual([]);

  // "Edit this site" reaches the management view — still no zone step,
  // no "Which spot?" input, no zone/spot copy.
  await page.getByRole("button", { name: "Edit this site" }).click();
  await expect(page.locator('input[placeholder="e.g. North Launch"]')).not.toBeVisible();
  const editText = await page.locator(".fixed.inset-0").innerText();
  expect(editText.match(/\bspot\b/gi) ?? []).toEqual([]);
  expect(editText.match(/\bzone\b/gi) ?? []).toEqual([]);

  // Back to the overview, then "Choose a different site" reaches the
  // choose/create flow, whose boundary picker lists sites only.
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Choose a different site" }).click();
  await page.getByText("Edit a boundary on one of my sites").click();
  await page.getByText("Edit a boundary").first().waitFor({ timeout: 5_000 });
  const pickerText = await page.locator(".fixed.inset-0").innerText();
  expect(pickerText).not.toContain("My spots");
  expect(pickerText.match(/\bspot\b/gi) ?? []).toEqual([]);
});
