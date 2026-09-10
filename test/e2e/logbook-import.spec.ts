import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { DEV_MAGIC_LINK_FILE as LINK_FILE } from "@/lib/dev-magic-link";
import { makeRealisticFlight } from "../igc/make-igc";
import { uploadFlight } from "./helpers";
import { PrismaClient } from "@prisma/client";

async function signUp(page: Page) {
  const handle = `import${Date.now()}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(`${handle}@test.local`);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();
  await expect.poll(() => existsSync(LINK_FILE) && readFileSync(LINK_FILE, "utf8").startsWith("http")).toBe(true);
  await page.goto(readFileSync(LINK_FILE, "utf8").trim());
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("Historic Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/);
}

test("manual flight → edit → attach a reviewed IGC, keeping one entry", async ({ page }) => {
  await signUp(page);
  await page.getByRole("main").getByRole("link", { name: "Add flight", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Add flight", exact: true })).toBeVisible();
  await page.getByLabel("Flight date", { exact: true }).fill("2024-07-12");
  await page.getByRole("spinbutton", { name: "Duration hours", exact: true }).fill("1");
  await page.getByRole("spinbutton", { name: "Duration minutes", exact: true }).fill("30");
  await page.getByLabel("Wing", { exact: true }).fill("Historic wing");
  await page.getByLabel("Flying site name", { exact: true }).fill("Memory Hill");
  await page.getByRole("combobox", { name: "XC type", exact: true }).selectOption("fai-triangle");
  await page.getByLabel("XC distance", { exact: true }).fill("45");
  await page.getByText("Site location", { exact: true }).click();
  await page.getByLabel("Site latitude", { exact: true }).fill("37.6685");
  await page.getByLabel("Site longitude", { exact: true }).fill("-122.4936");
  await page.getByRole("button", { name: "Add manual flight", exact: true }).click();
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+$/);
  const flightUrl = page.url();
  await expect(page.getByText("Manual logbook entry · no track recorded")).toBeVisible();
  await expect(page.getByLabel("Flight site map", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Go to max altitude" })).toHaveCount(0);
  await page.getByRole("link", { name: "Edit flight", exact: true }).click();
  await expect(page.getByLabel("Duration minutes", { exact: true })).toHaveValue("30");
  await page.getByLabel("Duration minutes", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save flight details" }).click();
  await expect(page).toHaveURL(flightUrl);
  await page.goto(`${flightUrl}/edit`);
  await expect(page.getByLabel("IGC to attach")).toBeEnabled();
  await page.getByLabel("IGC to attach").setInputFiles({ name: "found.igc", mimeType: "application/octet-stream", buffer: Buffer.from(makeRealisticFlight().igc) });
  await page.getByRole("button", { name: "Compare IGC with this entry" }).click();
  await expect(page.getByRole("columnheader", { name: "From IGC" })).toBeVisible();
  await page.getByRole("button", { name: "Attach IGC and use recorded measurements" }).click();
  await expect(page).toHaveURL(flightUrl);
  await page.goto("/logbook");
  await expect(page.getByRole("status").filter({ hasText: "1 of 1 flights" })).toBeVisible();
});

test("CSV name matching, duplicate review, reported trophies, mobile layout and undo", async ({ page }) => {
  test.setTimeout(120000);
  await signUp(page);
  await page.goto("/settings");
  await page.getByRole("link", { name: /Import an existing logbook/ }).click();
  const csv = "date,duration_minutes,wing,site,xc_distance,xc_type\n2001-04-24,60,Rush4,Hill,25,open\n2001-04-24,60,Rush 4,Hill,25,open\n2001-04-25,,Rush4,Hill,30,FAI triangle";
  await expect(page.getByLabel("Choose logbook CSV")).toBeEnabled();
  await page.getByLabel("Choose logbook CSV").setInputFiles({ name: "history.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Continue to names" }).click();
  await page.getByLabel("Wings: Rush4", { exact: true }).fill("Rush 4");
  await page.getByRole("button", { name: "Review flights", exact: true }).click();
  await expect(page.getByText("Possible duplicate of:")).toBeVisible();
  await page.getByRole("button", { name: "Skip all possible duplicates" }).click();
  await page.getByRole("button", { name: "Check preview", exact: true }).click();
  await expect(page.getByText("Preview checked.", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/logbook-import-review-mobile.png", fullPage: true });
  await page.getByLabel("I have checked the dates, units, and selected flights.").check();
  await page.getByRole("button", { name: "Import 2 flights", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your flights are in your logbook" })).toBeVisible();
  await page.getByRole("link", { name: "Open logbook", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 of 2 flights" })).toBeVisible();
  await expect(page.getByText("Airtime excludes 1 flight with unknown duration.")).toBeVisible();
  await expect(page.getByLabel(/Gold.*FAI triangle.*reported/)).toBeVisible();
  await page.goto("/settings/import");
  await page.getByRole("button", { name: "Undo import", exact: true }).click();
  await page.getByRole("button", { name: "Remove unchanged entries", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2 entries removed");
  await page.goto("/logbook");
  await expect(page.getByRole("link", { name: "Add your first flight" })).toBeVisible();
});

test("recording names stay read-only and wing edits preserve historical labels and original IGC", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => {
    if (/hydration|hydrated/i.test(message.text())) hydrationErrors.push(message.text());
  });
  await signUp(page);
  const igc = Buffer.from(makeRealisticFlight().igc.replace("\n", "\nHFPLTPILOTINCHARGE:Recorder Friend\n"));
  await page.goto("/upload");
  await uploadFlight(page, { name: "borrowed.igc", mimeType: "application/octet-stream", buffer: igc });
  await expect(page).toHaveURL(/\/flights\/[a-z0-9]+$/);
  const flightUrl = page.url(), id = flightUrl.split("/").pop()!;
  const db = new PrismaClient();
  try {
    // Represent a correction made with the previous version of Leaf Log.
    await db.flight.update({ where: { id }, data: { pilot: "Earlier saved label" } });
    await page.goto(`${flightUrl}/edit`);
    await expect(page.getByRole("textbox", { name: /pilot/i })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: /pilot/i })).toHaveCount(0);
    await page.getByText("Recording details", { exact: true }).click();
    await expect(page.getByText("Pilot name in original IGC", { exact: true })).toBeVisible();
    await expect(page.getByText("Recorder Friend", { exact: true })).toBeVisible();
    await expect(page.getByText("Earlier saved label", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Wing name", exact: true }).fill("Corrected Wing");
    await page.getByRole("button", { name: "Save wing", exact: true }).click();
    await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
    const saved = await db.flight.findUniqueOrThrow({ where: { id }, include: { data: true } });
    expect(saved.pilot).toBe("Earlier saved label");
    expect(saved.glider).toBe("Corrected Wing");
    expect(Buffer.from(saved.data!.rawIgc)).toEqual(igc);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/recording-details-mobile.png", fullPage: true });
    await page.goto("/upload");
    await uploadFlight(page, { name: "no-pilot-name.igc", mimeType: "application/octet-stream", buffer: Buffer.from(makeRealisticFlight().igc) });
    await expect(page).toHaveURL(/\/flights\/[a-z0-9]+$/);
    await page.goto(`${page.url()}/edit`);
    await page.getByText("Recording details", { exact: true }).click();
    await expect(page.getByText("Pilot name in original IGC", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /pilot/i })).toHaveCount(0);
    await expect(page.getByText("Unknown pilot", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Wing name", exact: true })).toBeEnabled();
    expect(hydrationErrors).toEqual([]);
  } finally { await db.$disconnect(); }
});
