import { test, expect, type Page } from "./fixtures";
import { expectCurrentHeaderLink, expectSingleRowHeader, openSitesPage } from "./helpers";
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { DEV_MAGIC_LINK_FILE } from "@/lib/dev-magic-link";

const db = new PrismaClient();
test.afterAll(async () => { await db.$disconnect(); });

async function signIn(page: Page, email: string) {
  rmSync(DEV_MAGIC_LINK_FILE, { force: true });
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  await expect.poll(() => existsSync(DEV_MAGIC_LINK_FILE) ? readFileSync(DEV_MAGIC_LINK_FILE, "utf8").trim() : "").toMatch(/^http/);
  await page.goto(readFileSync(DEV_MAGIC_LINK_FILE, "utf8").trim());
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/logbook/);
}

test("main admin can search, grant, revoke, re-enable and separately remove admins", async ({ page }) => {
  const main = await db.user.create({ data: { email: "leafvario@gmail.com", profile: { create: { handle: "mainadmin", displayName: "Main admin", ratingsTrackingEnabled: true } } } });
  const pilot = await db.user.create({ data: { email: "grantpilot@test.local", profile: { create: { handle: "grantpilot", displayName: "Grant Pilot" } } } });
  try {
    await signIn(page, "leafvario@gmail.com");
    await expectCurrentHeaderLink(page, "Leaf Log — your logbook");
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
    for (const width of [320, 360, 390, 400, 480, 640, 1023, 1024, 1100, 1279, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expectSingleRowHeader(page);
      await expectCurrentHeaderLink(page, "Admin");
    }
    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByRole("link", { name: "Leaf Log — your logbook", exact: true }).click();
    await expect(page).toHaveURL(/\/logbook/);
    await expectCurrentHeaderLink(page, "Leaf Log — your logbook");
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Admin", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("searchbox", { name: "Search users" }).fill("grantpilot");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("list", { name: "User search results" }).getByRole("button", { name: /Grant Pilot/ }).click();
    await page.getByRole("button", { name: "Grant site admin access" }).click();
    const admins = page.getByRole("list", { name: "Site admins", exact: true });
    const row = admins.getByRole("listitem").filter({ hasText: "@grantpilot" });
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
    await page.reload();
    await row.getByRole("button", { name: "Revoke", exact: true }).click();
    await row.getByRole("button", { name: "Confirm revoke" }).click();
    await expect(row.getByText("Revoked", { exact: true })).toBeVisible();
    await page.reload();
    await row.getByRole("button", { name: "Re-enable", exact: true }).click();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Revoke", exact: true }).click();
    await row.getByRole("button", { name: "Confirm revoke" }).click();
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await row.getByRole("button", { name: "Confirm delete" }).click();
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(row).toHaveCount(0);
    expect(await db.user.findUnique({ where: { id: pilot.id } })).not.toBeNull();
    expect(await db.siteAdmin.findUnique({ where: { userId: pilot.id } })).toBeNull();
  } finally { await db.user.deleteMany({ where: { id: { in: [main.id, pilot.id] } } }); }
});

test("delegated admin can delete a public site across logbooks but cannot manage admins", async ({ page }) => {
  const owner = await db.user.create({ data: { email: "adminowner@test.local", profile: { create: { handle: "adminowner", displayName: "Site owner" } } } });
  const admin = await db.user.create({ data: { email: "delegate@test.local", profile: { create: { handle: "delegate", displayName: "Site admin" } }, siteAdmin: { create: {} } } });
  const site = await db.site.create({ data: { ownerId: owner.id, name: "Admin browser ridge", normalizedName: "admin browser ridge", kind: "both", visibility: "public", lat: 45, lon: 6 } });
  const flight = await db.flight.create({ data: { ownerId: owner.id, takeoffSiteId: site.id, takeoffSiteName: site.name, takeoffLat: 45, takeoffLon: 6 } });
  try {
    await signIn(page, "delegate@test.local");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    await openSitesPage(page);
    await page.getByRole("region", { name: "Sites list" }).getByRole("button", { name: /Admin browser ridge/ }).click();
    await page.getByRole("button", { name: "Delete site", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Delete site" });
    await expect(dialog.getByText(/1 flight across pilots' logbooks/)).toBeVisible();
    await dialog.getByRole("button", { name: "Delete site", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    expect(await db.site.findUnique({ where: { id: site.id } })).toBeNull();
    expect(await db.flight.findUnique({ where: { id: flight.id } })).toMatchObject({ takeoffSiteId: null, takeoffSiteName: site.name, takeoffLat: 45, takeoffLon: 6 });
    await db.siteAdmin.update({ where: { userId: admin.id }, data: { revokedAt: new Date() } });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sites in your logbook" })).toBeVisible();
  } finally {
    await db.site.deleteMany({ where: { id: site.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, admin.id] } } });
  }
});
