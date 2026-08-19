/**
 * Backfill named sites for flights missing a takeoff or landing site (e.g.
 * ingested before site lookup existed, or after the site catalogue grows).
 * Idempotent — only touches flights missing at least one endpoint's site.
 * Writes only through lib/sites/associate.ts's siteCachePatch, the sole
 * writer of the denormalized Flight.{takeoff,landing}Site{Id,Name} columns.
 *
 *   pnpm exec tsx scripts/backfill-sites.ts
 *   pnpm exec tsx scripts/backfill-sites.ts --site-id <id>    # only flights that match this site
 *   pnpm exec tsx scripts/backfill-sites.ts --public-only     # skip private-site matches
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "@/lib/prisma";
import { findSite, type SiteMatch } from "@/lib/sites/lookup";
import { siteCachePatch, type SiteFieldPatch } from "@/lib/sites/associate";

function parseArgs(argv: string[]): { siteId: string | null; publicOnly: boolean } {
  let siteId: string | null = null;
  let publicOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--site-id") siteId = argv[++i] ?? null;
    else if (argv[i] === "--public-only") publicOnly = true;
  }
  return { siteId, publicOnly };
}

async function main() {
  const { siteId: onlySiteId, publicOnly } = parseArgs(process.argv.slice(2));

  const flights = await prisma.flight.findMany({
    where: { OR: [{ takeoffSiteId: null }, { landingSiteId: null }] },
    select: {
      id: true,
      ownerId: true,
      takeoffSiteId: true,
      landingSiteId: true,
      takeoffLat: true,
      takeoffLon: true,
      landingLat: true,
      landingLon: true,
    },
  });

  function accepted(match: SiteMatch | null): match is SiteMatch {
    if (!match) return false;
    if (onlySiteId && match.id !== onlySiteId) return false;
    if (publicOnly && match.visibility !== "public") return false;
    return true;
  }

  let updated = 0;
  for (const f of flights) {
    // Scoped to the flight's own owner: an operator sweep records what that
    // pilot could name for their own flight (public sites ∪ their own
    // private ones) — the same write-time scope ingestFlight uses.
    const [takeoffMatch, landingMatch] = await Promise.all([
      f.takeoffSiteId === null && f.takeoffLat != null && f.takeoffLon != null
        ? findSite(prisma, {
            lat: f.takeoffLat,
            lon: f.takeoffLon,
            kind: "takeoff",
            viewerId: f.ownerId,
          })
        : null,
      f.landingSiteId === null && f.landingLat != null && f.landingLon != null
        ? findSite(prisma, {
            lat: f.landingLat,
            lon: f.landingLon,
            kind: "landing",
            viewerId: f.ownerId,
          })
        : null,
    ]);

    const takeoff = accepted(takeoffMatch) ? takeoffMatch : null;
    const landing = accepted(landingMatch) ? landingMatch : null;
    if (!takeoff && !landing) continue;

    const patch: SiteFieldPatch = {
      ...(takeoff ? siteCachePatch(takeoff, "takeoff") : {}),
      ...(landing ? siteCachePatch(landing, "landing") : {}),
    };
    await prisma.flight.update({ where: { id: f.id }, data: patch });
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
