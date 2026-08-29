import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

const LINK_FILE = "/tmp/leaf-magic-link.txt";
const IGC_PATH = process.env.E2E_IGC ?? join(process.cwd(), "test/e2e/.fixture.igc");

async function getMagicLink(): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(LINK_FILE)) {
      const s = readFileSync(LINK_FILE, "utf8").trim();
      if (s.startsWith("http")) return s;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("magic link file never appeared");
}

async function signUp(page: Page, email: string, handle: string, displayName: string) {
  rmSync(LINK_FILE, { force: true });
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();

  await page.goto(await getMagicLink());
  // "Keep me signed in?" interstitial sits between the link and onboarding.
  await page.getByRole("button", { name: /keep me signed in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill(displayName);
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });
}

test("friends feed exposes friends-only flights and kudos to accepted friends", async ({
  page,
  browser,
}) => {
  const suffix = `${Date.now()}`;
  const aHandle = `sociala${suffix}`.slice(0, 18);
  const bHandle = `socialb${suffix}`.slice(0, 18);
  const aName = "Social A";
  const bName = "Social B";

  await signUp(page, `social_a_${suffix}@test.local`, aHandle, aName);

  const bContext = await browser.newContext();
  const bPage = await bContext.newPage();
  await signUp(bPage, `social_b_${suffix}@test.local`, bHandle, bName);

  await page.goto(`/@${bHandle}`);
  await page.getByRole("button", { name: /add friend/i }).click();
  await expect(page.getByRole("button", { name: /requested/i })).toBeVisible();

  await bPage.goto("/friends");
  const requestRow = bPage.locator("li").filter({ hasText: aName });
  await requestRow.getByRole("button", { name: /accept/i }).click();
  await expect(bPage.getByText("No pending requests.")).toBeVisible();

  await bPage.goto("/upload");
  await bPage.locator('input[type="file"]').setInputFiles(IGC_PATH);
  await expect(bPage).toHaveURL(/\/flights\/[a-z0-9]+/, { timeout: 30_000 });
  const flightUrl = bPage.url();
  // The visibility control is read-only in the UI for now (editing moves to
  // a future flight-edit page) — stands in for that page until it exists.
  const flightId = flightUrl.split("/").pop()!;
  await prisma.flight.update({ where: { id: flightId }, data: { visibility: "friends" } });

  await page.goto("/feed");
  await expect(page.getByText(`@${bHandle}`)).toBeVisible();
  // Sites are fully community-driven (no curated seed), so the shared
  // fixture's flight reads "Unknown site" until someone names it.
  await expect(page.getByRole("link", { name: /unknown site/i })).toBeVisible();

  await page.goto(flightUrl);
  await expect(page.getByText("Airtime")).toBeVisible();
  await page.getByRole("button", { name: "Give kudos" }).click();
  const kudoed = page.getByRole("button", { name: "Remove kudos" });
  await expect(kudoed).toHaveAttribute("aria-pressed", "true");
  await expect(kudoed).toContainText("1");

  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  const res = await anonPage.goto(flightUrl);
  expect(res?.status()).toBe(404);
  await anon.close();
  await bContext.close();
});
