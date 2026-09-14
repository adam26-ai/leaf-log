import { expect, type FileChooser, type Locator, type Page } from "@playwright/test";

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
  await page.locator("h1 button").click();
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
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  await (await chooser).setFiles(files);
}
