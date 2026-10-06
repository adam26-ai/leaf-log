import { expect, type FileChooser, type Locator, type Page } from "@playwright/test";

/** Compare the actual rendered shading across owner and friend flight cards. */
export async function readFlightCardShading(card: Locator) {
  await expect(card).toBeVisible();
  return card.evaluate(element => getComputedStyle(element).backgroundImage);
}

/** Photo controls stay at the viewport edges, independent of image dimensions. */
export async function expectPhotoViewerControls(page: Page) {
  const viewport = page.viewportSize()!;
  const previous = page.getByRole("button", { name: "Previous", exact: true });
  const next = page.getByRole("button", { name: "Next", exact: true });
  const close = page.getByRole("button", { name: "Close", exact: true });
  for (const button of [previous, next, close]) {
    await expect(button).toBeVisible();
    await expect(button).toHaveCSS("width", "56px");
    await expect(button).toHaveCSS("height", "56px");
    expect(await button.evaluate(element => parseFloat(getComputedStyle(element).borderTopLeftRadius)))
      .toBeGreaterThanOrEqual(28);
  }
  const left = (await previous.boundingBox())!;
  const right = (await next.boundingBox())!;
  const corner = (await close.boundingBox())!;
  expect(left.x).toBeCloseTo(16, 0);
  expect(right.x + right.width).toBeCloseTo(viewport.width - 16, 0);
  expect(left.y + left.height / 2).toBeCloseTo(viewport.height / 2, 0);
  expect(right.y + right.height / 2).toBeCloseTo(viewport.height / 2, 0);
  expect(corner.x + corner.width).toBeCloseTo(viewport.width - 16, 0);
  expect(corner.y).toBeCloseTo(16, 0);
}

/** A held mouse crossing between the map and profile keeps its original owner. */
export async function expectReplayDragOwnership(page: Page, origin: "map" | "profile") {
  const map = page.locator(".flight-replay-map");
  await waitForMapReady(map);
  // The fixture seeds the saved preference before navigation, avoiding camera
  // menu setup and Follow-camera terrain loading during the drag assertions.
  await expect(page.getByRole("button", { name: /^Camera: Fixed/ })).toBeVisible();
  const profile = page.getByTestId("flight-profile");
  const timeline = page.getByRole("slider", { name: "Flight playback time" });
  // Scroll directly: Playwright's stability wait can contend with software WebGL
  // rendering even though the chart's final position is already usable.
  await profile.evaluate(element => element.scrollIntoView({ block: "end", behavior: "instant" }));
  await timeline.focus();
  await timeline.press("Home");
  await expect(timeline).toHaveAttribute("aria-valuenow", "0");
  const chart = (await profile.boundingBox())!;
  const canvas = (await map.locator("canvas").first().boundingBox())!;
  const mapY = Math.max(canvas.y, 80) + 30;
  const left = chart.x + chart.width * 0.35;
  const right = chart.x + chart.width * 0.75;
  const chartY = chart.y + chart.height / 2;

  if (origin === "map") {
    await page.mouse.move(left, mapY);
    await page.mouse.down();
    try {
      // Real pointer events on each side of the boundary are sufficient; eight
      // intermediate rendered frames needlessly exhaust the CI test budget.
      await page.mouse.move(right, chartY);
      await expect(timeline).toHaveAttribute("aria-valuenow", "0");
    } finally {
      await page.mouse.up();
    }
    return;
  }

  await page.mouse.move(left, chartY);
  await page.mouse.down();
  try {
    // Let Playwright assert in the browser: a slow attribute read can outlive
    // expect.poll's deadline even when the pointer has already scrubbed.
    await expect(timeline).toHaveAttribute("aria-valuenow", /^[1-9]\d*$/);
    const start = Number(await timeline.getAttribute("aria-valuenow"));
    await page.mouse.move(right, mapY);
    await expect(timeline).not.toHaveAttribute("aria-valuenow", String(start));
    expect(Number(await timeline.getAttribute("aria-valuenow"))).toBeGreaterThan(start);
  } finally {
    await page.mouse.up();
  }
  const released = await timeline.getAttribute("aria-valuenow");
  await page.mouse.move(left, chartY);
  await expect(timeline).toHaveAttribute("aria-valuenow", released!);
}

/** Counts remain readable without changing the navigation link names. */
export async function expectNavigationCount(page: Page, name: "Feed" | "Friends", count: number) {
  const link = page.getByRole("banner").getByRole("link", { name, exact: true });
  const badge = link.getByRole("status");
  if (count === 0) await expect(badge).toHaveCount(0);
  else {
    await expect(badge).toHaveText(count > 99 ? "99+" : String(count));
    await expect(badge).toHaveCSS("background-color", "rgb(216, 255, 0)");
    await expect(badge).toHaveCSS("border-top-color", "rgb(0, 125, 204)");
    await expect(badge).toHaveCSS("color", "rgb(0, 90, 153)");
  }
  await expect(link).toHaveAccessibleName(name);
}

export async function expectCurrentHeaderLink(page: Page, name: string) {
  const header = page.getByRole("banner");
  const current = header.getByRole("link").and(header.locator('[aria-current="page"]'));
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAccessibleName(name);
  if (name === "Leaf Log — your logbook") {
    await expect(current.locator('img[src="/leaf-log-capsule.png"]')).toBeVisible();
    await expect(current.locator('img[src="/leaf-log-outline.svg"]')).toBeHidden();
    await expect(current).toHaveCSS("box-shadow", "none");
  } else if (name !== "Settings") {
    await expect(current).toHaveCSS("background-color", "rgb(0, 125, 204)");
    await expect(current).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(current.locator("svg")).toHaveCSS("color", "rgb(255, 255, 255)");
  }
  if (name !== "Leaf Log — your logbook") {
    const logo = header.getByRole("link", { name: "Leaf Log — your logbook", exact: true });
    await expect(logo.locator('img[src="/leaf-log-capsule.png"]')).toBeHidden();
    await expect(logo.locator('img[src="/leaf-log-outline.svg"]')).toBeVisible();
    const capsule = logo.locator("span");
    // Compare pixels because Chromium may serialize the same color as Lab or OKLCH.
    await expect.poll(() => capsule.evaluate(element => {
      const canvas = document.createElement("canvas");
      canvas.width = 2;
      canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(element).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = "oklch(0.968 0.007 247.896)";
      context.fillRect(1, 0, 1, 1);
      const pixels = context.getImageData(0, 0, 2, 1).data;
      return pixels.slice(0, 4).every((value, index) => value === pixels[index + 4]);
    })).toBe(true);
    await expect(capsule).toHaveCSS("box-shadow", /1px inset/);
  }
}

/** Flight controls scroll behind the sticky navigation, then return below it. */
export async function expectFlightHeaderScrollOrder(page: Page) {
  const banner = page.getByRole("banner");
  const heading = page.getByTestId("flight-header");
  const controls = [
    heading.getByRole("link", { name: "Previous log", exact: true }),
    heading.getByText(/\w{3}, \w{3} \d{1,2}, \d{4}/),
    heading.getByText(/\d{2}:\d{2} – \d{2}:\d{2}/),
    heading.getByRole("link", { name: "Next log", exact: true }),
  ];
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 600 });
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const control of controls) await expect(control).toBeVisible();
    const initial = await heading.boundingBox();
    const nav = await banner.boundingBox();
    expect(initial!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height);

    // Check real hit-testing at each control, not just CSS z-index values.
    for (const control of controls) {
      await control.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const header = document.querySelector("header")!.getBoundingClientRect();
        window.scrollBy(0, bounds.top + bounds.height / 2 - header.height / 2);
      });
      await expect.poll(() => control.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2;
        const y = bounds.top + bounds.height / 2;
        return Boolean(document.elementFromPoint(x, y)?.closest("header"));
      }), "Navigation must cover the scrolled flight controls").toBe(true);
    }
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => banner.evaluate(element => element.getBoundingClientRect().top)).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(async () => (await heading.boundingBox())!.y).toBe(initial!.y);
    for (const control of controls) await control.click({ trial: true });
  }
}

/** All visible header links fit one row, including Ratings and main-admin tools. */
export async function expectSingleRowHeader(page: Page) {
  const header = page.getByRole("banner");
  const logo = header.getByRole("link", { name: "Leaf Log — your logbook", exact: true });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("href", "/logbook");
  await expect(logo).toHaveAttribute("title", "Your logbook");
  await expect(header.locator('a[href="/logbook"]')).toHaveCount(1);
  const logoBox = (await logo.boundingBox())!;
  for (const link of await header.getByRole("navigation").getByRole("link").all()) {
    const box = (await link.boundingBox())!;
    expect(logoBox.height).toBeGreaterThanOrEqual(box.height);
    expect(box.x).toBeGreaterThanOrEqual(logoBox.x + logoBox.width);
  }
  const avatar = await header.getByRole("link", { name: "Settings", exact: true }).boundingBox();
  expect(avatar).not.toBeNull();
  const center = avatar!.y + avatar!.height / 2;
  const addFlight = header.getByRole("link", { name: "Add flight", exact: true });
  const addFlightBox = (await addFlight.boundingBox())!;
  expect(addFlightBox.x + addFlightBox.width).toBeLessThanOrEqual(avatar!.x);
  // Full labels stay available down to the laptop breakpoint, with room for the account.
  if (page.viewportSize()!.width >= 1024) {
    await expect(addFlight.getByText("Add flight", { exact: true })).toHaveCSS("position", "static");
    await expect(header.getByRole("link", { name: "Settings", exact: true }).locator('[aria-hidden="false"]')).toBeVisible();
  }
  for (const link of await header.getByRole("link").all()) {
    if (!await link.isVisible()) continue;
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.y + box!.height / 2 - center)).toBeLessThan(2);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
}

/** Badge ejection preserves order, avoids overflow, and keeps help height stable. */
export async function expectResponsiveLegend(page: Page) {
  const legend = page.getByRole("region", { name: "Logbook legend" });
  const row = legend.getByLabel("Example logbook entry", { exact: true });
  const symbols = legend.getByLabel("Legend symbols", { exact: true });
  const names = ["Explain friend flights", "Explain personal bests", "Explain flight visibility", "Explain log source"];
  for (const width of [768, 640, 590, 530, 460, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await legend.boundingBox();
    const ejected = [560, 508, 456, 394].filter(threshold => bounds!.width < threshold).length;
    await expect(symbols.getByRole("button")).toHaveCount(ejected);
    for (const [index, name] of names.entries()) {
      await expect((index < ejected ? symbols : row).getByRole("button", { name, exact: true })).toBeVisible();
    }
    const friends = legend.getByRole("button", { name: "Explain friend flights", exact: true });
    await expect(friends.locator("svg")).toHaveCount(1);
    await expect(friends.locator("svg > g")).toHaveCount(2);
    const visibility = legend.getByRole("button", { name: "Explain flight visibility", exact: true });
    await expect(visibility.locator("svg")).toHaveCount(1);
    await expect(visibility.locator(".lucide-users")).toHaveCount(1);
    await expect(visibility).toHaveCSS("width", "24px");
    await expect(visibility).toHaveCSS("height", "24px");
    expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const initialHeight = (await legend.boundingBox())!.height;
    await friends.hover();
    await expect(legend.getByRole("status").getByText(/^The two-paraglider badge/)).toBeVisible();
    expect((await legend.boundingBox())!.height).toBe(initialHeight);
    await visibility.hover();
    await expect(legend.getByRole("status").getByText(/^The round visibility badge/)).toBeVisible();
    expect((await legend.boundingBox())!.height).toBe(initialHeight);
    await legend.getByRole("button", { name: "Explain log source", exact: true }).hover();
    await expect(legend.getByRole("status").getByText("Log source", { exact: true })).toBeVisible();
    expect((await legend.boundingBox())!.height).toBe(initialHeight);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** Settings cards load collapsed so the page stays compact. */
export async function openSettingsCard(page: Page, title: string) {
  await expectCurrentHeaderLink(page, "Settings");
  await expect(page.getByRole("banner").getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("href", "/settings");
  const expand = page.getByRole("button", { name: `Expand ${title} settings`, exact: true });
  await expect(expand).toBeVisible();
  await expand.click();
  const collapse = page.getByRole("button", { name: `Collapse ${title} settings`, exact: true });
  await expect(collapse).toBeVisible();
  const contentId = await collapse.getAttribute("aria-controls");
  if (!contentId) throw new Error(`${title} settings card does not identify its content`);
  return page.locator(`[id="${contentId}"]`);
}

/** Public pages expose account entry in the top-right header. */
export async function expectSignedOutHeader(page: Page) {
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  await expect(header.getByRole("img", { name: "Leaf Log" })).toBeVisible();
  await expect(header.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
}

/** Map labels and controls hydrate before shaders, terrain and the first frame
 * finish. Wait for the real renderer's idle signal within the existing test
 * deadline before measuring a subsequent interaction's response. */
export async function waitForMapReady(map: Locator) {
  const page = map.page();
  const readyMap = map.and(page.locator('[data-render-ready="true"]'));
  const shaderError = page.getByRole("heading", {
    name: /Compilation error in .*shader/i,
  });

  // luma.gl reports shader compilation failures in a rendered error panel.
  // Race that panel against readiness so a bad shader fails with its real
  // message instead of consuming the test's entire deadline.
  await readyMap.or(shaderError).first().waitFor();
  if (await shaderError.isVisible()) {
    throw new Error(await shaderError.textContent() ?? "WebGL shader compilation failed");
  }
}

/** Site management always displays one shared overview map. */
export async function openSitesPage(page: Page) {
  await page.goto("/sites");
  await expectCurrentHeaderLink(page, "Sites");
  await expect(page.getByTestId("site-area-map")).toHaveCount(0);
  await expect(page.getByTestId("site-browser-map")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Site map", exact: true })).toHaveCount(0);
  await waitForMapReady(page.getByTestId("site-browser-map"));
}

/** Exercise one isolated path mechanism without changing the flight/view. */
export async function selectTrackDiagnosticRenderer(
  page: Page,
  label: "2-point path" | "256-point path" | "Colored segments",
  mode: "path2" | "path256" | "lines",
) {
  const controls = page.getByRole("group", { name: "Track renderer diagnostic" });
  await controls.getByRole("button", { name: label, exact: true }).click();
  await expect(controls.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".flight-replay-map")).toHaveAttribute("data-track-renderer", mode);
  await expect(page).toHaveURL(new RegExp(`[?&]trackMode=${mode}(?:&|$)`));
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

/** Footer actions stay side by side, with blocking errors to their left. */
export async function expectSiteEditorFooter(editor: Locator) {
  const section = editor.getByRole("region", { name: "Site editor", exact: true });
  const cancel = section.getByRole("button", { name: "Cancel", exact: true });
  const save = section.getByRole("button", { name: "Save site", exact: true });
  await save.scrollIntoViewIfNeeded();
  await expect(cancel).toBeVisible();
  await expect(save).toBeVisible();
  const cancelBox = (await cancel.boundingBox())!;
  const saveBox = (await save.boundingBox())!;
  expect(cancelBox.y).toBeCloseTo(saveBox.y, 0);
  expect(cancelBox.x + cancelBox.width).toBeLessThanOrEqual(saveBox.x);
  const error = section.getByRole("alert");
  if (await error.count()) {
    await expect(save).toBeDisabled();
    const errorBox = (await error.boundingBox())!;
    expect(errorBox.x + errorBox.width).toBeLessThanOrEqual(cancelBox.x);
  } else {
    await expect(save).toBeEnabled();
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
  const group = editor.getByRole("group", { name: "Used for", exact: true });
  // Select wanted uses before deselecting others: at least one must remain on.
  for (const selected of [true, false]) for (const use of ["takeoff", "landing"] as const) {
    const wanted = kind === "both" || kind === use;
    const button = group.getByRole("button", { name: use === "takeoff" ? "Takeoff" : "Landing", exact: true });
    if (wanted === selected && await button.getAttribute("aria-pressed") !== String(wanted)) await button.click();
  }
  expect(await readSiteKind(editor)).toBe(kind);
}

export async function readSiteKind(editor: Locator) {
  const group = editor.getByRole("group", { name: "Used for", exact: true });
  const takeoff = await group.getByRole("button", { name: "Takeoff", exact: true }).getAttribute("aria-pressed") === "true";
  const landing = await group.getByRole("button", { name: "Landing", exact: true }).getAttribute("aria-pressed") === "true";
  expect(takeoff || landing).toBe(true);
  return takeoff && landing ? "both" : takeoff ? "takeoff" : "landing";
}

/** An omitted landing also omits the arrow next to the primary site. */
export async function expectReplayLandingHidden(page: Page) {
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading.locator("..").getByText("→", { exact: true })).toHaveCount(0);
}

/** When a replay map exists, wait for its first rendered frame before
 * interacting with the site header. Manual flights have no replay map. */
export async function openSiteChooser(page: Page, endpoint: "primary" | "landing" = "primary") {
  const replayMap = page.locator(".flight-replay-map");
  if (await replayMap.count()) await waitForMapReady(replayMap);
  const control = endpoint === "landing"
    ? page.getByRole("button", { name: "Choose site", exact: true }).and(page.locator("span > button"))
    : page.getByRole("heading", { level: 1 }).getByRole("button");
  await control.click();
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
  await expect(dialog.getByRole("heading", { name: "Create site", exact: true })).toBeVisible();
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

/** Feed icons must remain inside the flight link and clear of kudos at every breakpoint. */
export async function expectFeedRowsContained(page: Page) {
  const flights = page.locator('main li a[href^="/flights/"]');
  await expect(flights.first()).toBeVisible();
  await expect(page.getByLabel(/^Visibility:/)).toHaveCount(0);
  await expect.poll(() => flights.evaluateAll(links => links.every(link => {
    const button = link.closest("li")!.querySelector("button")!;
    const icon = button.querySelector("svg")!.getBoundingClientRect();
    const count = button.querySelector("span")!.getBoundingClientRect();
    return icon.bottom <= count.top + 1
      && Math.abs((icon.left + icon.right) - (count.left + count.right)) < 2;
  }))).toBe(true);
  await expect.poll(() => flights.evaluateAll(links => links.every(link => {
    const bounds = link.getBoundingClientRect();
    const row = link.closest("li")!;
    const pilot = row.querySelector('a[href^="/@"]')!;
    const pilotText = pilot.lastElementChild!;
    const handle = pilotText.lastElementChild!;
    const provider = row.closest('[data-feed-pilot-compact]')!;
    const compactPilot = provider.getBoundingClientRect().width * .16 - 52 < 90;
    if (provider.getAttribute('data-feed-pilot-compact') !== String(compactPilot)) return false;
    if ((handle.getClientRects().length === 0) !== compactPilot) return false;
    if (compactPilot && Math.abs(pilotText.getBoundingClientRect().width - 60) > 1) return false;
    const kudos = row.querySelector("button")!.getBoundingClientRect();
    const altitude = link.querySelector('[title="Maximum altitude"]');
    if (Boolean(altitude) !== (bounds.width >= 300)) return false;
    const combinedBadges = bounds.width < 300;
    const badgeColumn = link.querySelector('[data-feed-column="badges"]');
    if (combinedBadges) {
      const hasBadges = Boolean(link.querySelector('[aria-label="You flew together"], [aria-label="Flight trophies"]'));
      if (Boolean(badgeColumn) !== hasBadges) return false;
      const style = getComputedStyle(link);
      let textRight = bounds.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
      if (badgeColumn) {
        const badges = Array.from(badgeColumn.children).map(child => child.getBoundingClientRect());
        const expectedWidth = (link.querySelector('[aria-label="You flew together"]') ? 32 : 0)
          + (link.querySelector('[aria-label="Flight trophies"]') ? 24 : 0) + (badges.length === 2 ? 4 : 0);
        const badgeBounds = badgeColumn.getBoundingClientRect();
        if (Math.abs(badgeBounds.width - expectedWidth) > 1) return false;
        if (Math.abs(badgeBounds.right - textRight) > 1) return false;
        if (badges.some((badge, index) => index > 0 && (badge.left < badges[index - 1].right
          || Math.abs(badge.top - badges[index - 1].top) > 1))) return false;
        textRight = badgeBounds.left - parseFloat(style.columnGap);
      }
      for (const selector of ['[data-feed-column="site"]', '[data-feed-column="date"]']) {
        if (Math.abs(link.querySelector(selector)!.getBoundingClientRect().right - textRight) > 1) return false;
      }
    } else if (badgeColumn) return false;
    const columnSelectors = combinedBadges
      ? ['[data-feed-column="site"]', '[data-feed-column="badges"]']
      : ['[data-feed-column="site"]', '[title="Maximum altitude"]', '[data-feed-column="friends"]', '[data-feed-column="trophies"]'];
    const columns = columnSelectors
      .flatMap(selector => {
        const element = link.querySelector(selector);
        return element ? [element.getBoundingClientRect()] : [];
      });
    if (columns.some((column, index) => index > 0 && column.left < columns[index - 1].right - 1)) return false;
    return link.scrollWidth <= link.clientWidth + 1 && bounds.right <= kudos.left
      && bounds.right <= document.documentElement.clientWidth;
  }))).toBe(true);
  // Wider cards keep shared badge tracks, including empty slots. Compact cards
  // size their right-aligned badge area per flight, as checked above.
  await expect.poll(() => flights.evaluateAll(links => {
    return ['[title="Maximum altitude"]', '[data-feed-column="friends"]', '[data-feed-column="trophies"]', '[data-feed-column="badges"]'].every(selector => {
      const visible = links.flatMap(link => {
        if (link.getBoundingClientRect().width < 300) return [];
        const element = link.querySelector(selector);
        return element?.getClientRects().length ? [element] : [];
      });
      const positions = visible.map(element => element.getBoundingClientRect().left);
      return positions.every(left => Math.abs(left - positions[0]) < 1);
    });
  })).toBe(true);
}
