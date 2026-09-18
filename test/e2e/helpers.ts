import { expect, type FileChooser, type Locator, type Page } from "@playwright/test";

/** Public pages expose account entry in the top-right header. */
export async function expectSignedOutHeader(page: Page) {
  const header = page.getByRole("banner");
  await expect(header.getByRole("img", { name: "Leaf Log" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
}

/** Map labels and controls hydrate before shaders, terrain and the first frame
 * finish. Wait for the real renderer's idle signal within the existing test
 * deadline before measuring a subsequent interaction's response. */
export async function waitForMapReady(map: Locator) {
  await map.and(map.page().locator('[data-render-ready="true"]')).waitFor();
}

/** Exercise the opt-in replay diagnostic without changing the flight/view. */
export async function selectTrackDiagnosticRenderer(page: Page, label: "Colored" | "Outlined" | "Plain", renderer: "color" | "outlined" | "plain") {
  const controls = page.getByRole("group", { name: "Track renderer diagnostic" });
  await controls.getByRole("button", { name: label, exact: true }).click();
  await expect(controls.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".flight-replay-map")).toHaveAttribute("data-track-renderer", renderer);
}

/** Typing only searches; explicitly add the name to the unsaved flight. */
export async function addEntrySite(page: Page, name: string, label = "Flying site") {
  const field = page.getByRole("group", { name: label, exact: true });
  await field.getByRole("combobox", { name: `Search ${label.toLowerCase()}`, exact: true }).fill(name);
  await expect(field.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
  await field.getByRole("option", { name: `Add “${name}” as a new site`, exact: true }).click();
  await expect(field.getByText(name, { exact: true })).toBeVisible();
  await expect(field.getByText("Will be created when you save this flight.", { exact: true })).toBeVisible();
  return field;
}

/** The single type control applies to both IGC uploads and manual entries. */
export async function setNewFlightTypes(page: Page, names: string[]) {
  const fields = page.getByRole("group", { name: "Flight type (select all that apply)", exact: true });
  await expect(fields).toHaveCount(1);
  for (const name of ["Tandem", "SIV", "Competition", "Tow"]) {
    await fields.getByRole("checkbox", { name, exact: true }).setChecked(names.includes(name));
  }
}

/** Wait for site details to replace the loading state, then assert the
 * selected visibility and both available choices. */
export async function expectSiteVisibility(editor: Locator, visibility: "private" | "public") {
  await expect(editor.getByLabel("Name", { exact: true })).toBeVisible({ timeout: 15_000 });
  const group = editor.getByRole("group", { name: "Visibility", exact: true });
  await expect(group.getByRole("button", { name: "Private", exact: true })).toHaveAttribute("aria-pressed", String(visibility === "private"));
  await expect(group.getByRole("button", { name: "Public", exact: true })).toHaveAttribute("aria-pressed", String(visibility === "public"));
}

export async function setSiteVisibility(editor: Locator, visibility: "private" | "public") {
  await editor.getByRole("group", { name: "Visibility", exact: true })
    .getByRole("button", { name: visibility === "public" ? "Public" : "Private", exact: true }).click();
  await expectSiteVisibility(editor, visibility);
}

export async function setSiteKind(editor: Locator, kind: "takeoff" | "landing" | "both") {
  const choice = kind === "both" ? "Takeoff and landing" : kind === "takeoff" ? "Takeoff" : "Landing";
  await editor.getByRole("combobox", { name: "Used for", exact: true }).selectOption({ label: choice });
  await expect(editor.getByRole("combobox", { name: "Used for", exact: true })).toHaveValue(kind);
}

/** When a replay map exists, wait for its first rendered frame before
 * interacting with the site header. Manual flights have no replay map. */
export async function openSiteChooser(page: Page) {
  const replayMap = page.locator(".flight-replay-map");
  if (await replayMap.count()) await waitForMapReady(replayMap);
  await page.getByRole("heading", { level: 1 }).getByRole("button").click();
  const dialog = page.getByRole("dialog", { name: "Site details" });
  const name = dialog.getByPlaceholder("e.g. Sonoma Ridge");
  await expect(name).toBeVisible({ timeout: 15_000 });
  return { dialog, name };
}

/** Creating uses the chooser's loaded draft immediately; new sites start private. */
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
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  await (await chooser).setFiles(files);
}

/** Space must control replay even when a map control retains focus.
 * Use accessible control names so metric icon size and layout stay independent. */
export async function expectReplaySpaceShortcut(page: Page) {
  // Test the shortcut at normal speed so a slow renderer cannot finish the
  // flight between the Play assertion and the key intended to pause it.
  await page.getByRole("button", { name: /^Playback speed:/ }).click();
  await page.getByRole("option", { name: "1×", exact: true }).click();
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
