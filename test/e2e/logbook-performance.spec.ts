import { test, expect } from "./fixtures";
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { DEV_MAGIC_LINK_FILE } from "@/lib/dev-magic-link";
import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import { openAdvancedLogbook, measureLogbookSelection } from "./helpers";

// A representative large logbook, using the real production React build.
// Record timings rather than asserting machine-dependent millisecond budgets.
test("large logbook selection stays local and preserves edits across filters", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const handle = `perf${Date.now()}`;
  rmSync(DEV_MAGIC_LINK_FILE, { force: true });
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(`${handle}@test.local`);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  await expect.poll(() => existsSync(DEV_MAGIC_LINK_FILE) && readFileSync(DEV_MAGIC_LINK_FILE, "utf8").startsWith("http")).toBeTruthy();
  await page.goto(readFileSync(DEV_MAGIC_LINK_FILE, "utf8").trim());
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Performance Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook$/);
  const db = new PrismaClient();
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle } });
    await db.flight.createMany({ data: Array.from({ length: 500 }, (_, i) => ({
      ownerId: owner.id, visibility: "private", recordingKind: "logbook", source: "manual_entry",
      status: "ready", xcStatus: "not_recorded", metricsVersion: METRICS_VERSION,
      flightDate: new Date(Date.UTC(2026, 9, 29 - i)), glider: i % 2 ? "Wing B" : "Wing A",
      takeoffSiteName: "Tiger Mountain", durationS: 3600, maxAltM: 1500, maxClimbMs: 4,
    })) });
    await page.goto("/logbook");
    const start = Date.now();
    const editor = await openAdvancedLogbook(page);
    await expect(editor.getByRole("listitem")).toHaveCount(500);
    const readyMs = Date.now() - start;
    const writes: string[] = [];
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    const timings = await measureLogbookSelection(editor);
    await expect(editor.getByText("5 selected", { exact: true })).toBeVisible();
    expect(writes).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("large-logbook.png"), fullPage: true });
    await testInfo.attach("performance", { body: JSON.stringify({ flights: 500, readyMs, clickToPaintMs: timings }), contentType: "application/json" });
    await editor.getByRole("button", { name: "Edit selected Notes", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Notes", exact: true }).fill("Performance draft");
    await dialog.getByRole("button", { name: "Add to draft", exact: true }).click();
    await editor.getByRole("button", { name: "Select Wings", exact: true }).click();
    await page.getByRole("group", { name: "Wings choices" }).getByRole("checkbox", { name: "Wing B", exact: true }).uncheck();
    await page.keyboard.press("Escape");
    await expect(editor.getByRole("listitem")).toHaveCount(250);
    await editor.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(editor.getByRole("listitem")).toHaveCount(500);
    await expect(editor.getByText("5 unsaved changes", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "Discard draft", exact: true }).click();
    await expect(editor.getByText("No unsaved changes", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "Done editing", exact: true }).click();
    await expect(page).toHaveURL(/\/logbook$/);
    await page.goto("/settings");
    const cachePanel = page.getByRole("heading", { name: "Maps saved on this device", exact: true }).locator("..");
    await expect(cachePanel.getByRole("button", { name: "Clear saved maps", exact: true })).toBeEnabled();
    await page.evaluate(async () => {
      for (const name of ["leaf-map-tiles-v1", "leaf-map-metadata-v1"]) await (await caches.open(name)).put("https://tiles.openfreemap.org/planet-test/1/1/1.pbf", new Response("test cache entry"));
    });
    await cachePanel.screenshot({ path: testInfo.outputPath("map-cache-settings.png") });
    await cachePanel.getByRole("button", { name: "Clear saved maps", exact: true }).click();
    await expect(cachePanel.getByRole("status")).toContainText("Saved maps cleared");
    expect(await page.evaluate(() => caches.keys())).not.toContain("leaf-map-tiles-v1");
    expect(await page.evaluate(() => caches.keys())).not.toContain("leaf-map-metadata-v1");
  } finally { await db.$disconnect(); }
});
