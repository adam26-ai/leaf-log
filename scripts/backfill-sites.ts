/**
 * Backfill named sites for flights ingested before site lookup existed (or after
 * the site catalogue grows). Idempotent — only touches flights missing a site.
 *
 *   pnpm exec tsx scripts/backfill-sites.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "@/lib/prisma";
import { findSite } from "@/lib/sites/lookup";

async function main() {
  const flights = await prisma.flight.findMany({
    where: { takeoffSiteId: null, takeoffLat: { not: null } },
    select: { id: true, takeoffLat: true, takeoffLon: true, landingLat: true, landingLon: true },
  });

  let updated = 0;
  for (const f of flights) {
    const [takeoff, landing] = await Promise.all([
      f.takeoffLat != null && f.takeoffLon != null
        ? findSite(prisma, f.takeoffLat, f.takeoffLon, "takeoff")
        : null,
      f.landingLat != null && f.landingLon != null
        ? findSite(prisma, f.landingLat, f.landingLon, "landing")
        : null,
    ]);
    if (!takeoff && !landing) continue;
    await prisma.flight.update({
      where: { id: f.id },
      data: {
        takeoffSiteId: takeoff?.id ?? null,
        takeoffSiteName: takeoff?.name ?? null,
        landingSiteId: landing?.id ?? null,
        landingSiteName: landing?.name ?? null,
      },
    });
    updated++;
  }
  console.log(`backfilled ${updated} flight(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
