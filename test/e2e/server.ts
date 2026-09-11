import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { makeRealisticFlight } from "../igc/make-igc";

const schema = process.env.LEAF_E2E_SCHEMA;
if (!schema || !/^e2e_[a-f0-9]{32}$/.test(schema) ||
    new URL(process.env.DATABASE_URL!).searchParams.get("schema") !== schema) {
  throw new Error("E2E server requires its own temporary database schema");
}
// Prepare tables before the app starts its background XC worker.
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { stdio: "pipe", env: process.env });
writeFileSync("test/e2e/.fixture.igc", makeRealisticFlight().igc);
// Place-search browser tests intercept geocoding requests; no real key is needed.
process.env.NEXT_PUBLIC_MAPTILER_KEY ||= "e2e-maptiler-key";
const server = spawn(process.execPath, ["--import", "sharp", "node_modules/next/dist/bin/next", "dev", "--hostname", "0.0.0.0", "--port", "3100"], { stdio: "inherit", env: process.env });
server.on("exit", code => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.kill(signal));
