import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// The same entry points run locally and in the two CI jobs. Keep failures fatal:
// in particular, a successful unit-only run is not a completed pre-PR check.
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const mode = process.argv[2] ?? "all";
if (!["all", "gates", "e2e"].includes(mode) || process.argv.length > 3) {
  throw new Error("Usage: node scripts/check.mjs [all|gates|e2e]");
}
const expectedNode = readFileSync(".node-version", "utf8").trim();
if (process.versions.node !== expectedNode) {
  throw new Error(`Use Node ${expectedNode} for CI parity (current: ${process.versions.node}).`);
}
config({ path: [".env.local", ".env"], quiet: true });
if (!process.env.DATABASE_URL) throw new Error("Configure a local DATABASE_URL and start PostgreSQL before running checks.");
const database = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)) {
  throw new Error("Checks require local PostgreSQL; each suite creates its own temporary schema.");
}
// Enforce focused-test guards locally too; never silently accept test.only.
process.env.CI = "true";
function run(label, cli, ...args) {
  console.log(`\nChecking: ${label}`);
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("Prisma client", "node_modules/prisma/build/index.js", "generate");
if (mode !== "e2e") {
  run("TypeScript", "node_modules/typescript/bin/tsc", "--noEmit");
  run("Lint", "node_modules/eslint/bin/eslint.js");
  run("Unit and integration tests", "node_modules/vitest/vitest.mjs", "run");
  run("Production build", "node_modules/next/dist/bin/next", "build");
}
if (mode !== "gates") run("Browser tests", "node_modules/@playwright/test/cli.js", "test");
console.log(`\n${mode === "all" ? "All pre-PR" : mode} checks passed.`);
