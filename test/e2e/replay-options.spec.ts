import { test, expect, type Page } from "./fixtures";
import { PrismaClient } from "@prisma/client";
import type { Cookie } from "@playwright/test";
import { arrangePublicFlight } from "./replay-fixtures";
import { chooseReplayMapOption, expectReplayRendered, waitForMapReady } from "./helpers";

// Test responsive controls with the real renderer in a bounded software-GPU
// canvas. Happy-path's desktop renderer/diagnostic/drag tests retain their full
// viewport. No terrain, renderer fidelity, assertions or traces are disabled.
test.use({ viewport: { width: 800, height: 700 } });

// Reuse the immutable recording and session in fresh browser contexts. Arrange
// only the initial camera preference per case; each transition has its own
// deadline, independent of an unrelated signup/upload journey.
let renderOptionsFixture: { url: string; cookies: Cookie[] } | null = null;
async function arrangeRenderOptions(page: Page, camera: "fixed" | "orbit" = "fixed") {
  if (!renderOptionsFixture) {
    const url = await arrangePublicFlight(page, true);
    renderOptionsFixture = { url, cookies: await page.context().cookies() };
  } else await page.context().addCookies(renderOptionsFixture.cookies);
  const db = new PrismaClient();
  try {
    const flight = await db.flight.findUniqueOrThrow({ where: { id: renderOptionsFixture.url.split("/").at(-1)! }, select: { ownerId: true } });
    await db.profile.update({ where: { id: flight.ownerId }, data: { mapDefaults: { camera } } });
  } finally { await db.$disconnect(); }
  return renderOptionsFixture.url;
}


for (const mode of ["Follow", "Chase"]) test(`replay switches to ${mode} camera and restores Fixed`, async ({ page }) => {
  const url = await arrangeRenderOptions(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  const map = page.locator(".flight-replay-map");
  await waitForMapReady(map);
  for (const choice of [mode, "Fixed"]) {
    await chooseReplayMapOption(page, /^Camera:/, choice);
    await expect(page.getByRole("button", { name: new RegExp(`^Camera: ${choice}`) })).toBeVisible();
    await expectReplayRendered(map);
  }
  expect(errors).toEqual([]);
});

for (const transition of ["enter", "exit"] as const) test(`replay ${transition}s Orbit camera without losing its track`, async ({ page }) => {
  const url = await arrangeRenderOptions(page, transition === "exit" ? "orbit" : "fixed");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  const map = page.locator(".flight-replay-map");
  await waitForMapReady(map);
  if (transition === "enter") {
    await chooseReplayMapOption(page, /^Camera:/, "Orbit");
    await expect(page.getByRole("button", { name: /^Camera: Orbit/ })).toBeVisible();
  } else {
    // Exercise the documented Orbit→Fixed cycle from a saved Orbit default.
    await page.getByRole("button", { name: /^Camera: Orbit/ }).press("Enter");
    await expect(page.getByRole("button", { name: /^Camera: Fixed/ })).toBeVisible();
  }
  await expectReplayRendered(map);
  expect(errors).toEqual([]);
});

test("fixed replay switches between MSL and AGL altitude", async ({ page }) => {
  const url = await arrangeRenderOptions(page);
  await page.goto(url);
  await waitForMapReady(page.locator(".flight-replay-map"));
  await expect(page.getByRole("button", { name: /^Camera: Fixed/ })).toBeVisible();
  await page.getByRole("button", { name: /^Altitude: MSL/ }).click();
  await expect(page.getByRole("button", { name: /^Altitude: AGL/ })).toBeVisible();
  await page.getByRole("button", { name: /^Altitude: AGL/ }).click();
  await expect(page.getByRole("button", { name: /^Altitude: MSL/ })).toBeVisible();
});

for (const style of ["Satellite", "Hybrid", "Topo", "Streets"]) test(`replay switches to ${style} and restores Map without losing its track`, async ({ page }) => {
  const url = await arrangeRenderOptions(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  const map = page.locator(".flight-replay-map");
  await waitForMapReady(map);
  for (const choice of [style, "Map"]) {
    await chooseReplayMapOption(page, /^Basemap:/, choice);
    await expect(page.getByRole("button", { name: new RegExp(`^Basemap: ${choice} `) })).toBeVisible();
    await page.mouse.move(0, 0);
    await expectReplayRendered(map);
  }
  expect(errors).toEqual([]);
});
