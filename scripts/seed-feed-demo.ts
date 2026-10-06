/** Local-only, additive layout fixtures. Run: node --import tsx scripts/seed-feed-demo.ts */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { flightTrophies } from "../lib/flights/trophies";
import { METRICS_VERSION, XC_SCORING_VERSION, XC_CATEGORIES } from "../lib/flights/analysis-state";
import { readXcScore } from "../lib/igc/xc-types";
import { customLocationNamePatch } from "../lib/sites/associate";

async function main() {
  const env = parse(readFileSync(".env.local"));
  const url = new URL(env.DATABASE_URL);
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5437" || url.pathname !== "/leaf_log_dev") {
    throw new Error("This fixture script only supports the local leaf_log_dev database on port 5437.");
  }
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const owner = await db.profile.findUniqueOrThrow({ where: { handle: "uicompanion" }, select: { id: true, displayName: true } });
    if (owner.id !== "ui-demo-companion-user" || owner.displayName !== "Sky Friend (demo)") throw new Error("Expected the existing demo account.");
    const template = await db.flight.findUniqueOrThrow({ where: { id: "ui-demo-companion-2jaz" }, include: { data: true } });
    if (template.ownerId !== owner.id || !template.data || !template.takeoffAt) throw new Error("Missing demo recording.");
    const takeoffAt = template.takeoffAt;
    const originalScore = readXcScore(template.xcScore);
    if (!originalScore) throw new Error("Missing demo XC route template.");
    const cases = [
      { key: "all-six", site: "Mission Peak — All six trophies (demo)", source: "device_push", duration: 30000, altitude: 6500, launch: 500, distances: [150000, 130000, 120000] },
      { key: "four-silver", site: "Mount Saint Helena — North Launch (demo)", source: "web_upload", duration: 900, altitude: 5000, launch: 4800, distances: [100000, 95000, 90000] },
      { key: "duration", site: "Coastal ridge — Duration medal (demo)", source: "manual_entry", duration: 22000, altitude: 450, launch: 400, distances: [] },
      { key: "mixed-medals", site: "Mission Peak — Mixed medals (demo)", source: "web_upload", duration: 18000, altitude: 4200, launch: 500, distances: [80000] },
      { key: "height-gain", site: "Mountain launch — Height gain (demo)", source: "device_push", duration: 600, altitude: 3500, launch: 100, distances: [] },
      { key: "manual", site: "Training hill (demo)", source: "manual_entry", duration: 240, altitude: 120, launch: 110, distances: [] },
      { key: "imported", site: "A very long coastal launch name for spacing (demo)", source: "csv_import", duration: 1800, altitude: 180, launch: 160, distances: [] },
    ];
    await db.$transaction(async tx => {
      for (const [index, fixture] of cases.entries()) {
        const id = `ui-demo-feed-${fixture.key}`;
        const existing = await tx.flight.findUnique({ where: { id } });
        if (existing) {
          if (existing.ownerId !== owner.id) throw new Error(`Fixture ID collision: ${id}`);
          continue; // Preserve edits and kudos when rerun.
        }
        const recorded = !["manual_entry", "csv_import"].includes(fixture.source);
        const candidates = fixture.distances.map((distanceM, i) => {
          const shape = XC_CATEGORIES[i];
          const route = originalScore.candidates.find(c => c.shape === shape)!;
          return { ...route, distanceM, points: distanceM / 1000 * route.multiplier };
        });
        const score = { version: 1, rules: "XContest", scoringVersion: XC_SCORING_VERSION, complete: true,
          completedCategories: [...XC_CATEGORIES], approximate: false, best: candidates[0] ?? null, candidates,
          ...(candidates.length ? {} : { emptyReason: "no_eligible_route" }) };
        await tx.flight.create({ data: {
          id, ownerId: owner.id, visibility: index % 2 ? "public" : "friends", source: fixture.source,
          recordingKind: recorded ? "igc" : "logbook", status: "ready", xcStatus: "ready", metricsVersion: METRICS_VERSION,
          igcSha256: recorded ? createHash("sha256").update(id).digest("hex") : null,
          parserVersion: template.parserVersion, notes: "Synthetic local UI fixture. Metrics and XC distances are invented for layout testing; recorded fixtures reuse the existing demo track. Not a real flight.",
          pilot: owner.displayName, glider: "Demo wing", flightDate: template.flightDate,
          takeoffAt, landingAt: new Date(takeoffAt.getTime() + fixture.duration * 1000),
          localTz: template.localTz, localUtcOffsetMinutes: template.localUtcOffsetMinutes,
          durationS: fixture.duration, maxAltM: fixture.altitude, launchAltM: fixture.launch,
          xcScore: recorded ? JSON.parse(JSON.stringify(score)) as Prisma.InputJsonValue : Prisma.JsonNull,
          ...(fixture.source === "csv_import" ? { reportedXcDistanceM: 12000, reportedXcType: "open" } : {}),
          takeoffLat: template.takeoffLat, takeoffLon: template.takeoffLon, landingLat: template.landingLat, landingLon: template.landingLon,
          bounds: template.bounds as Prisma.InputJsonValue,
          ...customLocationNamePatch(fixture.site, "takeoff"), takeoffSiteAssignment: "custom_name",
          ...customLocationNamePatch(index === 1 ? "Robert Louis Stevenson State Park — Valley Landing (demo)" : fixture.site, "landing"),
          landingSiteAssignment: "custom_name",
          ...(recorded ? { data: { create: { rawIgc: template.data!.rawIgc, track: template.data!.track as Prisma.InputJsonValue, replay: template.data!.replay ?? Prisma.JsonNull } } } : {}),
        } });
      }
    });
    // Real local Kudo records keep the normal count and toggle behavior intact.
    // Fixture-only supporters have no email, sessions, friendships, or flights.
    const kudoTargets = [128, 42, 7, 99, 3, 0, 105];
    await db.$transaction(async tx => {
      const supporters = Array.from({ length: Math.max(...kudoTargets) }, (_, i) => ({
        id: `ui-demo-kudos-${i + 1}`, handle: `demokudos${i + 1}`, displayName: `Demo supporter ${i + 1}`,
      }));
      await tx.user.createMany({ data: supporters.map(s => ({ id: s.id, name: s.displayName })), skipDuplicates: true });
      await tx.profile.createMany({ data: supporters, skipDuplicates: true });
      for (const [index, fixture] of cases.entries()) {
        const flightId = `ui-demo-feed-${fixture.key}`;
        const existing = await tx.kudo.findMany({ where: { flightId }, select: { profileId: true } });
        const used = new Set(existing.map(k => k.profileId));
        const needed = Math.max(0, kudoTargets[index] - existing.length);
        const additions = supporters.filter(s => !used.has(s.id)).slice(0, needed);
        if (additions.length) await tx.kudo.createMany({ data: additions.map(s => ({ flightId, profileId: s.id })), skipDuplicates: true });
      }
    });
    console.log("Demo kudos:", await db.kudo.groupBy({ by: ["flightId"], where: { flightId: { in: cases.map(c => `ui-demo-feed-${c.key}`) } }, _count: true }));
    const history = await db.flight.findMany({ where: { ownerId: owner.id } });
    const trophies = flightTrophies(history);
    const full = trophies["ui-demo-feed-all-six"] ?? [];
    if (full.length !== 6) throw new Error(`Expected all six trophies, found ${full.length}.`);
    console.log(JSON.stringify(cases.map(c => ({ id: `ui-demo-feed-${c.key}`, source: c.source,
      trophies: (trophies[`ui-demo-feed-${c.key}`] ?? []).map(t => `${t.category}: ${t.rank}`) })), null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
