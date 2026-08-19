import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * SPRINT-004 invariant: Flight.{takeoff,landing}SiteName is written ONLY by
 * lib/sites/associate.ts. This audit fails if any other source file both (a)
 * performs a Prisma Flight write call and (b) assigns a non-boolean value to
 * a `takeoffSiteName`/`landingSiteName` key anywhere in that same file — the
 * shape a violation would realistically take (a route/action/script writing
 * the cache directly instead of going through siteCachePatch/resolveSiteCache).
 *
 * A textual, file-level audit rather than an AST check — coarser than full
 * static analysis, but enough to catch the realistic danger without building
 * a bespoke parser, and it's re-run on every `pnpm test`.
 */

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "lib", "scripts"];
const ALLOWED_FILES = new Set([
  "lib/sites/associate.ts",
  // Read-path DTO construction (in-memory, never persisted) — see
  // resolveSiteFields()/resolveEndpoint() in lib/flights/repo.ts.
  "lib/flights/repo.ts",
]);

const FLIGHT_WRITE_CALL = /\.flight\.(create|update|updateMany|upsert)\s*\(/;
// A `takeoffSiteName:`/`landingSiteName:` key assigned something other than
// the Prisma select flags `true`/`false` — i.e. an actual value write.
const SITE_NAME_VALUE_ASSIGNMENT = /(takeoff|landing)SiteName\s*:\s*(?!true\b|false\b)/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("site cache write audit", () => {
  it("no file outside the allowlist both writes Flight and assigns a site-name value", () => {
    const violations: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of listSourceFiles(join(ROOT, dir))) {
        const relPath = relative(ROOT, file).split("\\").join("/");
        if (ALLOWED_FILES.has(relPath)) continue;

        const content = readFileSync(file, "utf8");
        if (FLIGHT_WRITE_CALL.test(content) && SITE_NAME_VALUE_ASSIGNMENT.test(content)) {
          violations.push(relPath);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("sanity: the audit's own patterns actually match associate.ts (a real positive control)", () => {
    const content = readFileSync(join(ROOT, "lib/sites/associate.ts"), "utf8");
    expect(FLIGHT_WRITE_CALL.test(content)).toBe(true);
    expect(SITE_NAME_VALUE_ASSIGNMENT.test(content)).toBe(true);
  });
});
