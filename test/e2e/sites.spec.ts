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

test("unknown site -> name it public -> a distinct second flight nearby auto-associates", async ({
  page,
}) => {
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

  // 2. Upload a flight far from every curated site -> "Unknown site".
  await page.goto("/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "remote1.igc", mimeType: "text/plain", buffer: remoteFlightIgc(Number(suffix), 1) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unknown site");

  // 3. Name it, public, in place — no navigation. SPRINT-008: zones are
  // hidden from the product, so "Next" saves and closes the dialog
  // directly — the SPRINT-004 one-step flow this always was.
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  const siteName = `E2E Desert Ridge ${suffix}`;
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  // 4. A distinct second IGC nearby (same pilot) auto-associates on upload —
  // no interaction with the naming dialog at all.
  await page.goto("/upload");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "remote2.igc", mimeType: "text/plain", buffer: remoteFlightIgc(Number(suffix), 2) });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });
});
