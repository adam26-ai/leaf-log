import { expect, type FileChooser, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

// Terrarium encodes zero metres as RGB(128, 0, 0). Keep terrain enabled while
// removing network-dependent terrain shape and tile timing from UI assertions.
const flatTerrainTile = sharp({ create: {
  width: 256, height: 256, channels: 3, background: { r: 128, g: 0, b: 0 },
} }).png().toBuffer();

/** Assert the selected state as well as the available visibility choices. */
export async function expectSiteVisibility(editor: Locator, visibility: "private" | "public") {
  const group = editor.getByRole("group", { name: "Visibility", exact: true });
  await expect(group.getByRole("button", { name: "Private", exact: true })).toHaveAttribute("aria-pressed", String(visibility === "private"));
  await expect(group.getByRole("button", { name: "Public", exact: true })).toHaveAttribute("aria-pressed", String(visibility === "public"));
}

export async function setSiteVisibility(editor: Locator, visibility: "private" | "public") {
  await editor.getByRole("group", { name: "Visibility", exact: true })
    .getByRole("button", { name: visibility === "public" ? "Public" : "Private", exact: true }).click();
  await expectSiteVisibility(editor, visibility);
}

/** Site details load on the server before naming is safe. CI also renders a
 * WebGL replay here, so allow the form to become ready without a fixed sleep. */
export async function openSiteChooser(page: Page) {
  await page.getByRole("heading", { level: 1 }).getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: "Site details" });
  const name = dialog.getByPlaceholder("e.g. Sonoma Ridge");
  await expect(name).toBeVisible({ timeout: 15_000 });
  return { dialog, name };
}

/** Creating a site opens the full editor; new sites start private. */
export async function createSiteFromFlight(page: Page, siteName: string, visibility: "private" | "public" = "private") {
  const { dialog, name } = await openSiteChooser(page);
  await name.fill(siteName);
  await dialog.getByRole("button", { name: "Create site", exact: true }).click();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(siteName);
  await expectSiteVisibility(dialog, "private");
  if (visibility === "public") await setSiteVisibility(dialog, "public");
  await dialog.getByRole("button", { name: "Save site", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(siteName);
}

/** Opening the real picker waits for the client event handler; setting the
 * hidden input directly can fire before React hydrates and lose the upload. */
export async function uploadFlight(page: Page, files: Parameters<FileChooser["setFiles"]>[0]) {
  // Exercise real map rendering without external basemap downloads competing
  // with the software WebGL renderer used in CI.
  await page.route("**/tiles.openfreemap.org/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route("**/api.maptiler.com/**", route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route("https://s3.amazonaws.com/elevation-tiles-prod/terrarium/**", async route => {
    await route.fulfill({ contentType: "image/png", body: await flatTerrainTile });
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  await (await chooser).setFiles(files);
}

/** Space must control replay even when a map control retains focus.
 * Use accessible control names so metric icon size and layout stay independent. */
export async function expectReplaySpaceShortcut(page: Page) {
  const refresh = page.getByRole("button", { name: "Refresh friends" });
  await refresh.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  const canvas = page.locator(".flight-replay-map canvas").first();
  await canvas.focus();
  await expect(canvas).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
}

/** Scope per-entry calculation actions outside the flight navigation link. */
export function logbookEntry(page: Page, flightId: string) {
  return page.getByRole("listitem").filter({ has: page.locator(`a[href="/flights/${flightId}"]`) });
}
