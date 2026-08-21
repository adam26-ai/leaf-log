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

/** A minimal, valid, source-and-tile-free MapLibre style — the basemap
 *  itself has no matching value for this test, and depending on a live
 *  third-party tile CDN (OpenFreeMap) would make a map-driving test a
 *  flake generator. `map.on('load')` fires against this exactly as it
 *  would against the real style. */
const EMPTY_STYLE = { version: 8, sources: {}, layers: [] };

async function stubBasemapTiles(page: Page) {
  await page.route("**/tiles.openfreemap.org/**", (route) => route.fulfill({ json: EMPTY_STYLE }));
  await page.route("**/api.maptiler.com/**", (route) => route.fulfill({ json: EMPTY_STYLE }));
}

function remoteFlightIgc(runOffset: number, lat: number, lon: number, seed: number): Buffer {
  const fixes: SynthFix[] = [];
  let t = 50000 + seed + (runOffset % 1000);
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

/** Standard Web Mercator projection (tile size 512, doubling per zoom) —
 *  the SAME math MapLibre itself uses, computed independently here so the
 *  test can click the exact screen pixel a given (lat, lon) renders at,
 *  without touching the app's internal map instance. */
function project(lng: number, lat: number) {
  const x = (lng + 180) / 360;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y };
}

function pixelFor(
  lng: number,
  lat: number,
  center: { lng: number; lat: number },
  zoom: number,
  container: { width: number; height: number },
) {
  const worldSize = 512 * 2 ** zoom;
  const c = project(center.lng, center.lat);
  const p = project(lng, lat);
  return {
    x: container.width / 2 + (p.x - c.x) * worldSize,
    y: container.height / 2 + (p.y - c.y) * worldSize,
  };
}

/** Metres -> degrees, small-extent approximation (matches the app's own
 *  equirectangular approximation everywhere else in lib/sites). */
function metersToDegLat(m: number) {
  return m / 111_320;
}
function metersToDegLon(m: number, atLat: number) {
  return m / (111_320 * Math.cos((atLat * Math.PI) / 180));
}

test("draw a boundary via the owner-scoped picker (no bound flight), then a flight past the old circle but inside the boundary auto-names itself", async ({
  page,
}) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}b6`;
  const email = `boundaries_e2e_${suffix}@test.local`;
  const handle = `b6e${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });
  await stubBasemapTiles(page);

  // Near the equator — keeps Web Mercator meters-per-pixel large (a fixed
  // real-world distance needs fewer on-screen pixels), so the boundary
  // fits comfortably inside the editor's fixed-height map without touching
  // production zoom/container sizing just for testability.
  const anchorLat = 0.4 + (runOffset % 5000) * 0.001;
  const anchorLon = -168.0;

  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  const link = await getMagicLink();
  await page.goto(link);
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Boundaries E2E Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  // Flight #1: name a new public site AND zone at the anchor.
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles({
    name: "b6-1.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, anchorLat, anchorLon, 1),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unknown site");

  const siteName = `E2E Boundary Ridge ${suffix}`;
  const zoneName = `E2E Boundary Launch ${suffix}`;
  const fullLabel = `${siteName} — ${zoneName}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator('input[placeholder="e.g. North Launch"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. North Launch"]').fill(zoneName);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullLabel, { timeout: 10_000 });

  // Flight #2: a SEPARATE, unrelated, still-unmatched flight far away — its
  // own naming dialog has NOTHING bound. Reaching the boundary editor for
  // the zone named above from HERE is the reachability fix under test: the
  // picker, not a bound-flight shortcut.
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles({
    name: "b6-2.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, anchorLat + 5, anchorLon + 5, 2),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Unknown site");

  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: /Edit a boundary on one of my sites/i }).click();
  await expect(page.getByText(zoneName)).toBeVisible({ timeout: 10_000 });
  const zoneRow = page.locator("li", { hasText: zoneName });
  await zoneRow.getByRole("button", { name: "Draw" }).click();

  const mapLocator = page.getByTestId("boundary-editor-map");
  await mapLocator.waitFor({ timeout: 10_000 });
  const box = await mapLocator.boundingBox();
  if (!box) throw new Error("map container has no bounding box");
  const container = { width: box.width, height: box.height };
  const zoom = 15;

  // A rectangle around the anchor, reaching ~400m EAST — past the zone's
  // 300m takeoff circle, and comfortably within the editor's fixed
  // 400x360px map at zoom 15 (~2.39 m/px near the equator; a reach much
  // past ~430m would click outside the map entirely and land on the
  // dialog's backdrop instead). Four corners, tapped in order — the
  // editor auto-closes the ring on save.
  const halfNorthSouthM = 80;
  const westMarginM = 80;
  const eastReachM = 400;
  const corners: [number, number][] = [
    [anchorLon - metersToDegLon(westMarginM, anchorLat), anchorLat - metersToDegLat(halfNorthSouthM)],
    [anchorLon + metersToDegLon(eastReachM, anchorLat), anchorLat - metersToDegLat(halfNorthSouthM)],
    [anchorLon + metersToDegLon(eastReachM, anchorLat), anchorLat + metersToDegLat(halfNorthSouthM)],
    [anchorLon - metersToDegLon(westMarginM, anchorLat), anchorLat + metersToDegLat(halfNorthSouthM)],
  ];

  for (const [lon, lat] of corners) {
    const px = pixelFor(lon, lat, { lng: anchorLon, lat: anchorLat }, zoom, container);
    await page.mouse.click(box.x + px.x, box.y + px.y);
  }

  await expect(page.getByText("4 points")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(zoneName)).not.toBeVisible({ timeout: 10_000 }); // picker/editor closed

  // Flight #3: takeoff ~350m EAST of the anchor — outside the zone's 300m
  // circle, inside the drawn boundary. Must auto-name two levels deep with
  // ZERO dialog interaction.
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles({
    name: "b6-3.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, anchorLat, anchorLon + metersToDegLon(350, anchorLat), 3),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(fullLabel, { timeout: 10_000 });
});

test("an anchor-excluding boundary is refused, live, before Save is even clickable", async ({ page }) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}b6excl`;
  const email = `boundaries_e2e_excl_${suffix}@test.local`;
  const handle = `b6x${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });
  await stubBasemapTiles(page);

  const anchorLat = 20.5 + (runOffset % 5000) * 0.001;
  const anchorLon = -169.0;

  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  const link = await getMagicLink();
  await page.goto(link);
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Boundaries Excl E2E Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  // Name a site, then reach its boundary editor via the BOUND-FLIGHT
  // shortcut this time (not the picker) — the other reachable path.
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles({
    name: "b6x-1.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, anchorLat, anchorLon, 1),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });

  const siteName = `E2E Excluded Anchor Ridge ${suffix}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator('input[placeholder="e.g. North Launch"]').waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: /Skip.*just the site/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  // Re-opening the dialog on an already-bound site goes straight to the
  // zone step (SPRINT-005 behavior), which offers "Edit site boundary"
  // rather than SiteStep's "Edit boundary" label.
  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit site boundary" }).click();

  const mapLocator = page.getByTestId("boundary-editor-map");
  await mapLocator.waitFor({ timeout: 10_000 });
  const box = await mapLocator.boundingBox();
  if (!box) throw new Error("map container has no bounding box");
  const container = { width: box.width, height: box.height };
  const zoom = 15;

  // A small triangle entirely EAST of the anchor — never contains (0, 0).
  const triangle: [number, number][] = [
    [anchorLon + metersToDegLon(200, anchorLat), anchorLat + metersToDegLat(50)],
    [anchorLon + metersToDegLon(300, anchorLat), anchorLat + metersToDegLat(50)],
    [anchorLon + metersToDegLon(250, anchorLat), anchorLat + metersToDegLat(150)],
  ];
  for (const [lon, lat] of triangle) {
    const px = pixelFor(lon, lat, { lng: anchorLon, lat: anchorLat }, zoom, container);
    await page.mouse.click(box.x + px.x, box.y + px.y);
  }

  await expect(page.getByText("3 points")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/has to include the site's own location/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
});
