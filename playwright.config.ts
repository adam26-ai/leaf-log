import "dotenv/config";
import { config } from "dotenv";
import { chromium, defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

// .env.local (not just .env) is where DATABASE_URL etc. actually live —
// matches prisma/seed.ts's own loading order. Needed for specs that talk to
// the DB directly (e.g. standing in for not-yet-built admin/edit UI).
config({ path: ".env.local", quiet: true });

// Never reuse the interactive phone-testing server or its login origin. Each
// run gets a fresh schema so public sites and old uploads cannot affect results.
const baseURL = "http://localhost:3100";
const database = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) {
  throw new Error("Playwright requires a local PostgreSQL database.");
}
process.env.LEAF_E2E_SCHEMA ??= `e2e_${randomUUID().replaceAll("-", "")}`;
database.searchParams.set("schema", process.env.LEAF_E2E_SCHEMA);
database.hostname = "127.0.0.1";
process.env.DATABASE_URL = database.href;
process.env.AUTH_URL = baseURL;
process.env.NEXTAUTH_URL = baseURL;
process.env.RESEND_API_KEY = "";
process.env.LEAF_E2E = "1";

// Use bundled Chromium in CI; on Windows, Edge is a convenient installed fallback.
const channel = process.env.PLAYWRIGHT_CHANNEL ||
  (!existsSync(chromium.executablePath()) && process.platform === "win32" ? "msedge" : undefined);

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  outputDir: "test-results/playwright",
  reporter: [["list"], ["./test/e2e/cleanup-reporter.ts"]],
  use: {
    baseURL,
    channel,
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node --import tsx test/e2e/server.ts",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
