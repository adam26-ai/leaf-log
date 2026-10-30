import { expect, type Page } from "./fixtures";
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEV_MAGIC_LINK_FILE as LINK_FILE } from "@/lib/dev-magic-link";
const IGC_PATH = process.env.E2E_IGC ?? join(process.cwd(), "test/e2e/.fixture.igc");

/** Poll the dev magic-link file written by sendMagicLink's dev fallback. */
export async function getMagicLink(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    if (existsSync(LINK_FILE)) {
      const s = readFileSync(LINK_FILE, "utf8").trim();
      if (s.startsWith("http")) return s;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("magic link file never appeared");
}

export async function signUp(page: Page) {
  const suffix = `${Date.now()}`;
  const email = `e2e_${suffix}@test.local`;
  const handle = `e2e${suffix}`.slice(0, 18);
  rmSync(LINK_FILE, { force: true });

  // 1. Request a magic link.
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByRole("heading", { name: /check your email/i })).toBeVisible();

  // 2. Follow the magic link.
  const link = await getMagicLink();
  await page.goto(link);

  // 2b. "Keep me signed in?" interstitial (between the link and onboarding).
  await page.getByRole("button", { name: /keep me signed in/i }).click();

  // 3. Onboarding.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  await page.locator('input[name="handle"]').fill(handle);
  await page.locator('input[name="display_name"]').fill("E2E Pilot");
  await page.getByRole("button", { name: /create my logbook/i }).click();
  await expect(page).toHaveURL(/\/logbook/, { timeout: 15_000 });
}

/** Renderer tests arrange a real uploaded public flight without replaying the
 * upload/share UI journey or mounting an unrelated owner's replay map. */
export async function arrangePublicFlight(page: Page, fixedCamera = false) {
  await signUp(page);
  const response = await page.request.post("/api/upload", { multipart: { files: {
    name: "renderer.igc", mimeType: "text/plain", buffer: readFileSync(IGC_PATH),
  } } });
  expect(response.ok()).toBe(true);
  const { results } = await response.json();
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ status: "ready", deduped: false });
  const flightId: string = results[0].flightId;
  const db = new PrismaClient();
  try {
    const flight = await db.flight.update({ where: { id: flightId }, data: { visibility: "public" } });
    if (fixedCamera) {
      await db.profile.update({ where: { id: flight.ownerId }, data: { mapDefaults: { camera: "fixed" } } });
    }
  } finally { await db.$disconnect(); }
  return `/flights/${flightId}`;
}
