import { expect, type FileChooser, type Page } from "@playwright/test";

/** Site details load on the server before naming is safe. CI also renders a
 * WebGL replay here, so allow the form to become ready without a fixed sleep. */
export async function openSiteChooser(page: Page) {
  await page.locator("h1 button").click();
  const dialog = page.getByRole("dialog", { name: "Site details" });
  const name = dialog.getByPlaceholder("e.g. Sonoma Ridge");
  await expect(name).toBeVisible({ timeout: 15_000 });
  return { dialog, name };
}

/** Opening the real picker waits for the client event handler; setting the
 * hidden input directly can fire before React hydrates and lose the upload. */
export async function uploadFlight(page: Page, files: Parameters<FileChooser["setFiles"]>[0]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose file", exact: true }).click();
  await (await chooser).setFiles(files);
}
