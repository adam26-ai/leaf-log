import { test, expect, type Locator, type Page } from "./fixtures";
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { DEV_MAGIC_LINK_FILE } from "@/lib/dev-magic-link";
import { openSitesPage, setMapContextLost, waitForMapReady } from "./helpers";
import sharp from "sharp";

async function installRasterTiles(page: Page) {
  // Read actual draw pixels inside the frame, before the browser discards its
  // non-preserved WebGL buffer, independently of screenshot compositing.
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    const observed = new WeakSet<HTMLCanvasElement>();
    window.requestAnimationFrame = callback => requestFrame(time => {
      callback(time);
      const map = document.querySelector<HTMLElement>('[data-testid="site-browser-map"]');
      const canvas = map?.querySelector("canvas");
      const gl = canvas?.getContext("webgl2");
      if (!map || !canvas || !gl || gl.isContextLost() || gl.getParameter(gl.FRAMEBUFFER_BINDING) !== null) return;
      if (!observed.has(canvas)) {
        observed.add(canvas);
        canvas.addEventListener("webglcontextlost", () => { delete map.dataset.rasterSamples; });
      }
      const samples: number[][] = [];
      for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]]) {
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(gl.drawingBufferWidth * x), Math.floor(gl.drawingBufferHeight * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        samples.push([...pixel]);
      }
      map.dataset.rasterSamples = JSON.stringify(samples);
    });
  });
  const tile = await sharp({ create: { width: 256, height: 256, channels: 3,
    background: { r: 37, g: 137, b: 91 },
  } }).png().toBuffer();
  await page.route("https://tiles.openfreemap.org/styles/**", route => route.fulfill({ json: {
    version: 8, sources: { fixture: { type: "raster", tileSize: 256,
      tiles: ["https://tiles.openfreemap.org/context-fixture/{z}/{x}/{y}.png"],
    } }, layers: [{ id: "fixture", type: "raster", source: "fixture", paint: { "raster-fade-duration": 0 } }],
  } }));
  await page.route("https://tiles.openfreemap.org/context-fixture/**", route => route.fulfill({ contentType: "image/png", body: tile }));
}

async function expectRasterTiles(map: Locator) {
  await expect.poll(async () => {
    const samples: number[][] = JSON.parse(await map.getAttribute("data-raster-samples") ?? "[]");
    return samples.filter(([r, g, b, a]) => Math.abs(r - 37) < 8 && Math.abs(g - 137) < 8 && Math.abs(b - 91) < 8 && a === 255).length;
  }, { message: "Raster tiles must be drawn by the real WebGL renderer" }).toBe(5);
}

async function signUp(page: Page, name: string) {
  const handle = `ctx${Date.now()}`.slice(0, 18);
  rmSync(DEV_MAGIC_LINK_FILE, { force: true });
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(`${handle}@test.local`);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  await expect.poll(() => existsSync(DEV_MAGIC_LINK_FILE)).toBe(true);
  await page.goto(readFileSync(DEV_MAGIC_LINK_FILE, "utf8").trim());
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill(name);
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/);
  return handle;
}

async function upload(page: Page) {
  const response = await page.request.post("/api/upload", { multipart: { files: {
    name: "context.igc", mimeType: "text/plain", buffer: readFileSync("test/e2e/.fixture.igc"),
  } } });
  expect(response.ok()).toBe(true);
  const { results } = await response.json();
  expect(results[0]).toMatchObject({ status: "ready", deduped: false });
  return results[0].flightId as string;
}

test("friend takeoff avatars remain usable during WebGL context loss and restore the selected replay", async ({ page, newContext }) => {
  const handle = await signUp(page, "Context Pilot");
  const flightId = await upload(page);
  const friendPage = await (await newContext()).newPage();
  const friendHandle = await signUp(friendPage, "Context Friend");
  const friendFlightId = await upload(friendPage);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    const friend = await db.profile.findUniqueOrThrow({ where: { handle: friendHandle } });
    // Avoid initial Follow-camera movement consuming the software renderer's
    // budget. Real takeoff avatar clicks still enter Follow for pilot selection.
    await db.profile.update({ where: { id: owner.id }, data: { mapDefaults: { camera: "fixed" } } });
    await db.flight.update({ where: { id: friendFlightId }, data: { visibility: "friends" } });
    await db.friendship.create({ data: { requesterId: owner.id, addresseeId: friend.id, status: "accepted" } });
    await friendPage.close();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/flights/${flightId}`);
    const map = page.locator(".flight-replay-map");
    await waitForMapReady(map);
    await expect(page.getByRole("button", { name: /^Camera: Fixed/ })).toBeVisible();
    const avatar = page.locator(`[data-takeoff-flight="${friendFlightId}"]`);
    await expect(avatar).toBeEnabled();
    await avatar.click();
    await expect(page.getByRole("button", { name: "Follow Context Friend", exact: true })).toHaveAttribute("aria-pressed", "true");
    await setMapContextLost(map, true);
    await page.locator(`[data-takeoff-flight="${flightId}"]`).click();
    await expect(page.getByRole("button", { name: "Follow Context Pilot", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
    await avatar.click();
    await setMapContextLost(map, false);
    await waitForMapReady(map);
    await expect(page.getByRole("button", { name: /^Camera: Follow/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Follow Context Friend", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  } finally { await db.$disconnect(); }
});

test("site map selection remains usable during WebGL context loss and redraws after restoration", async ({ page }) => {
  await installRasterTiles(page);
  const handle = await signUp(page, "Context Site Pilot");
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    const first = await db.site.create({ data: { ownerId: owner.id, name: "Context first ridge", normalizedName: "context first ridge", lat: 35, lon: 15, visibility: "private" } });
    const second = await db.site.create({ data: { ownerId: owner.id, name: "Context second ridge", normalizedName: "context second ridge", lat: 35.01, lon: 15.01, visibility: "private" } });
    await db.flight.create({ data: { ownerId: owner.id, status: "ready", takeoffLat: 35, takeoffLon: 15 } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openSitesPage(page);
    const map = page.getByTestId("site-browser-map");
    await expectRasterTiles(map);
    await setMapContextLost(map, true);
    await map.getByRole("button", { name: `Select ${second.name}`, exact: true }).click();
    await expect(page.getByRole("heading", { name: second.name, exact: true })).toBeVisible();
    await page.getByRole("region", { name: "Sites list" }).getByRole("button", { name: new RegExp(first.name) }).click();
    await expect(page.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    await setMapContextLost(map, false);
    await waitForMapReady(map);
    await expectRasterTiles(map);
    const pin = map.getByRole("button", { name: `Select ${second.name}`, exact: true });
    const beforeZoom = (await pin.boundingBox())!;
    await map.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(async () => Math.abs((await pin.boundingBox())!.x - beforeZoom.x)).toBeGreaterThan(5);
    await waitForMapReady(map);
    const beforePan = (await pin.boundingBox())!;
    const canvas = (await map.locator("canvas").boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height - 60);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2 + 60, canvas.y + canvas.height - 60, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.abs((await pin.boundingBox())!.x - beforePan.x)).toBeGreaterThan(30);
    await pin.click();
    await expect(page.getByRole("heading", { name: second.name, exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await db.$disconnect(); }
});
