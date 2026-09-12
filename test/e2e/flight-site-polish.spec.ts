import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { DEV_MAGIC_LINK_FILE } from "@/lib/dev-magic-link";
import { makeRealisticFlight } from "../igc/make-igc";
import { openSiteChooser, uploadFlight } from "./helpers";
import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import type { XcCandidate } from "@/lib/igc/xc-types";

async function signUp(page: Page) {
  const handle = `polish${Date.now()}`.slice(0, 18);
  rmSync(DEV_MAGIC_LINK_FILE, { force: true });
  await page.route("**/tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route("**/api.maptiler.com/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(`${handle}@test.local`);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect.poll(() => existsSync(DEV_MAGIC_LINK_FILE) && readFileSync(DEV_MAGIC_LINK_FILE, "utf8").startsWith("http")).toBe(true);
  await page.goto(readFileSync(DEV_MAGIC_LINK_FILE, "utf8").trim());
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Test Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/);
  return handle;
}

test("site naming waits for delayed details before enabling the form", async ({ page }) => {
  const handle = await signUp(page);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    const flight = await db.flight.create({ data: { ownerId: owner.id, status: "ready", recordingKind: "logbook", source: "manual", flightDate: new Date("2024-07-13"), durationS: 900 } });
    await page.goto(`/flights/${flight.id}`);
    // Hold the actual dialog lookup beyond the former five-second deadline.
    let delayedRequests = 0;
    await page.route(`**/flights/${flight.id}`, async route => {
      const request = route.request();
      if (request.method() === "POST" && request.postData()?.includes('"takeoff"')) {
        delayedRequests++;
        await new Promise(resolve => setTimeout(resolve, 6_000));
      }
      await route.continue();
    });
    const opening = openSiteChooser(page);
    const dialog = page.getByRole("dialog", { name: "Site details" });
    await expect(dialog.getByText("Loading site details...")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    const chooser = await opening;
    expect(delayedRequests).toBeGreaterThan(0);
    await page.unroute(`**/flights/${flight.id}`);
    await chooser.name.fill("Delayed lookup hill");
    await chooser.dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Delayed lookup hill");
    expect((await db.flight.findUniqueOrThrow({ where: { id: flight.id } })).takeoffSiteName).toBe("Delayed lookup hill");
  } finally { await db.$disconnect(); }
});

test("CSV site names can be edited, linked, and mapped using one boundary editor", async ({ page }) => {
  test.setTimeout(120000);
  const handle = await signUp(page);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    const site = await db.site.create({ data: { ownerId: owner.id, name: "Mapped Hill", normalizedName: "mapped hill", kind: "takeoff", lat: 37.6, lon: -122.4, visibility: "private", source: "user" } });
    const flight = await db.flight.create({ data: { ownerId: owner.id, status: "ready", recordingKind: "logbook", source: "csv_import", flightDate: new Date("2024-07-13"), takeoffSiteName: "CSV Hill", notes: "Keep this memory", durationS: 900 } });
    await page.goto(`/flights/${flight.id}`);
    await page.locator("h1 button").click();
    const dialog = page.getByRole("dialog", { name: "Site details" });
    await expect(dialog.getByText(/saved site name/)).toBeVisible();
    await expect(dialog.getByText(/Loading site details/)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Edit this site", exact: true }).click();
    await dialog.getByRole("textbox").fill("Remembered Hill");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Remembered Hill");
    await page.locator("h1 button").click();
    await dialog.getByRole("button", { name: "Choose a different site" }).click();
    await dialog.getByRole("listitem").filter({ hasText: "Mapped Hill" }).getByRole("button", { name: "Use this site" }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator("h1 button").click();
    await expect(dialog.getByTestId("site-area-map").locator("canvas")).toBeVisible();
    await dialog.getByRole("button", { name: "Satellite", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Satellite", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.getByRole("button", { name: "Edit this site" })).toBeInViewport();
    await page.screenshot({ path: "test-results/site-overview-mobile.png" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/settings/sites");
    await page.getByRole("button", { name: /Mapped Hill/ }).click();
    const map = page.getByTestId("boundary-editor-map");
    await expect(map.locator("canvas")).toBeVisible();
    const originalCanvas = await map.locator("canvas").elementHandle();
    await page.getByRole("button", { name: "Draw boundary", exact: true }).click();
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);
    const box = await map.boundingBox();
    const points = [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]];
    for (const [x, y] of points) await map.locator("canvas").click({ position: { x: box!.width * x, y: box!.height * y } });
    await expect(page.getByTestId("boundary-vertex")).toHaveCount(4);
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.getByTestId("boundary-vertex")).toHaveCount(4);
    expect(await originalCanvas!.evaluate(element => element.isConnected)).toBe(true);
    await page.getByRole("button", { name: "Save boundary", exact: true }).click();
    await expect.poll(async () => (await db.site.findUniqueOrThrow({ where: { id: site.id } })).boundary).not.toBeNull();
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);
    await page.screenshot({ path: "test-results/site-editor-desktop.png", fullPage: true });
    expect(await db.flight.findUniqueOrThrow({ where: { id: flight.id } })).toMatchObject({ notes: "Keep this memory", takeoffSiteId: site.id, takeoffLat: null });
    // A different name on a coordinate-free flight must detach that flight,
    // without renaming the shared mapped site it used to reference.
    await page.goto(`/flights/${flight.id}`);
    await page.locator("h1 button").click();
    await dialog.getByRole("button", { name: "Choose a different site" }).click();
    await dialog.getByPlaceholder("e.g. Sonoma Ridge").fill("Another remembered hill");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Another remembered hill");
    expect(await db.flight.findUniqueOrThrow({ where: { id: flight.id } })).toMatchObject({ takeoffSiteId: null, notes: "Keep this memory" });
    expect((await db.site.findUniqueOrThrow({ where: { id: site.id } })).name).toBe("Mapped Hill");
  } finally { await db.$disconnect(); }
});

test("IGC upload and editing save multiple flight types without changing an exact duplicate", async ({ page }) => {
  const handle = await signUp(page);
  const db = new PrismaClient();
  const file = { name: "typed-flight.igc", mimeType: "text/plain", buffer: Buffer.from(makeRealisticFlight().igc) };
  try {
    await page.goto("/upload");
    for (const name of ["Tandem", "SIV", "Competition", "Tow"]) await page.getByRole("checkbox", { name, exact: true }).first().check();
    await uploadFlight(page, file);
    await expect(page).toHaveURL(/\/flights\/[a-z0-9]+$/);
    const id = page.url().split("/").at(-1)!;
    expect(await db.flight.findUniqueOrThrow({ where: { id } })).toMatchObject({ flightFlags: ["tandem", "siv", "competition", "tow"], occupancy: "tandem", launchTypes: ["ST"] });
    await page.getByRole("link", { name: "Edit flight", exact: true }).click();
    for (const name of ["Tandem", "Tow"]) await page.getByRole("checkbox", { name, exact: true }).uncheck();
    await page.getByRole("button", { name: "Save flight type" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Tandem", exact: true })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "SIV", exact: true })).toBeChecked();
    await page.goto("/upload");
    await page.getByRole("checkbox", { name: "Tandem", exact: true }).first().check();
    await uploadFlight(page, file);
    await expect(page.getByText("Already uploaded", { exact: false })).toBeVisible();
    expect(await db.flight.findUniqueOrThrow({ where: { id } })).toMatchObject({ flightFlags: ["siv", "competition"], occupancy: "solo", launchTypes: [] });
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    expect(await db.flight.count({ where: { ownerId: owner.id } })).toBe(1);
    await db.profile.update({ where: { id: owner.id }, data: { ratingsTrackingEnabled: true } });
    await page.goto(`/flights/${id}/edit`);
    await page.getByRole("radio", { name: "Tandem", exact: true }).check();
    await page.locator('input[name="launchTypes"][value="ST"]').check();
    await page.getByRole("button", { name: "Save flight details", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Tandem", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Tow", exact: true })).toBeChecked();
    expect((await db.flight.findUniqueOrThrow({ where: { id } })).flightFlags).toEqual(["siv", "competition", "tandem", "tow"]);
    await page.getByRole("checkbox", { name: "Tandem", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Tow", exact: true }).uncheck();
    await page.getByRole("button", { name: "Save flight type", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Solo", exact: true })).toBeChecked();
    await expect(page.locator('input[name="launchTypes"][value="ST"]')).not.toBeChecked();
    expect((await db.flight.findUniqueOrThrow({ where: { id } })).flightFlags).toEqual(["siv", "competition"]);
  } finally { await db.$disconnect(); }
});

test("hidden wings keep their hours and disappear from new and recorded flight selections", async ({ page }) => {
  test.setTimeout(90000);
  const handle = await signUp(page);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    const flight = await db.flight.create({ data: { ownerId: owner.id, status: "ready", recordingKind: "igc", glider: "Retired wing", durationS: 9000 } });
    await db.flight.create({ data: { ownerId: owner.id, status: "ready", recordingKind: "logbook", glider: "Current wing", durationS: 1800, flightDate: new Date("2020-01-01") } });
    await page.goto("/settings");
    await expect(page.getByText(/1 flight.*2.5 h/)).toBeVisible();
    await page.getByRole("button", { name: "Hide Retired wing in flight selections" }).click();
    await expect(page.getByRole("button", { name: "Show Retired wing in flight selections" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Show Retired wing in flight selections" })).toBeVisible();
    await page.screenshot({ path: "test-results/settings-wings.png", fullPage: true });
    await page.goto(`/flights/${flight.id}/edit`);
    await expect(page.getByLabel("Wing name")).toHaveValue("Retired wing");
    await expect(page.getByLabel("Choose a previous wing").locator("option", { hasText: "Retired wing" })).toHaveCount(0);
    await page.goto("/upload");
    await expect(page.locator('datalist option[value="Retired wing"]')).toHaveCount(0);
    await page.getByLabel("Flight date", { exact: true }).fill("2026-09-12");
    const manual = page.locator("form").filter({ has: page.getByRole("button", { name: "Add manual flight" }) });
    for (const name of ["Tandem", "SIV", "Competition", "Tow"]) await manual.getByRole("checkbox", { name, exact: true }).check();
    await manual.getByRole("button", { name: "Add manual flight" }).click();
    await expect(page).toHaveURL(/\/flights\/[a-z0-9]+$/);
    const id = page.url().split("/").at(-1)!;
    expect((await db.flight.findUniqueOrThrow({ where: { id } })).flightFlags).toEqual(["tandem", "siv", "competition", "tow"]);
    await page.getByRole("link", { name: "Edit flight", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Tow", exact: true })).toBeChecked();
    await page.getByRole("checkbox", { name: "Tow", exact: true }).uncheck();
    await page.getByRole("button", { name: "Save flight details" }).click();
    await expect(page).toHaveURL(`/flights/${id}`);
    expect((await db.flight.findUniqueOrThrow({ where: { id } })).launchTypes).not.toContain("ST");
  } finally { await db.$disconnect(); }
});

test("duplicate upload attaches to the original entry and replay cycles scored routes and trophies", async ({ page }) => {
  test.setTimeout(120000);
  const handle = await signUp(page);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    const entry = await db.flight.create({ data: { ownerId: owner.id, status: "ready", recordingKind: "logbook", source: "csv_import", flightDate: new Date("2024-07-12"), glider: "Test Wing", durationS: 400, notes: "Original notes", flightFlags: ["siv", "competition"] } });
    await page.goto("/upload");
    await uploadFlight(page, { name: "found.igc", mimeType: "text/plain", buffer: Buffer.from(makeRealisticFlight().igc) });
    await expect(page.getByText("Overlapping flight found")).toBeVisible();
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.getByRole("rowheader", { name: "Recorder ID" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Start time" })).toBeVisible();
    await page.getByRole("button", { name: "Add uploaded IGC to this flight" }).click();
    await expect(page).toHaveURL(`/flights/${entry.id}`);
    await expect.poll(async () => (await db.flight.findUniqueOrThrow({ where: { id: entry.id } })).xcStatus, { timeout: 45000 }).not.toMatch(/queued|scoring/);
    const point = (lat: number, lon: number) => ({ lat, lon, timeMs: 1720785600000 });
    const makeRoute = (shape: XcCandidate["shape"], name: string, distanceM: number): XcCandidate => ({ shape, name, distanceM, points: distanceM / 1000, optimal: true, multiplier: 1, closingGapM: 0, vertices: [point(37.6685, -122.4936), point(37.67, -122.48), point(37.66, -122.47)], start: null, finish: null });
    const open = makeRoute("open", "Open distance", 12000), fai = makeRoute("fai-triangle", "FAI triangle", 8000), free = makeRoute("free-triangle", "Free triangle", 9000);
    await db.flight.update({ where: { id: entry.id }, data: { metricsVersion: METRICS_VERSION, xcStatus: "ready", xcScore: JSON.parse(JSON.stringify({ version: 1, rules: "XContest", approximate: false, best: open, candidates: [open, fai, free] })) } });
    await page.reload();
    const map = page.locator(".flight-replay-map");
    await expect(map).toHaveAttribute("data-scored-route", "hidden");
    const metric = page.getByTitle(/credited distance/);
    for (const [shape, name] of [["open", "Open distance"], ["fai-triangle", "FAI triangle"], ["free-triangle", "Free triangle"], ["hidden", "Open distance"]]) {
      await metric.click();
      await expect(map).toHaveAttribute("data-scored-route", shape);
      await expect(metric).toHaveAttribute("title", new RegExp(name));
    }
    await page.getByRole("button", { name: /Gold.*FAI triangle/ }).click();
    await expect(map).toHaveAttribute("data-scored-route", "fai-triangle");
    await expect(metric).toHaveAttribute("title", /FAI triangle/);
    await expect(page.getByLabel("SIV", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/replay-trophies.png", fullPage: true });
    expect(await db.flight.count({ where: { ownerId: owner.id } })).toBe(1);
    expect((await db.flight.findUniqueOrThrow({ where: { id: entry.id } })).notes).toBe("Original notes");
  } finally { await db.$disconnect(); }
});
