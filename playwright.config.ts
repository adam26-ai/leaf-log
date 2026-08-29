import "dotenv/config";
import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

// .env.local (not just .env) is where DATABASE_URL etc. actually live —
// matches prisma/seed.ts's own loading order. Needed for specs that talk to
// the DB directly (e.g. standing in for not-yet-built admin/edit UI).
config({ path: ".env.local" });

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
