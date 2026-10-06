import { readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

// Only run in CI or its disposable Linux container, against an explicit browser
// directory. Do not change the developer's installed browser configuration.
if (process.platform !== "linux" || !process.env.CI || process.argv.length !== 3) {
  throw new Error("Usage in Linux CI: node scripts/configure-swiftshader.mjs <browser-directory>");
}
const browserDirectory = resolve(process.argv[2]);
const libraries = readdirSync(browserDirectory, { recursive: true })
  .filter(file => basename(file) === "libvk_swiftshader.so");
if (!libraries.length) throw new Error("Playwright's SwiftShader libraries were not found.");
for (const library of libraries) {
  writeFileSync(resolve(browserDirectory, dirname(library), "SwiftShader.ini"), "[Processor]\nThreadCount=4\n");
}
console.log(`Configured four SwiftShader workers in ${libraries.length} Chromium installations.`);
