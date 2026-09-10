import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { DEV_MAGIC_LINK_FILE } from "@/lib/dev-magic-link";
import { METRICS_VERSION } from "@/lib/flights/analysis-state";

test("logbook filters survive navigation and deletion, with responsive individual trophies", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString();
  const handle = `filters${suffix}`.slice(0, 24);
  rmSync(DEV_MAGIC_LINK_FILE, { force: true });
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(`${handle}@test.local`);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  await expect.poll(() => existsSync(DEV_MAGIC_LINK_FILE) && readFileSync(DEV_MAGIC_LINK_FILE, "utf8").startsWith("http")).toBeTruthy();
  await page.goto(readFileSync(DEV_MAGIC_LINK_FILE, "utf8").trim());
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Filter Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/);
  const prisma = new PrismaClient();
  try {
    const profile = await prisma.profile.findUniqueOrThrow({ where: { handle } });
    const candidates = ["open", "fai-triangle", "free-triangle"].map(shape => ({ shape, distanceM: 10000, optimal: true }));
    const flight = await prisma.flight.create({ data: {
      ownerId: profile.id, recordingKind: "igc", status: "ready", xcStatus: "ready", metricsVersion: METRICS_VERSION,
      glider: "Wing A", takeoffSiteName: "Woodrat Mountain", takeoffAt: new Date("2026-09-09T18:00:00Z"), flightDate: new Date("2026-09-09"), localUtcOffsetMinutes: -420,
      durationS: 7200, maxAltM: 2300, launchAltM: 1100, xcScore: { version: 1, best: candidates[0], candidates },
    } });
    const entry = await prisma.flight.create({ data: { ownerId: profile.id, recordingKind: "logbook", source: "manual_entry", status: "ready", glider: "Wing A", takeoffSiteName: "Training Hill", flightDate: new Date("2026-09-08"), durationS: 300 } });
    await prisma.flight.create({ data: { ownerId: profile.id, recordingKind: "logbook", source: "manual_entry", status: "ready", glider: "Wing B", flightDate: new Date("2026-09-07"), durationS: 600 } });
    await page.goto("/logbook");
    const row = page.locator(`a[href="/flights/${flight.id}"]`);
    for (const width of [1440, 768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(row).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width === 1440) {
        await expect(row.locator("[data-medal]")).toHaveCount(6);
        await expect(row.getByTitle("Maximum altitude")).toBeVisible();
      }
      if (width === 320) await expect(row.locator('[aria-label="Flight trophies"] > span')).toHaveCount(1);
      await page.screenshot({ path: testInfo.outputPath(`logbook-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "Select Wings" }).click();
    await page.getByRole("checkbox", { name: /Wing B/ }).uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("status").filter({ hasText: "2 of 3 flights" })).toBeVisible();
    await page.locator(`a[href="/flights/${entry.id}"]`).click();
    await page.goBack();
    await expect(page.getByRole("status").filter({ hasText: "2 of 3 flights" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: "2 of 3 flights" })).toBeVisible();
    await page.goto(`/flights/${entry.id}/edit`);
    await page.getByRole("button", { name: "Delete flight", exact: true }).click();
    await page.getByRole("button", { name: "Yes, delete", exact: true }).click();
    await expect(page).toHaveURL(/\/logbook/);
    await expect(page.getByRole("status").filter({ hasText: "1 of 2 flights" })).toBeVisible();
    await page.getByRole("button", { name: "Select Dates" }).click();
    await page.getByLabel("From", { exact: true }).fill("2026-09-09");
    await page.getByLabel("Until", { exact: true }).fill("2026-09-09");
    await expect(row).toBeVisible();
    await page.getByLabel("Until", { exact: true }).fill("2026-09-08");
    await expect(page.getByText("No flights match these filters.")).toBeVisible();
  } finally { await prisma.$disconnect(); }
});
