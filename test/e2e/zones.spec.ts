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
 * A synthetic flight far from every curated/prior site. `runOffset` spreads
 * each test run across empty ocean/desert so repeated local runs against a
 * persistent dev Postgres never collide; `zoneOffset` further separates the
 * two scenarios in this file from each other and from sites.spec.ts's own
 * fixtures. `seed` (1 or 2 within one scenario) shifts the whole track
 * shape so the two calls produce genuinely distinct IGC bytes (dedupe is by
 * exact bytes) while the TAKEOFF point stays within the 300 m zone radius
 * of each other — proving the auto-association is two levels deep, not
 * just at the site level.
 */
function remoteFlightIgc(runOffset: number, zoneOffset: number, seed: number): Buffer {
  const startLat = -30.0 + zoneOffset + (runOffset % 5000) * 0.01;
  const startLon = -160.0 + seed * 0.0001;
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

test("bare-site path: skipping the zone step keeps the SPRINT-004 one-step outcome", async ({ page }) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}bare`;
  const email = `zones_e2e_bare_${suffix}@test.local`;
  const handle = `zeb${suffix}`.slice(0, 18);
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
  await page.locator('input[name="display_name"]').fill("Zones E2E Bare Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  // Unknown site.
  await page.goto("/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "bare1.igc", mimeType: "text/plain", buffer: remoteFlightIgc(runOffset, 0, 1) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unknown site");

  // Name the site, then SKIP the zone step — the SPRINT-004 outcome must be
  // byte-identical: just the site name, no dialog friction added.
  const siteName = `E2E Bare Ridge ${suffix}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator('input[placeholder="e.g. North Launch"]').waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: /Skip.*just the site/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  // A distinct second IGC nearby auto-associates to the SITE, still no zone.
  await page.goto("/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "bare2.igc", mimeType: "text/plain", buffer: remoteFlightIgc(runOffset, 0, 2) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });
});

test("two-level path: naming a zone renders 'Site — Zone' and a nearby distinct flight auto-associates two levels deep", async ({
  page,
}) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}deep`;
  const email = `zones_e2e_deep_${suffix}@test.local`;
  const handle = `zed${suffix}`.slice(0, 18);
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
  await page.locator('input[name="display_name"]').fill("Zones E2E Deep Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  // Unknown site.
  await page.goto("/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "deep1.igc", mimeType: "text/plain", buffer: remoteFlightIgc(runOffset, 5, 1) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unknown site");

  // Name the site, then add a public zone.
  const siteName = `E2E Deep Ridge ${suffix}`;
  const zoneName = `E2E North Launch ${suffix}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator('input[placeholder="e.g. North Launch"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. North Launch"]').fill(zoneName);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${siteName} — ${zoneName}`, {
    timeout: 10_000,
  });

  // A distinct second IGC within the zone radius auto-associates TWO LEVELS
  // deep — "Site — Zone" — with zero interaction with the naming dialog.
  await page.goto("/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "deep2.igc", mimeType: "text/plain", buffer: remoteFlightIgc(runOffset, 5, 2) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${siteName} — ${zoneName}`, {
    timeout: 10_000,
  });
});
