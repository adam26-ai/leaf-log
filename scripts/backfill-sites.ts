/**
 * Backfill named sites for flights missing a takeoff or landing site (e.g.
 * ingested before site lookup existed, or after the site catalogue grows).
 * Idempotent — only touches flights missing at least one endpoint's site.
 * Writes only through lib/sites/associate.ts's locationCachePatch, the sole
 * writer of the denormalized Flight.{takeoff,landing}{Site,Zone}{Id,Name}
 * columns.
 *
 *   pnpm exec tsx scripts/backfill-sites.ts
 *   pnpm exec tsx scripts/backfill-sites.ts --site-id <id>    # only flights that match this site
 *   pnpm exec tsx scripts/backfill-sites.ts --public-only     # skip private-site matches
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "@/lib/prisma";
import { findLocation, type SiteMatch } from "@/lib/sites/lookup";
import { locationCachePatch, type LocationFieldPatch } from "@/lib/sites/associate";

export interface BackfillOptions {
  siteId?: string | null;
  publicOnly?: boolean;
}

export function parseArgs(argv: string[]): { siteId: string | null; publicOnly: boolean } {
  let siteId: string | null = null;
  let publicOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--site-id") siteId = argv[++i] ?? null;
    else if (argv[i] === "--public-only") publicOnly = true;
  }
  return { siteId, publicOnly };
}

/**
 * The core sweep, exported so it's testable directly against a real
 * Postgres without shelling out to the CLI. Owner-scoped: every match is
 * looked up as the flight's own owner would see it (public sites ∪ their
 * own private ones) — the same write-time scope ingestFlight uses.
 */
export async function runBackfill(options: BackfillOptions = {}): Promise<number> {
  const onlySiteId = options.siteId ?? null;
  const publicOnly = options.publicOnly ?? false;

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
    // SPRINT-005: findLocation resolves a zone-first match with a site
    // fallback; this offline maintenance script still writes the SITE
    // portion only. Zone-aware backfill has no urgency (production has no
    // Zone rows yet) and can follow whenever it's actually needed.
    const [takeoffMatch, landingMatch] = await Promise.all([
      f.takeoffSiteId === null && f.takeoffLat != null && f.takeoffLon != null
        ? findLocation(prisma, {
            lat: f.takeoffLat,
            lon: f.takeoffLon,
            kind: "takeoff",
            viewerId: f.ownerId,
          })
        : null,
      f.landingSiteId === null && f.landingLat != null && f.landingLon != null
        ? findLocation(prisma, {
            lat: f.landingLat,
            lon: f.landingLon,
            kind: "landing",
            viewerId: f.ownerId,
          })
        : null,
    ]);

    const takeoff = accepted(takeoffMatch?.site ?? null) ? takeoffMatch!.site : null;
    const landing = accepted(landingMatch?.site ?? null) ? landingMatch!.site : null;
    if (!takeoff && !landing) continue;

    const patch: LocationFieldPatch = {
      ...(takeoff ? locationCachePatch(takeoff, null, "takeoff") : {}),
      ...(landing ? locationCachePatch(landing, null, "landing") : {}),
    };
    await prisma.flight.update({ where: { id: f.id }, data: patch });
    updated++;
  }
  return updated;
}

async function main() {
  const updated = await runBackfill(parseArgs(process.argv.slice(2)));
  console.log(`backfilled ${updated} flight(s)`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
