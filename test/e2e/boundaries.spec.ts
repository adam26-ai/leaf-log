import { uploadFlight } from "./helpers";
import { test, expect, type Page } from "./fixtures";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { makeIgc, type SynthFix } from "@/test/igc/make-igc";
import { PrismaClient } from "@prisma/client";
import { foldName } from "@/lib/sites/name";

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

/** The editor no longer displays a "N points" line (removed per the user's
 *  own UI-declutter request) — count the actual vertex marker elements
 *  instead, the same signal the editor itself uses to decide whether a
 *  drag/click was an insert vs. a move. */
async function expectVertexCount(page: Page, n: number, timeout = 5_000) {
  await expect(page.locator('[data-testid="boundary-vertex"]')).toHaveCount(n, { timeout });
}

// Validation messages change the centered dialog's height while drawing.
// Re-measure its position for every gesture instead of reusing stale pixels.
async function mapPoint(page: Page, point: { x: number; y: number }) {
  const map = page.getByTestId("boundary-editor-map");
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  if (!box) throw new Error("Boundary map is not visible");
  return { x: box.x + point.x, y: box.y + point.y };
}
async function clickMap(page: Page, point: { x: number; y: number }) {
  const screen = await mapPoint(page, point);
  await page.mouse.click(screen.x, screen.y);
}
async function moveOnMap(page: Page, point: { x: number; y: number }, steps = 1) {
  const screen = await mapPoint(page, point);
  await page.mouse.move(screen.x, screen.y, { steps });
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

/** Arrange an existing flight/site for focused geometry tests. The sites and
 * zones suites cover the complete upload/create journey; repeating that setup
 * in every gesture test adds unrelated replay startup and dialog transitions. */
async function arrangeBoundFlight(page: Page, siteName: string, buffer: Buffer) {
  const response = await page.request.post("/api/upload", { multipart: { files: {
    name: "boundary-fixture.igc", mimeType: "text/plain", buffer,
  } } });
  expect(response.ok()).toBe(true);
  const { results } = await response.json();
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ status: "ready", deduped: false });
  const flightId: string = results[0].flightId;
  const db = new PrismaClient();
  try {
    const flight = await db.flight.findUniqueOrThrow({ where: { id: flightId } });
    if (flight.takeoffLat === null || flight.takeoffLon === null) throw new Error("Boundary fixture has no takeoff position");
    const site = await db.site.create({ data: {
      name: siteName, normalizedName: foldName(siteName), kind: "takeoff", visibility: "private",
      lat: flight.takeoffLat, lon: flight.takeoffLon, pinSource: "flight_gps", ownerId: flight.ownerId,
    } });
    await db.flight.update({ where: { id: flightId }, data: {
      takeoffSiteId: site.id, takeoffSiteName: siteName, takeoffSiteAssignment: "user_selected",
    } });
  } finally { await db.$disconnect(); }
  await page.goto(`/flights/${flightId}`);
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

/** The editor frames its initial view on whatever geometry it already has
 *  (fitBounds around the saved boundary or the reference circle) rather
 *  than always opening at a fixed zoom/center — so tests must read the
 *  REAL post-fitBounds view off the map's own data-* attributes (published
 *  by boundary-editor.tsx on 'moveend') instead of assuming the
 *  construction-time zoom=15/center=anchor. */
async function readMapView(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="boundary-editor-map"]') as HTMLElement | null;
    return !!el?.dataset.zoom;
  });
  // fitBounds is called with duration: 0 (synchronous jump) but give layout
  // a beat to settle before trusting the published values.
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="boundary-editor-map"]') as HTMLElement;
    return {
      zoom: Number(el.dataset.zoom),
      center: { lng: Number(el.dataset.centerLng), lat: Number(el.dataset.centerLat) },
    };
  });
}

test("draw a boundary from site management without binding the current flight, then a flight inside it auto-names itself", async ({
  page,
}) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}b6`;
  const email = `boundaries_e2e_${suffix}@test.local`;
  const handle = `b6e${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

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

  // Flight #1 supplies the existing site that will be edited from management.
  const siteName = `E2E Boundary Ridge ${suffix}`;
  await arrangeBoundFlight(page, siteName, remoteFlightIgc(runOffset, anchorLat, anchorLon, 1));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  // Flight #2: a SEPARATE, unrelated, still-unmatched flight far away — its
  // own naming dialog has NOTHING bound. Site management must let the
  // owner edit the existing site without assigning it to this flight.
  await page.goto("/upload");
  await uploadFlight(page, {
    name: "b6-2.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, anchorLat + 5, anchorLon + 5, 2),
  });
  await page.getByRole("button", { name: "Keep this uploaded flight", exact: true }).click();
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Site not identified");

  const unmatchedFlightUrl = page.url();
  await page.goto("/settings/sites");
  await page.getByRole("button", { name: new RegExp(siteName) }).click();
  await expect(page.getByText("My spots")).not.toBeVisible();
  await page.getByRole("button", { name: "Edit site", exact: true }).click();
  await page.getByRole("button", { name: "Draw or edit boundary", exact: true }).click();

  const mapLocator = page.getByTestId("boundary-editor-map");
  await mapLocator.waitFor({ timeout: 10_000 });
  const box = await mapLocator.boundingBox();
  if (!box) throw new Error("map container has no bounding box");
  const container = { width: box.width, height: box.height };
  const { zoom, center } = await readMapView(page);

  // A rectangle around the anchor, reaching ~800m EAST — past the SITE's
  // (not a zone's) 600m takeoff circle. Scaled up from the zone-level
  // version of this test 2x throughout (300m zone circle -> 600m site
  // circle), since the editor's own fitBounds zooms out further to frame
  // the larger reference circle, so proportionally more real-world
  // distance still fits the same fixed 400x360px map container. Four
  // corners, tapped in order — the editor auto-closes the ring on save.
  const halfNorthSouthM = 160;
  const westMarginM = 160;
  const eastReachM = 800;
  const corners: [number, number][] = [
    [anchorLon - metersToDegLon(westMarginM, anchorLat), anchorLat - metersToDegLat(halfNorthSouthM)],
    [anchorLon + metersToDegLon(eastReachM, anchorLat), anchorLat - metersToDegLat(halfNorthSouthM)],
    [anchorLon + metersToDegLon(eastReachM, anchorLat), anchorLat + metersToDegLat(halfNorthSouthM)],
    [anchorLon - metersToDegLon(westMarginM, anchorLat), anchorLat + metersToDegLat(halfNorthSouthM)],
  ];

  for (const [lon, lat] of corners) {
    const px = pixelFor(lon, lat, center, zoom, container);
    await clickMap(page, px);
  }

  await expectVertexCount(page, 4, 5000);
  await page.getByRole("button", { name: "Save site", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Site details" })).toHaveCount(0);
  await page.goto(unmatchedFlightUrl);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Site not identified");

  // Flight #3: takeoff ~700m EAST of the anchor — outside the site's 600m
  // circle, inside the drawn boundary. Must auto-name with ZERO dialog
  // interaction.
  await page.goto("/upload");
  await uploadFlight(page, {
    name: "b6-3.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, anchorLat, anchorLon + metersToDegLon(700, anchorLat), 3),
  });
  await page.getByRole("button", { name: "Keep this uploaded flight", exact: true }).click();
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });
});

test("an anchor-excluding boundary shows live validation and blocks saving the site", async ({ page }) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}b6excl`;
  const email = `boundaries_e2e_excl_${suffix}@test.local`;
  const handle = `b6x${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

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

  // Reach the existing site's editor through its bound flight.
  const siteName = `E2E Excluded Anchor Ridge ${suffix}`;
  await arrangeBoundFlight(page, siteName, remoteFlightIgc(runOffset, anchorLat, anchorLon, 1));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  // Re-opening the dialog on an already-bound site lands on the read-only
  // overview step first; "Edit this site" opens the full editor, where
  // drawing must be selected explicitly instead of moving the pin.
  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit this site" }).click();
  await page.getByRole("button", { name: "Draw or edit boundary", exact: true }).click();

  const mapLocator = page.getByTestId("boundary-editor-map");
  await mapLocator.waitFor({ timeout: 10_000 });
  const box = await mapLocator.boundingBox();
  if (!box) throw new Error("map container has no bounding box");
  const container = { width: box.width, height: box.height };
  const { zoom, center } = await readMapView(page);

  // A small triangle entirely EAST of the anchor — never contains (0, 0).
  const triangle: [number, number][] = [
    [anchorLon + metersToDegLon(200, anchorLat), anchorLat + metersToDegLat(50)],
    [anchorLon + metersToDegLon(300, anchorLat), anchorLat + metersToDegLat(50)],
    [anchorLon + metersToDegLon(250, anchorLat), anchorLat + metersToDegLat(150)],
  ];
  for (const [lon, lat] of triangle) {
    const px = pixelFor(lon, lat, center, zoom, container);
    await clickMap(page, px);
  }

  await expectVertexCount(page, 3, 5000);
  await expect(page.getByText(/has to include the site's own location/i)).toBeVisible({ timeout: 5_000 });

  // The boundary editor's own Save is gone in this embedded context —
  // there's one unified Save (bottom row) covering both the name and any
  // pending boundary edit. Clicking it surfaces the boundary's own
  // validation error rather than silently discarding the invalid draft or
  // saving the name anyway.
  await page.getByRole("button", { name: "Save site", exact: true }).click();
  await expect(page.getByText(/has to include the site's own location/i)).toBeVisible({ timeout: 5_000 });
  // Still on the edit screen — the invalid boundary blocked the whole
  // Save, name included, rather than silently saving the name and
  // discarding the in-progress boundary draft.
  await mapLocator.waitFor({ timeout: 2_000 });
});

test("re-opening an already-boundary-bearing site shows the saved shape as a dashed reference, not just the live draft", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const runOffset = Date.now();
  const suffix = `${runOffset}b6reopen`;
  const email = `boundaries_e2e_reopen_${suffix}@test.local`;
  const handle = `b6ro${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

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

  const siteName = `E2E Reopen Ridge ${suffix}`;
  await arrangeBoundFlight(page, siteName, remoteFlightIgc(runOffset, anchorLat, anchorLon, 1));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  // First edit: no boundary exists yet. Open the full editor and select
  // boundary drawing. The dashed reference should be the CIRCLE, and the "currently
  // saved boundary" legend must be absent.
  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit this site" }).click();
  await page.getByRole("button", { name: "Draw or edit boundary", exact: true }).click();
  const mapLocator = page.getByTestId("boundary-editor-map");
  await mapLocator.waitFor({ timeout: 10_000 });
  await expect(page.getByText(/currently saved boundary/i)).not.toBeVisible();

  const box = await mapLocator.boundingBox();
  if (!box) throw new Error("map container has no bounding box");
  const container = { width: box.width, height: box.height };
  const { zoom, center } = await readMapView(page);
  const square: [number, number][] = [
    [anchorLon - metersToDegLon(150, anchorLat), anchorLat - metersToDegLat(150)],
    [anchorLon + metersToDegLon(150, anchorLat), anchorLat - metersToDegLat(150)],
    [anchorLon + metersToDegLon(150, anchorLat), anchorLat + metersToDegLat(150)],
    [anchorLon - metersToDegLon(150, anchorLat), anchorLat + metersToDegLat(150)],
  ];
  for (const [lon, lat] of square) {
    const px = pixelFor(lon, lat, center, zoom, container);
    await clickMap(page, px);
  }
  await expectVertexCount(page, 4, 5000);

  // The unified Save (bottom row) commits the boundary draft (dirty) and
  // the name (unchanged, still succeeds) together, then closes the dialog.
  await page.getByRole("button", { name: "Save site", exact: true }).click();
  await expect(page.getByTestId("boundary-editor-map")).not.toBeVisible();

  // Second edit: re-entering "Edit this site" re-fetches from the server
  // fresh, so the dashed reference (the fix under test) and the correct
  // vertex count must reflect what was actually just persisted.
  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit this site" }).click();
  await page.getByRole("button", { name: "Draw or edit boundary", exact: true }).click();
  await expect(page.getByText(/currently saved boundary/i)).toBeVisible({ timeout: 10_000 });
  await expectVertexCount(page, 4, 5000);

  // Third edit: a real page reload (not just staying within one dialog
  // session) then come back — proves the reference is loaded from what's
  // actually persisted, not carried over in component state.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 15_000 });
  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit this site" }).click();
  await page.getByRole("button", { name: "Draw or edit boundary", exact: true }).click();
  await page.getByTestId("boundary-editor-map").waitFor({ timeout: 10_000 });
  await expect(page.getByText(/currently saved boundary/i)).toBeVisible({ timeout: 5_000 });
  await expectVertexCount(page, 4, 5000);
});

test("clicking or dragging near an edge inserts a new vertex there and reshapes the polygon live", async ({
  page,
}) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}b6mid`;
  const email = `boundaries_e2e_midpoint_${suffix}@test.local`;
  const handle = `b6mp${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

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

  const siteName = `E2E Midpoint Ridge ${suffix}`;
  await arrangeBoundFlight(page, siteName, remoteFlightIgc(runOffset, anchorLat, anchorLon, 1));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit this site" }).click();
  await page.getByRole("button", { name: "Draw or edit boundary", exact: true }).click();
  const mapLocator = page.getByTestId("boundary-editor-map");
  await mapLocator.waitFor({ timeout: 10_000 });
  const box = await mapLocator.boundingBox();
  if (!box) throw new Error("map container has no bounding box");
  const container = { width: box.width, height: box.height };
  const { zoom, center } = await readMapView(page);
  // The site's REAL anchor (center, since fitBounds frames a circle that's
  // symmetric around it) can differ from the raw (anchorLat, anchorLon) fed
  // into the synthetic IGC above by tens of metres — remoteFlightIgc's
  // climb-out drifts longitude fix-by-fix, and takeoff detection doesn't
  // necessarily land on the very first fix. Anchoring this test's geometry
  // to the REAL center (not the raw constant) keeps it correct regardless
  // of exactly which fix gets picked as "takeoff".
  const driftLat = center.lat - anchorLat;
  const driftLon = center.lng - anchorLon;

  // A square around the REAL anchor — four corners, four edges. Bulging a
  // single edge straight outward along its own normal (rather than at a
  // diagonal) keeps this test's shape unambiguously non-self-intersecting
  // regardless of the small latitude-dependent scaling jitter introduces.
  const nw: [number, number] = [center.lng - metersToDegLon(150, center.lat), center.lat + metersToDegLat(120)];
  const ne: [number, number] = [center.lng + metersToDegLon(150, center.lat), center.lat + metersToDegLat(120)];
  const se: [number, number] = [center.lng + metersToDegLon(150, center.lat), center.lat - metersToDegLat(120)];
  const sw: [number, number] = [center.lng - metersToDegLon(150, center.lat), center.lat - metersToDegLat(120)];
  for (const [lon, lat] of [nw, ne, se, sw]) {
    const px = pixelFor(lon, lat, center, zoom, container);
    await clickMap(page, px);
  }
  await expectVertexCount(page, 4, 5000);

  // Click (no drag, no marker to grab — nothing is drawn on an edge until
  // this press) right on the TOP edge (nw-ne, edge index 0 in the 4-vertex
  // ring), at its midpoint. Must insert a 5th vertex between nw and ne, not
  // append one at the end.
  const topMid: [number, number] = [(nw[0] + ne[0]) / 2, (nw[1] + ne[1]) / 2];
  const topMidPx = pixelFor(topMid[0], topMid[1], center, zoom, container);
  await clickMap(page, topMidPx);
  await expectVertexCount(page, 5, 5000);

  // After that insert the ring is [nw, newTop, ne, se, sw] — the BOTTOM
  // edge (se-sw) is now edge index 3. Press down on its midpoint and drag
  // straight south, away from the square entirely (a plain outward bulge,
  // no diagonal) — must insert a 6th vertex and follow the drag to its
  // released position.
  const bottomMid: [number, number] = [(se[0] + sw[0]) / 2, (se[1] + sw[1]) / 2];
  const bottomMidPx = pixelFor(bottomMid[0], bottomMid[1], center, zoom, container);
  const dragTarget: [number, number] = [bottomMid[0], bottomMid[1] - metersToDegLat(80)];
  const dragEndPx = pixelFor(dragTarget[0], dragTarget[1], center, zoom, container);

  await moveOnMap(page, bottomMidPx);
  await page.mouse.down();
  // Multiple intermediate steps — a single jump can register as a click
  // rather than a drag in some pointer-event implementations.
  await moveOnMap(page, dragEndPx, 10);
  await page.mouse.up();

  await expectVertexCount(page, 6, 5000);
  await page.getByRole("button", { name: "Save site", exact: true }).click();
  await expect(page.getByTestId("boundary-editor-map")).not.toBeVisible();

  // A flight positioned comfortably INSIDE the new south bulge — south of
  // the original square's bottom edge (-120m) entirely, but well short of
  // the dragged-to tip (bottomMid - 80m) to avoid asserting exact-vertex
  // precision the drag gesture doesn't guarantee pixel-for-pixel — should
  // now match, proving the drag-inserted vertex actually reshaped what got
  // saved, not just the on-screen point count. Pre-compensated by the SAME
  // drift subtracted out above, since this second synthetic flight's own
  // detected takeoff will drift away from its raw fed-in coordinates by
  // the same amount the first one did.
  const insideBulge: [number, number] = [bottomMid[0], bottomMid[1] - metersToDegLat(40)];
  await page.goto("/upload");
  await uploadFlight(page, {
    name: "b6mid-2.igc",
    mimeType: "text/plain",
    buffer: remoteFlightIgc(runOffset, insideBulge[1] - driftLat, insideBulge[0] - driftLon, 2),
  });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });
});

test("dragging an EXISTING vertex moves it — it never inserts a new one, even though a vertex sits exactly on two edges", async ({
  page,
}) => {
  const runOffset = Date.now();
  const suffix = `${runOffset}b6vtx`;
  const email = `boundaries_e2e_vertex_${suffix}@test.local`;
  const handle = `b6vx${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

  const anchorLat = 25.5 + (runOffset % 5000) * 0.001;
  const anchorLon = -173.0;

  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  const link = await getMagicLink();
  await page.goto(link);
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Boundaries Vertex E2E Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });

  const siteName = `E2E Vertex Ridge ${suffix}`;
  await arrangeBoundFlight(page, siteName, remoteFlightIgc(runOffset, anchorLat, anchorLon, 1));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName, { timeout: 10_000 });

  await page.locator("h1 button").click();
  await page.getByRole("button", { name: "Edit this site" }).click();
  await page.getByRole("button", { name: "Draw or edit boundary", exact: true }).click();
  const mapLocator = page.getByTestId("boundary-editor-map");
  await mapLocator.waitFor({ timeout: 10_000 });
  const box = await mapLocator.boundingBox();
  if (!box) throw new Error("map container has no bounding box");
  const container = { width: box.width, height: box.height };
  const { zoom, center } = await readMapView(page);

  const nw: [number, number] = [center.lng - metersToDegLon(150, center.lat), center.lat + metersToDegLat(120)];
  const ne: [number, number] = [center.lng + metersToDegLon(150, center.lat), center.lat + metersToDegLat(120)];
  const se: [number, number] = [center.lng + metersToDegLon(150, center.lat), center.lat - metersToDegLat(120)];
  const sw: [number, number] = [center.lng - metersToDegLon(150, center.lat), center.lat - metersToDegLat(120)];
  for (const [lon, lat] of [nw, ne, se, sw]) {
    const px = pixelFor(lon, lat, center, zoom, container);
    await clickMap(page, px);
  }
  await expectVertexCount(page, 4, 5000);

  // Grab the NW vertex MARKER itself (not a nearby edge point) and drag it
  // further out — the marker sits exactly at the meeting point of its two
  // adjacent edges, which is exactly the case the mousedown-based edge
  // detector could misfire on if it weren't excluded by DOM target.
  const nwMarker = page.locator('[data-testid="boundary-vertex"][data-vertex-index="0"]');
  await nwMarker.waitFor({ timeout: 5_000 });
  const nwBox = await nwMarker.boundingBox();
  if (!nwBox) throw new Error("nw vertex marker has no bounding box");
  const startX = nwBox.x + nwBox.width / 2;
  const startY = nwBox.y + nwBox.height / 2;

  // This checks marker dragging, not projection math. A fixed geographic
  // distance can be less than ten pixels at the editor's fitted zoom.
  const endX = startX + 40;
  const endY = startY + 40;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await expectVertexCount(page, 4, 2000); // still 4 mid-press, no insert yet
  await page.mouse.move(endX, endY, { steps: 10 });
  await expectVertexCount(page, 4, 2000); // still 4 mid-drag
  await page.mouse.up();

  // Must STILL be 4 points — the press-and-drag moved the existing vertex,
  // it did not insert a 5th one next to it.
  await expectVertexCount(page, 4, 5000);

  // And the marker must have actually followed the drag to its new spot,
  // not stayed put — confirms this was a real move, not a silent no-op.
  await expect.poll(async () => {
    const movedBox = await nwMarker.boundingBox();
    if (!movedBox) return Infinity;
    return Math.hypot(movedBox.x + movedBox.width / 2 - endX, movedBox.y + movedBox.height / 2 - endY);
  }).toBeLessThan(5);
});
