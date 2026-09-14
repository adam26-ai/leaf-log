import { test, expect, type Page } from "./fixtures";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { DEV_MAGIC_LINK_FILE } from "@/lib/dev-magic-link";
import { createHash } from "node:crypto";
import { makeIgc, makeRealisticFlight } from "../igc/make-igc";
import { logbookEntry, expectReplaySpaceShortcut, expectSiteVisibility, setSiteVisibility, openSiteChooser, uploadFlight, setNewFlightTypes } from "./helpers";
import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import type { XcCandidate } from "@/lib/igc/xc-types";

async function signUp(page: Page) {
  const handle = `polish${Date.now()}`.slice(0, 18);
  rmSync(DEV_MAGIC_LINK_FILE, { force: true });
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

test("tandem wing controls preserve flight overrides and expose the merged default on mobile", async ({ page }) => {
  const handle = await signUp(page);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    const base = { ownerId: owner.id, glider: "Tandem Test Wing", status: "ready", durationS: 900 };
    const inherited = await db.flight.create({ data: base });
    const manual = await db.flight.create({ data: { ...base, occupancy: "solo", tandemOverride: false } });
    await db.flight.create({ data: { ...base, glider: "Solo Test Wing" } });
    await page.goto("/settings");
    const enable = page.getByRole("switch", { name: "Enable tandem" });
    await expect(enable).not.toBeChecked();
    await expect(page.getByRole("switch", { name: "Tandem wing: Tandem Test Wing" })).toHaveCount(0);
    await enable.click();
    const toggle = page.getByRole("switch", { name: "Tandem wing: Tandem Test Wing" });
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => (await db.flight.findUniqueOrThrow({ where: { id: inherited.id } })).occupancy).toBe("tandem");
    expect(await db.flight.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ occupancy: "solo", tandemOverride: false });
    await page.getByRole("checkbox", { name: /Tandem Test Wing, 2 flights/ }).check();
    await page.getByRole("checkbox", { name: /Solo Test Wing, 1 flight/ }).check();
    await expect(page.getByRole("switch", { name: "Merged wing is tandem" })).toBeChecked();
    await page.getByLabel("Merged wing name:").fill("Merged Wing");
    await page.screenshot({ path: "test-results/tandem-wings-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("heading", { name: "Wings", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/tandem-wings-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("switch", { name: "Merged wing is tandem" }).uncheck();
    await page.getByRole("button", { name: "Merge wings", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Tandem wing: Merged Wing" })).toHaveAttribute("aria-checked", "false");
    expect(await db.flight.findUniqueOrThrow({ where: { id: inherited.id } })).toMatchObject({ glider: "Merged Wing", occupancy: "solo", tandemOverride: null });
    await page.getByRole("switch", { name: "Tandem wing: Merged Wing" }).click();
    await expect(page.getByRole("switch", { name: "Tandem wing: Merged Wing" })).toHaveAttribute("aria-checked", "true");
    await enable.click();
    await expect(enable).not.toBeChecked();
    await page.reload();
    await expect(enable).not.toBeChecked();
    expect((await db.profile.findUniqueOrThrow({ where: { id: owner.id } })).tandemWings).toEqual(["Merged Wing"]);
    expect(await db.flight.findUniqueOrThrow({ where: { id: manual.id } })).toMatchObject({ occupancy: "solo", tandemOverride: false });
  } finally {
    const owner = await db.profile.findUnique({ where: { handle } });
    if (owner) await db.user.delete({ where: { id: owner.id } });
    await db.$disconnect();
  }
});

test("site management separates linked flights from matching names and counts each flight once", async ({ page }) => {
  const handle = await signUp(page);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    const site = await db.site.create({ data: { ownerId: owner.id, name: "Ed Levin 1750", normalizedName: "ed levin 1750", kind: "both", lat: 37.4, lon: -121.9, visibility: "private", source: "user" } });
    const different = await db.site.create({ data: { name: site.name, normalizedName: site.normalizedName, kind: "takeoff", lat: 37.4, lon: -121.9, visibility: "public", source: "manual" } });
    const empty = await db.site.create({ data: { ownerId: owner.id, name: "Empty Ridge", normalizedName: "empty ridge", kind: "takeoff", lat: 38, lon: -121, visibility: "private", source: "user" } });
    const base = { ownerId: owner.id, status: "ready", recordingKind: "logbook", source: "csv_import", durationS: 900, glider: "Test Wing", takeoffLat: site.lat, takeoffLon: site.lon };
    const linked = await db.flight.create({ data: { ...base, flightDate: new Date("2026-07-11"), takeoffSiteId: site.id, landingSiteId: site.id } });
    const named = await db.flight.create({ data: { ...base, flightDate: new Date("2012-02-11"), takeoffSiteName: site.name, landingSiteName: site.name, takeoffSiteAssignment: "custom_name", landingSiteAssignment: "custom_name", landingLat: site.lat, landingLon: site.lon } });
    const otherLink = await db.flight.create({ data: { ...base, flightDate: new Date("2011-07-17"), takeoffSiteId: different.id, takeoffSiteName: different.name } });
    await page.goto("/settings/sites");
    const siteRow = page.getByRole("region", { name: "Sites list", exact: true }).getByRole("button")
      .filter({ hasText: "Ed Levin 1750", has: page.getByLabel("Private", { exact: true }) });
    await expect(siteRow).toBeVisible();
    await expect(siteRow.getByLabel("Private", { exact: true })).toBeVisible();
    await expect(siteRow.getByLabel("1 flights", { exact: true })).toHaveText("1");
    await siteRow.click();
    await page.getByRole("button", { name: "Edit site", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Site details" });
    await expect(page.getByText("Add at least 3 points.", { exact: true })).toBeHidden();
    await editor.getByRole("button", { name: "Draw or edit boundary", exact: true }).click();
    await expect(page.getByText("Add at least 3 points.", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "Place or move pin", exact: true }).click();
    await expect(page.getByText("Add at least 3 points.", { exact: true })).toBeHidden();
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    const flights = page.getByRole("region", { name: /Flights at this site/ });
    await expect(flights.getByRole("listitem")).toHaveCount(1);
    await expect(flights.getByText("Takeoff and landing · Uses this site")).toBeVisible();
    await expect(flights.getByRole("link", { name: /View flight/ })).toHaveAttribute("href", `/flights/${linked.id}`);
    await flights.getByRole("button", { name: /Flights at this site/ }).click();
    await expect(flights.getByRole("list")).toBeHidden();
    await flights.getByRole("button", { name: /Flights at this site/ }).click();
    await expect(flights.getByRole("listitem")).toHaveCount(1);
    const review = page.getByRole("region", { name: "Review matching flights", exact: true });
    await review.getByRole("button", { name: "Find matching flights" }).click();
    await expect(review.getByText("2 matching flights", { exact: true })).toBeVisible();
    await expect(review.getByRole("listitem")).toHaveCount(2);
    await expect(review.getByText("2026-07-11", { exact: true })).toHaveCount(0);
    const namedRow = review.getByRole("listitem").filter({ hasText: "2012-02-11" });
    await expect(namedRow.getByText("Location needs review", { exact: true })).toHaveCount(2);
    await expect(namedRow.getByRole("checkbox")).toHaveCount(2);
    const otherRow = review.getByRole("listitem").filter({ hasText: "2011-07-17" });
    await expect(otherRow.getByText(different.name, { exact: true })).toBeVisible();
    await expect(otherRow.getByText("Location needs review", { exact: true })).toHaveCount(0);
    await expect(otherRow.getByText(/different site with the same name/)).toBeVisible();
    await namedRow.getByRole("checkbox").first().check();
    await namedRow.getByRole("checkbox").last().check();
    await expect(review.getByRole("button", { name: "Assign site to 1 selected flight", exact: true })).toBeEnabled();
    await page.screenshot({ path: "test-results/site-management-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await review.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/site-management-mobile.png", fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await review.getByRole("button", { name: "Select all on this page" }).click();
    await review.getByRole("button", { name: "Assign site to 2 selected flights", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Ed Levin 1750 assigned to 2 flights." })).toBeVisible();
    await expect(siteRow.getByLabel("3 flights", { exact: true })).toHaveText("3");
    await expect(flights.getByRole("listitem")).toHaveCount(3);
    await expect(review.getByRole("listitem")).toHaveCount(0);
    await expect(review.getByText(/No additional flights match/)).toBeVisible();
    expect(await db.flight.findUniqueOrThrow({ where: { id: named.id } })).toMatchObject({ takeoffSiteId: site.id, landingSiteId: site.id, takeoffLat: site.lat, landingLat: site.lat, durationS: 900 });
    expect(await db.flight.findUniqueOrThrow({ where: { id: otherLink.id } })).toMatchObject({ takeoffSiteId: site.id });
    const emptyRow = page.getByRole("region", { name: "Sites list", exact: true }).getByRole("button").filter({ hasText: empty.name });
    await expect(emptyRow.getByLabel("0 flights", { exact: true })).toHaveText("0");
    await emptyRow.click();
    await expect(flights.getByText(/No flights use this site yet/)).toBeVisible();
    await expect(flights.getByRole("listitem")).toHaveCount(0);
    await siteRow.click();
    await expect(flights.getByRole("listitem")).toHaveCount(3);
    await page.reload();
    await expect(flights.getByRole("listitem")).toHaveCount(3);
    // Review pages retain selections, with the button counting distinct flights across pages.
    await db.flight.createMany({ data: Array.from({ length: 26 }, () => ({ ...base, flightDate: new Date("2010-01-01"), takeoffSiteName: site.name })) });
    await review.getByRole("button", { name: "Find matching flights" }).click();
    await expect(review.getByRole("listitem")).toHaveCount(25);
    await review.getByRole("checkbox").first().check();
    await review.getByRole("button", { name: "Next matches" }).click();
    await expect(review.getByRole("listitem")).toHaveCount(1);
    await review.getByRole("checkbox").check();
    await expect(review.getByRole("button", { name: "Assign site to 2 selected flights", exact: true })).toBeEnabled();
    await review.getByRole("button", { name: "Previous matches" }).click();
    await expect(review.getByRole("checkbox").first()).toBeChecked();
  } finally { await db.$disconnect(); }
});

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
    await chooser.dialog.getByRole("button", { name: "Create site", exact: true }).click();
    await chooser.dialog.getByRole("button", { name: "Save site", exact: true }).click();
    await expect(page.locator("h1")).toHaveText("Delayed lookup hill");
    expect((await db.flight.findUniqueOrThrow({ where: { id: flight.id }, include: { takeoffSite: true } })).takeoffSite?.name).toBe("Delayed lookup hill");
  } finally { await db.$disconnect(); }
});

test("CSV site names use the full editor and keep their identity and flight coordinates", async ({ page }) => {
  test.setTimeout(120000);
  const handle = await signUp(page);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    const flight = await db.flight.create({ data: { ownerId: owner.id, status: "ready", recordingKind: "logbook", source: "csv_import", flightDate: new Date("2024-07-13"), takeoffSiteName: "CSV Hill", notes: "Keep this memory", durationS: 900 } });
    await page.goto(`/flights/${flight.id}`);
    await page.locator("h1 button").click();
    const dialog = page.getByRole("dialog", { name: "Site details" });
    await expect(dialog.getByText("Name only", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Edit this site", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Draw or edit boundary" })).toBeVisible();
    await expectSiteVisibility(dialog, "private");
    await dialog.getByLabel("Name", { exact: true }).fill("Remembered Hill");
    await dialog.getByLabel("Pin latitude", { exact: true }).fill("37.6");
    await dialog.getByLabel("Pin longitude", { exact: true }).fill("-122.4");
    await dialog.getByRole("button", { name: "Save site", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("h1")).toHaveText("Remembered Hill");
    const mapped = await db.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(mapped).toMatchObject({ takeoffLat: null, takeoffLon: null, notes: "Keep this memory" });
    expect(mapped.takeoffSiteId).toBeTruthy();
    await expect(page.getByText("Site location; takeoff position not recorded.")).toBeVisible();
    await page.goto("/settings/sites");
    await page.getByRole("button", { name: "Edit site", exact: true }).click();
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Remembered Hill");
    await dialog.getByRole("button", { name: "Draw or edit boundary" }).click();
    const map = dialog.getByTestId("boundary-editor-map");
    await expect(map.locator("canvas")).toBeVisible();
    const box = await map.boundingBox();
    for (const [x, y] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]) await map.locator("canvas").click({ position: { x: box!.width * x, y: box!.height * y } });
    await expect(dialog.getByTestId("boundary-vertex")).toHaveCount(4);
    await setSiteVisibility(dialog, "public");
    await dialog.getByRole("button", { name: "Save site", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const site = await db.site.findUniqueOrThrow({ where: { id: mapped.takeoffSiteId! } });
    expect(site.boundary).not.toBeNull(); expect(site.visibility).toBe("public");
    await page.getByRole("button", { name: "Edit site", exact: true }).click();
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Remembered Hill");
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByLabel("Name", { exact: true }).fill("Discard this edit");
    await page.screenshot({ path: "test-results/unified-site-editor-mobile.png" });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await db.site.findUniqueOrThrow({ where: { id: site.id } })).name).toBe("Remembered Hill");
    expect((await db.flight.findUniqueOrThrow({ where: { id: flight.id } })).takeoffSiteId).toBe(site.id);
  } finally { await db.$disconnect(); }
});

test("IGC upload and editing save multiple flight types without changing an exact duplicate", async ({ page }) => {
  const handle = await signUp(page);
  const db = new PrismaClient();
  const file = { name: "typed-flight.igc", mimeType: "text/plain", buffer: Buffer.from(makeRealisticFlight().igc) };
  try {
    await page.goto("/upload");
    await setNewFlightTypes(page, ["Tandem", "SIV", "Competition", "Tow"]);
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
    await setNewFlightTypes(page, ["Tandem"]);
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
    const recordedIgc = makeIgc({ glider: "Test Wing", fixes: Array.from({ length: 12 }, (_, index) => ({
      tSec: 36000 + index * 10, lat: 37.6685 + index * 0.001, lon: -122.4936, baro: 500 + index * 10,
    })) });
    await uploadFlight(page, { name: "found.igc", mimeType: "text/plain", buffer: Buffer.from(recordedIgc) });
    await expect(page.getByText("Overlapping flight found")).toBeVisible();
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await expect(page.getByRole("rowheader", { name: "Recorder ID" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Start time" })).toBeVisible();
    await page.getByRole("button", { name: "Add uploaded IGC to this flight" }).click();
    await expect(page).toHaveURL(`/flights/${entry.id}`);
    await expect.poll(async () => (await db.flight.findUniqueOrThrow({ where: { id: entry.id } })).xcStatus, { timeout: 45000 }).not.toMatch(/queued|processing|repairing|improving/);
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
    const trophy = page.getByRole("button", { name: /Gold.*FAI triangle/ });
    await trophy.hover();
    const tooltip = trophy.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    const trophyBox = (await trophy.boundingBox())!;
    const tooltipBox = (await tooltip.boundingBox())!;
    expect(tooltipBox.y).toBeGreaterThanOrEqual(trophyBox.y + trophyBox.height);
    expect(tooltipBox.x).toBeGreaterThanOrEqual(trophyBox.x);
    expect(await tooltip.evaluate(element => {
      const previous = element.style.pointerEvents;
      element.style.pointerEvents = "auto";
      const box = element.getBoundingClientRect();
      const unobscured = element.contains(document.elementFromPoint(box.x + box.width / 2, box.bottom - 5));
      element.style.pointerEvents = previous;
      return unobscured;
    })).toBe(true);


    await expect(page.getByLabel("SIV", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/replay-trophies.png", fullPage: true });
    expect(await db.flight.count({ where: { ownerId: owner.id } })).toBe(1);
    expect((await db.flight.findUniqueOrThrow({ where: { id: entry.id } })).notes).toBe("Original notes");
    await expectReplaySpaceShortcut(page);
  } finally { await db.$disconnect(); }
});

test("logbook calculation notice disappears after automatic refresh and stays absent after reload", async ({ page }) => {
  // Keep the simulated refresh timer out of replay's WebGL animation loop.
  await page.clock.install();
  const handle = await signUp(page);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    // Four valid fixes exercise the real queue and finish with no eligible route,
    // without making a UI lifecycle assertion depend on the XC search budget.
    const shortIgc = Buffer.from(makeIgc({ fixes: Array.from({ length: 4 }, (_, index) => ({
      tSec: 36000 + index * 10, lat: 37.8 + index * 0.001, lon: -122.5, baro: 500 + index * 10,
    })) }));
    const pendingEntry = await db.flight.create({ data: {
      ownerId: owner.id, status: "ready", recordingKind: "igc", xcStatus: "unscored", metricsVersion: METRICS_VERSION,
      igcSha256: createHash("sha256").update(shortIgc).digest("hex"), data: { create: { rawIgc: shortIgc } },
    } });
    await page.goto("/logbook");
    const row = logbookEntry(page, pendingEntry.id);
    await row.getByRole("button", { name: "Calculate XC", exact: true }).click();
    await expect(page).toHaveURL(/\/logbook$/);
    await expect.poll(async () => (await db.flight.findUniqueOrThrow({ where: { id: pendingEntry.id } })).xcStatus).toBe("empty");
    // Exercise the five-second automatic refresh without racing the default
    // five-second assertion deadline against that same timer.
    await expect.poll(async () => {
      await page.clock.fastForward(5000);
      return row.locator("[data-flight-analysis]").count();
    }).toBe(0);
    await page.reload();
    await expect(row.locator("[data-flight-analysis]")).toHaveCount(0);

  } finally { await db.$disconnect(); }
});
