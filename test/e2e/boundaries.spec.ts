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

test("re-opening an already-boundary-bearing site shows the saved shape as a dashed reference, not just the live draft", async ({
  page,
}) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}b6reopen`;
  const email = `boundaries_e2e_reopen_${suffix}@test.local`;
  const handle = `b6ro${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });
  await stubBasemapTiles(page);

  const anchorLat = 40.5 + (runOffset % 5000) * 0.001;
  const anchorLon = -170.0;

  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  const link = await getMagicLink();
  await page.goto(link);
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Boundaries Reopen E2E Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles({
    name: "b6ro-1.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, anchorLat, anchorLon, 1),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });

  const siteName = `E2E Reopen Ridge ${suffix}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator('input[placeholder="e.g. North Launch"]').waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: /Skip.*just the site/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  // First edit: no boundary exists yet — the dashed reference should be
  // the CIRCLE, and the "currently saved boundary" legend must be absent.
  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit site boundary" }).click();
  const mapLocator = page.getByTestId("boundary-editor-map");
  await mapLocator.waitFor({ timeout: 10_000 });
  await expect(page.getByText(/currently saved boundary/i)).not.toBeVisible();

  const box = await mapLocator.boundingBox();
  if (!box) throw new Error("map container has no bounding box");
  const container = { width: box.width, height: box.height };
  const zoom = 15;
  const square: [number, number][] = [
    [anchorLon - metersToDegLon(150, anchorLat), anchorLat - metersToDegLat(150)],
    [anchorLon + metersToDegLon(150, anchorLat), anchorLat - metersToDegLat(150)],
    [anchorLon + metersToDegLon(150, anchorLat), anchorLat + metersToDegLat(150)],
    [anchorLon - metersToDegLon(150, anchorLat), anchorLat + metersToDegLat(150)],
  ];
  for (const [lon, lat] of square) {
    const px = pixelFor(lon, lat, { lng: anchorLon, lat: anchorLat }, zoom, container);
    await page.mouse.click(box.x + px.x, box.y + px.y);
  }
  await expect(page.getByText("4 points")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Saving returns to the zone step rather than closing the whole dialog
  // (onSaved -> onBack -> the step captured before the editor opened) — so
  // "Edit site boundary" is immediately clickable again with no need to
  // re-open the dialog from the h1.
  await expect(page.getByRole("button", { name: "Edit site boundary" })).toBeVisible({ timeout: 10_000 });

  // Second edit: the site now has a saved boundary — re-opening must show
  // it as a static dashed reference (the fix under test), and the vertex
  // count must reflect the shape that was actually loaded from the save
  // above, not an empty draft.
  await page.getByRole("button", { name: "Edit site boundary" }).click();
  await page.getByTestId("boundary-editor-map").waitFor({ timeout: 10_000 });
  await expect(page.getByText(/currently saved boundary/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("4 points")).toBeVisible({ timeout: 5_000 });

  // Third edit: fully close the dialog and the page (a real page reload,
  // not just staying within one dialog session) then come back — proves
  // the reference is loaded from what's actually persisted, not carried
  // over in component state. "Close" (BoundaryStep's own header button)
  // closes the whole dialog, unlike the editor's "Cancel" which only
  // returns to the zone step.
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 15_000 });
  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit site boundary" }).click();
  await page.getByTestId("boundary-editor-map").waitFor({ timeout: 10_000 });
  await expect(page.getByText(/currently saved boundary/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText("4 points")).toBeVisible({ timeout: 5_000 });
});

test("dragging (or clicking) the midpoint of an edge inserts a new vertex and reshapes the polygon live", async ({
  page,
}) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}b6mid`;
  const email = `boundaries_e2e_midpoint_${suffix}@test.local`;
  const handle = `b6mp${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });
  await stubBasemapTiles(page);

  const anchorLat = 30.5 + (runOffset % 5000) * 0.001;
  const anchorLon = -172.0;

  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  const link = await getMagicLink();
  await page.goto(link);
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Boundaries Midpoint E2E Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles({
    name: "b6mid-1.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, anchorLat, anchorLon, 1),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });

  const siteName = `E2E Midpoint Ridge ${suffix}`;
  await page.locator("h1 button").click();
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').waitFor({ timeout: 5_000 });
  await page.locator('input[placeholder="e.g. Sonoma Ridge"]').fill(siteName);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.locator('input[placeholder="e.g. North Launch"]').waitFor({ timeout: 5_000 });
  await page.getByRole("button", { name: /Skip.*just the site/i }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit site boundary" }).click();
  const mapLocator = page.getByTestId("boundary-editor-map");
  await mapLocator.waitFor({ timeout: 10_000 });
  const box = await mapLocator.boundingBox();
  if (!box) throw new Error("map container has no bounding box");
  const container = { width: box.width, height: box.height };
  const zoom = 15;
  const center = { lng: anchorLon, lat: anchorLat };

  // A square around the anchor — four corners, four edges. Bulging a single
  // edge straight outward along its own normal (rather than at a diagonal)
  // keeps this test's shape unambiguously non-self-intersecting regardless
  // of the small latitude-dependent scaling jitter introduces.
  const nw: [number, number] = [anchorLon - metersToDegLon(150, anchorLat), anchorLat + metersToDegLat(120)];
  const ne: [number, number] = [anchorLon + metersToDegLon(150, anchorLat), anchorLat + metersToDegLat(120)];
  const se: [number, number] = [anchorLon + metersToDegLon(150, anchorLat), anchorLat - metersToDegLat(120)];
  const sw: [number, number] = [anchorLon - metersToDegLon(150, anchorLat), anchorLat - metersToDegLat(120)];
  for (const [lon, lat] of [nw, ne, se, sw]) {
    const px = pixelFor(lon, lat, center, zoom, container);
    await page.mouse.click(box.x + px.x, box.y + px.y);
  }
  await expect(page.getByText("4 points")).toBeVisible({ timeout: 5_000 });

  // Click (no drag) the midpoint MARKER of the TOP edge (nw-ne, edge index
  // 0 in the 4-vertex ring) — located by its own data-testid rather than
  // computed pixel math, so this can't miss the (small) marker and fall
  // through to the map's own click-to-append handler underneath it. Must
  // insert a 5th vertex between nw and ne, not append one at the end.
  const topMidpointMarker = page.locator('[data-testid="boundary-midpoint"][data-edge-index="0"]');
  await topMidpointMarker.waitFor({ timeout: 5_000 });
  await topMidpointMarker.click();
  await expect(page.getByText("5 points")).toBeVisible({ timeout: 5_000 });

  // After that insert the ring is [nw, newTop, ne, se, sw] — the BOTTOM
  // edge (se-sw) is now edge index 3. Drag its midpoint marker straight
  // south, away from the square entirely (a plain outward bulge, no
  // diagonal) — must insert a 6th vertex and follow the drag to its
  // released position.
  const bottomMidpointMarker = page.locator('[data-testid="boundary-midpoint"][data-edge-index="3"]');
  await bottomMidpointMarker.waitFor({ timeout: 5_000 });
  const bottomMidBox = await bottomMidpointMarker.boundingBox();
  if (!bottomMidBox) throw new Error("bottom midpoint marker has no bounding box");
  const dragStartX = bottomMidBox.x + bottomMidBox.width / 2;
  const dragStartY = bottomMidBox.y + bottomMidBox.height / 2;

  const bottomMid: [number, number] = [(se[0] + sw[0]) / 2, (se[1] + sw[1]) / 2];
  const dragTarget: [number, number] = [bottomMid[0], bottomMid[1] - metersToDegLat(80)];
  const dragEndPx = pixelFor(dragTarget[0], dragTarget[1], center, zoom, container);

  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  // Multiple intermediate steps — a single jump can register as a click
  // rather than a drag in some pointer-event implementations.
  await page.mouse.move(box.x + dragEndPx.x, box.y + dragEndPx.y, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByText("6 points")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit site boundary" })).toBeVisible({ timeout: 10_000 });

  // A flight positioned comfortably INSIDE the new south bulge — south of
  // the original square's bottom edge (-120m) entirely, but well short of
  // the dragged-to tip (bottomMid - 80m) to avoid asserting exact-vertex
  // precision the drag gesture doesn't guarantee pixel-for-pixel — should
  // now match, proving the drag-inserted vertex actually reshaped what got
  // saved, not just the on-screen point count.
  const insideBulge: [number, number] = [bottomMid[0], bottomMid[1] - metersToDegLat(40)];
  await page.goto("/upload");
  await page.locator('input[type="file"]').setInputFiles({
    name: "b6mid-2.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, insideBulge[1], insideBulge[0], 2),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });
});
