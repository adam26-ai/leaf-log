import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

/**
 * SPRINT-004 invariant, widened by SPRINT-005: the eight
 * Flight.{takeoff,landing}{Site,Zone}{Id,Name} columns are written ONLY by
 * lib/sites/associate.ts. This audit fails if any other source file both (a)
 * performs a Prisma Flight write call and (b) assigns a non-boolean value to
 * a `*SiteName`/`*ZoneName` key anywhere in that same file — the shape a
 * violation would realistically take (a route/action/script writing the
 * cache directly instead of going through locationCachePatch/
 * resolveLocationCache). A second pattern catches the same violation shape
 * in RAW SQL, since SPRINT-005's site-transition zone-cache recomputation
 * is a `$executeRaw` statement the Prisma-call pattern alone wouldn't see.
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
  // resolveLocationFields()/resolveEndpoint() in lib/flights/repo.ts.
  "lib/flights/repo.ts",
  // The operator remedy script: it deliberately mirrors associate.ts's
  // transition-writer cache logic (rename/force-private/merge) rather than
  // calling the owner-gated functions, since it runs with full DB authority
  // outside any pilot's session. See its own file-level comment.
  "scripts/admin-sites.ts",
]);

const FLIGHT_WRITE_CALL = /\.flight\.(create|update|updateMany|upsert)\s*\(/;
// A `takeoffSiteName:`/`takeoffZoneName:`/etc. key assigned something other
// than the Prisma select flags `true`/`false` — i.e. an actual value write.
// Deliberately NOT `\s*:\s*(?!true\b|false\b)` — a plain negative-lookahead
// with a variable-length `\s*` prefix lets the regex engine backtrack the
// `\s*` to zero width when the lookahead fails, so it silently stops
// excluding `true`/`false` the instant there's a space before the value
// (i.e. on every Prettier-formatted `: true`). Capturing the actual token
// and comparing it in JS sidesteps that backtracking trap entirely.
const LOCATION_NAME_KEY = /(takeoff|landing)(Site|Zone)Name\s*:\s*(\S+)/g;

function hasLocationNameValueAssignment(content: string): boolean {
  for (const m of content.matchAll(LOCATION_NAME_KEY)) {
    const value = m[3].replace(/[,;)}\]]+$/, "");
    if (value !== "true" && value !== "false") return true;
  }
  return false;
}

// The raw-SQL shape of the same violation: a $executeRaw/$queryRaw call in a
// file that also references the "Flight" table and a *Site/*ZoneName column.
// All three co-occurring in one file is the signature of a hand-rolled
// cache write outside the sanctioned helper.
const RAW_SQL_CALL = /\$(executeRaw|queryRaw)/;
const FLIGHT_TABLE_REF = /"Flight"/;
const LOCATION_NAME_COLUMN_REF = /(takeoff|landing)(Site|Zone)Name/;

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

function isViolation(content: string): boolean {
  const prismaCallViolation = FLIGHT_WRITE_CALL.test(content) && hasLocationNameValueAssignment(content);
  const rawSqlViolation =
    RAW_SQL_CALL.test(content) && FLIGHT_TABLE_REF.test(content) && LOCATION_NAME_COLUMN_REF.test(content);
  return prismaCallViolation || rawSqlViolation;
}

describe("site/zone cache write audit", () => {
  it("no file outside the allowlist writes Flight (via Prisma call or raw SQL) and assigns a location-name value", () => {
    const violations: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of listSourceFiles(join(ROOT, dir))) {
        const relPath = relative(ROOT, file).split("\\").join("/");
        if (ALLOWED_FILES.has(relPath)) continue;

        const content = readFileSync(file, "utf8");
        if (isViolation(content)) violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);
  });

  it("sanity: the Prisma-call pattern actually matches associate.ts (a real positive control)", () => {
    const content = readFileSync(join(ROOT, "lib/sites/associate.ts"), "utf8");
    expect(FLIGHT_WRITE_CALL.test(content)).toBe(true);
    expect(hasLocationNameValueAssignment(content)).toBe(true);
  });

  it("the boolean-exclusion survives Prettier-style spacing (`: true`, not `:true`)", () => {
    expect(hasLocationNameValueAssignment("select: { takeoffSiteName: true, landingZoneName: false }")).toBe(false);
    expect(hasLocationNameValueAssignment("select: { takeoffSiteName:true }")).toBe(false);
    expect(hasLocationNameValueAssignment("data: { takeoffSiteName: null }")).toBe(true);
    expect(hasLocationNameValueAssignment("data: { takeoffZoneName: zone.name }")).toBe(true);
  });

  it("sanity: the raw-SQL pattern actually matches associate.ts's zone-cache recomputation (a real positive control)", () => {
    const content = readFileSync(join(ROOT, "lib/sites/associate.ts"), "utf8");
    expect(RAW_SQL_CALL.test(content)).toBe(true);
    expect(FLIGHT_TABLE_REF.test(content)).toBe(true);
    expect(LOCATION_NAME_COLUMN_REF.test(content)).toBe(true);
    expect(isViolation(content)).toBe(true); // it WOULD be flagged if not allowlisted
  });

  it("negative control: an unrelated raw query touching Flight but no location-name column does not false-positive", () => {
    const dir = mkdtempSync(join(tmpdir(), "write-audit-negctl-"));
    try {
      const file = join(dir, "unrelated.ts");
      writeFileSync(
        file,
        `
        export async function countReadyFlights(tx: unknown) {
          return (tx as { $queryRaw: (s: TemplateStringsArray) => Promise<number> }).$queryRaw\`
            SELECT count(*) FROM "Flight" WHERE "status" = 'ready'\`;
        }
        `,
        "utf8",
      );
      const content = readFileSync(file, "utf8");
      expect(isViolation(content)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("negative control: a Prisma Flight write with only boolean select flags does not false-positive", () => {
    const dir = mkdtempSync(join(tmpdir(), "write-audit-negctl2-"));
    try {
      const file = join(dir, "reader.ts");
      writeFileSync(
        file,
        `
        export async function noop(tx: { flight: { updateMany: (a: unknown) => Promise<unknown> } }) {
          // A read-shaped select, not a value write — must never trip the audit.
          return tx.flight.updateMany({ where: {}, data: { takeoffSiteName: true } });
        }
        `,
        "utf8",
      );
      const content = readFileSync(file, "utf8");
      expect(isViolation(content)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
