import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const mode = process.argv[2] ?? "all";
if (!["all", "gates", "e2e"].includes(mode) || process.argv.length > 3) {
  throw new Error("Usage: pnpm check:linux [all|gates|e2e]");
}
const nodeVersion = readFileSync(".node-version", "utf8").trim();
const require = createRequire(import.meta.url);
const playwrightVersion = require("@playwright/test/package.json").version;
if (![nodeVersion, playwrightVersion].every(version => /^\d+\.\d+\.\d+$/.test(version))) {
  throw new Error("Expected exact Node and installed Playwright versions.");
}
const id = randomUUID().replaceAll("-", "");
const database = `leaf-log-check-${id}-db`;
const runner = `leaf-log-check-${id}-runner`;
const artifacts = resolve("test-results/linux-ci", id);
mkdirSync(artifacts, { recursive: true });

function command(executable, args, capture = false) {
  const result = spawnSync(executable, args, { stdio: capture ? "pipe" : "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${executable} exited with ${result.status ?? "a signal"}`);
  return result.stdout;
}

// Include working edits and new source files, excluding ignored dependencies,
// local secrets and build output. Never share Windows node_modules with Linux.
const sourceFiles = command("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], true)
  .toString().split("\0").filter(path => path && existsSync(path));
writeFileSync(resolve(artifacts, "source-files.list"), sourceFiles.join("\0") + "\0");
// SwiftShader counts host CPUs, not the container's affinity. Chromium reads
// its config beside the renderer library during startup, not in the project.
// Change only this disposable image; never modify a developer's browser cache.
writeFileSync(resolve(artifacts, "configure-renderer.cjs"), `
const fs = require("node:fs");
const path = require("node:path");
const libraries = fs.readdirSync("/ms-playwright", { recursive: true })
  .filter(file => path.basename(file) === "libvk_swiftshader.so");
if (!libraries.length) throw new Error("Playwright's SwiftShader libraries were not found.");
for (const library of libraries) {
  fs.writeFileSync(path.join("/ms-playwright", path.dirname(library), "SwiftShader.ini"), "[Processor]\\nThreadCount=4\\n");
}
console.log("Configured four SwiftShader workers in " + libraries.length + " Chromium installations.");
`);
// Generate LF regardless of the host's Git line-ending settings.
writeFileSync(resolve(artifacts, "run.sh"), `set -euo pipefail
cd /work
trap 'for dir in playwright-report test-results; do if [ -d "$dir" ]; then cp -a "$dir" /artifacts/; fi; done' EXIT
tar -C /source --null -T /artifacts/source-files.list -cf - | tar -xf -
npm install --prefix /opt/leaf-node node@${nodeVersion}
export PATH=/opt/leaf-node/node_modules/node/bin:$PATH
node /artifacts/configure-renderer.cjs
corepack pnpm install --frozen-lockfile
corepack pnpm ${mode === "all" ? "check" : `check:${mode}`}
`);

const cleanup = () => {
  // Names are generated for this invocation; never stop another local service.
  spawnSync("docker", ["rm", "--force", runner, database], { stdio: "ignore", windowsHide: true });
};
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { cleanup(); process.exit(1); });
try {
  command("docker", ["run", "--detach", "--rm", "--name", database,
    "--env", "POSTGRES_USER=leaflog", "--env", "POSTGRES_PASSWORD=leaflog", "--env", "POSTGRES_DB=leaf_log_dev",
    "--health-cmd", "pg_isready -U leaflog -d leaf_log_dev", "--health-interval", "1s", "--health-timeout", "5s", "--health-retries", "30",
    "postgres:16-alpine"]);
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    healthy = command("docker", ["inspect", "--format", "{{.State.Health.Status}}", database], true).toString().trim() === "healthy";
    if (healthy) break;
    await setTimeout(500);
  }
  if (!healthy) throw new Error("Isolated PostgreSQL did not become healthy.");
  console.log(`Linux checks: Node ${nodeVersion}, Playwright ${playwrightVersion}, 4 CPUs. Reports: ${artifacts}`);
  // Match the four CPUs supplied to this public repository's hosted runner.
  // A quota alone
  // leaves all host CPUs visible to Chromium's renderer and allows bursts
  // followed by throttling, which is unlike a machine with four available CPUs.
  command("docker", ["run", "--rm", "--init", "--name", runner, "--cpuset-cpus", "0-3", "--shm-size", "1g",
    "--network", `container:${database}`, "--workdir", "/work",
    "--mount", `type=bind,source=${process.cwd()},target=/source,readonly`,
    "--mount", `type=bind,source=${artifacts},target=/artifacts`,
    "--env", "DATABASE_URL=postgresql://leaflog:leaflog@127.0.0.1:5432/leaf_log_dev?schema=public",
    "--env", "AUTH_SECRET=ci-auth-secret-at-least-32-characters-long-000000", "--env", "AUTH_TRUST_HOST=true",
    "--env", "CI=true", "--env", "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
    `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`, "bash", "/artifacts/run.sh"]);
} finally {
  cleanup();
  console.log(`Linux reports: ${artifacts}`);
}
