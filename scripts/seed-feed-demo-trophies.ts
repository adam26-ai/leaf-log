/** Give existing Sky Friend examples a mix of zero, one, and two trophies.
 * Local-only: node --import tsx scripts/seed-feed-demo-trophies.ts
 * Metrics and distances are synthetic; recordings and kudos are preserved.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { flightTrophies } from "../lib/flights/trophies";
import { METRICS_VERSION, XC_SCORING_VERSION, XC_CATEGORIES } from "../lib/flights/analysis-state";
import { readXcScore, type XcShape } from "../lib/igc/xc-types";

async function main() {
  const env = parse(readFileSync(".env.local"));
  const url = new URL(env.DATABASE_URL);
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.port !== "5437" || url.pathname !== "/leaf_log_dev") {
    throw new Error("Only the local leaf_log_dev database on port 5437 is supported.");
  }
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle: "uicompanion" } });
    if (owner.id !== "ui-demo-companion-user" || owner.displayName !== "Sky Friend (demo)") throw new Error("Expected demo account.");
    const cases: { id: string; data: Prisma.FlightUpdateInput; zeroTrophies?: boolean; route?: { shape: XcShape; distanceM: number } }[] = [
      { id: "ui-demo-feed-all-six", data: { maxAltM: 1000, launchAltM: 400,
        takeoffSiteName: "Mission Peak — Duration and height gain (demo)",
        landingSiteName: "Mission Peak — Duration and height gain (demo)" } },
      { id: "ui-demo-feed-four-silver", data: {}, route: { shape: "open", distanceM: 100000 } },
      { id: "ui-demo-feed-duration", data: { reportedXcType: null, reportedXcDistanceM: null } },
      { id: "ui-demo-feed-mixed-medals", data: { maxAltM: 1000, launchAltM: 300 } },
      { id: "ui-demo-feed-height-gain", data: {}, route: { shape: "fai-triangle", distanceM: 120000 } },
      { id: "ui-demo-feed-manual", zeroTrophies: true, data: { reportedXcType: null, reportedXcDistanceM: null } },
      { id: "ui-demo-feed-imported", zeroTrophies: true, data: { reportedXcType: null, reportedXcDistanceM: null } },
      { id: "ui-demo-companion-2jaz", data: { maxAltM: 4200, launchAltM: 3800 }, route: { shape: "open", distanceM: 11940 } },
      { id: "ui-demo-companion-piso", data: { maxAltM: 4500 }, route: { shape: "fai-triangle", distanceM: 1080 } },
      { id: "ui-demo-companion-ydtq", zeroTrophies: true, data: {} },
    ];
    const before = await db.flight.findMany({ where: { ownerId: owner.id, id: { in: cases.map(c => c.id) } } });
    if (before.length !== cases.length) throw new Error("Expected all existing demo flights.");
    // Collect from all examples so reruns also work after routes have been split up.
    const templates = before.flatMap(f => readXcScore(f.xcScore)?.candidates ?? []);
    if (!cases.every(c => !c.route || templates.some(route => route.shape === c.route!.shape))) throw new Error("Missing demo route templates.");
    mkdirSync("test-results", { recursive: true });
    writeFileSync(`test-results/demo-trophies-before-${Date.now()}.json`, JSON.stringify(before.map(f => ({
      id: f.id, maxAltM: f.maxAltM, launchAltM: f.launchAltM, takeoffSiteName: f.takeoffSiteName, landingSiteName: f.landingSiteName,
      reportedXcType: f.reportedXcType, reportedXcDistanceM: f.reportedXcDistanceM,
      metricsVersion: f.metricsVersion, xcStatus: f.xcStatus, xcScore: f.xcScore,
    })), null, 2));
    const summary = await db.$transaction(async tx => {
      for (const fixture of cases) {
        const current = before.find(f => f.id === fixture.id)!;
        const recorded = current.recordingKind !== "logbook";
        const route = fixture.route && templates.find(c => c.shape === fixture.route!.shape);
        if (fixture.route && !route) throw new Error(`Missing route template: ${fixture.id}`);
        const candidates = route && fixture.route ? [{ ...route, distanceM: fixture.route.distanceM,
          points: fixture.route.distanceM / 1000 * route.multiplier }] : [];
        const score = {
          version: 1, rules: "XContest", scoringVersion: XC_SCORING_VERSION, complete: true,
          completedCategories: [...XC_CATEGORIES], approximate: false, best: candidates[0] ?? null, candidates,
          ...(candidates.length ? {} : { emptyReason: "no_eligible_route" }),
        };
        await tx.flight.update({ where: { id: fixture.id }, data: {
          ...fixture.data, metricsVersion: METRICS_VERSION,
          ...(recorded ? { xcStatus: "ready", xcScore: JSON.parse(JSON.stringify(score)) as Prisma.InputJsonValue } : {}),
        } });
      }
      const history = await tx.flight.findMany({ where: { ownerId: owner.id } });
      const trophies = flightTrophies(history);
      for (const flight of history) {
        const count = (trophies[flight.id] ?? []).length;
        const fixture = cases.find(c => c.id === flight.id);
        if (count > 2 || (fixture && (fixture.zeroTrophies ? count !== 0 : count < 1))) {
          throw new Error(`Unexpected demo trophy count: ${flight.id} has ${count}.`);
        }
      }
      const counts = new Set(cases.map(c => (trophies[c.id] ?? []).length));
      if (![0, 1, 2].every(count => counts.has(count))) throw new Error("Expected examples with zero, one, and two trophies.");
      return cases.map(c => ({ id: c.id, trophies: (trophies[c.id] ?? []).map(t => `${t.category}: ${t.rank}`) }));
    });
    console.log(JSON.stringify(summary, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
