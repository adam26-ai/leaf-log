import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { planSites, type EndpointInput } from "./resolution";
import { hasSitePoint } from "./model";
import { siteVisibleWhere } from "./repo";
import { writeMigratedEndpoint } from "./associate";
import { entrySiteSelect, commitEntrySites, sitePlanSignature } from "@/lib/logbook/locations";
import { lockFlightRow } from "./locks";

type MigrationDb = Pick<typeof prisma, "flight" | "site">;
async function migrationPlan(db: MigrationDb, ownerId: string) {
  const flights = await db.flight.findMany({ where: { ownerId, OR: [
    { takeoffSiteId: null, takeoffSiteName: { not: null }, takeoffSiteAssignment: { not: "cleared" } },
    { landingSiteId: null, landingSiteName: { not: null }, landingSiteAssignment: { not: "cleared" } },
  ] }, orderBy: { id: "asc" } });
  const inputs: EndpointInput[] = [];
  for (const flight of flights) for (const endpoint of ["takeoff", "landing"] as const) {
    if (flight[`${endpoint}SiteId`] || !flight[`${endpoint}SiteName`] || flight[`${endpoint}SiteAssignment`] === "cleared") continue;
    inputs.push({ key: `${flight.id}:${endpoint}`, endpoint, name: flight[`${endpoint}SiteName`]!, lat: flight[`${endpoint}Lat`], lon: flight[`${endpoint}Lon`] });
  }
  const candidates = await db.site.findMany({ where: { ...siteVisibleWhere(ownerId), archivedAt: null }, select: entrySiteSelect });
  const plan = planSites(inputs, candidates, ownerId);
  const signature = createHash("sha256").update(JSON.stringify({ plan: sitePlanSignature(plan, candidates), flights: flights.map(flight => [flight.id, flight.updatedAt.toISOString()]) })).digest("hex");
  return { flights, inputs, candidates, plan, signature };
}

/** This is an explicit historical conversion, never called by a page render or deployment. */
export async function previewSiteMigration(ownerId: string) {
  const { plan, signature } = await migrationPlan(prisma, ownerId);
  return { signature, endpoints: plan.resolutions.length, mapped: plan.groups.filter(group => hasSitePoint(group.draft)).length,
    unmapped: plan.groups.filter(group => !hasSitePoint(group.draft)).length,
    reused: plan.resolutions.filter(row => row.siteId).length, review: plan.resolutions.filter(row => row.outcome === "review").length,
    unchanged: plan.resolutions.filter(row => !row.siteId && !row.groupKey).length };
}

export async function applySiteMigration(ownerId: string, expectedSignature: string, onProgress?: (message: string) => void) {
  return prisma.$transaction(async tx => {
    onProgress?.("Checking the preview and waiting for the logbook lock...");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
    const { plan, candidates, flights, inputs, signature } = await migrationPlan(tx, ownerId);
    if (signature !== expectedSignature) throw new Error("The historical site preview changed. Preview again before applying it.");
    onProgress?.(`Preparing ${plan.groups.length} site groups for ${plan.resolutions.length} endpoints. Changes are not committed yet.`);
    const committed = await commitEntrySites(tx, ownerId, plan, candidates, `unified-sites-v1:${ownerId}`, "legacy");
    onProgress?.("Sites prepared. Linking flight endpoints...");
    let converted = 0;
    for (const row of plan.resolutions) {
      const id = row.siteId ?? (row.groupKey ? committed.groupIds.get(row.groupKey) : null);
      const site = id ? committed.sites.get(id) : null;
      if (!site) continue;
      const input = inputs.find(input => input.key === row.key)!;
      const flight = flights.find(flight => row.key === `${flight.id}:${input.endpoint}`)!;
      await lockFlightRow(tx, flight.id, ownerId);
      const endpoint = input.endpoint;
      const updated = await writeMigratedEndpoint(tx, { ownerId, flightId: flight.id, expectedUpdatedAt: flight.updatedAt, endpoint, site, needsReview: row.outcome === 'review',
        evidence: !flight[`${endpoint}LocationEvidence`] ? { name: input.name, lat: input.lat, lon: input.lon, source: 'legacy', meaning: 'unknown' } : undefined,
      });
      if (!updated.count) throw new Error("A flight changed during conversion. No changes for this pilot were saved.");
      converted++;
      if (converted % 25 === 0) onProgress?.(`${converted} endpoints linked so far. Changes are not committed yet.`);
    }
    onProgress?.(`Committing ${converted} converted endpoints...`);
    return { converted, createdSites: committed.changes.filter(change => change.created).length };
  // Historical conversions over a remote database can require hundreds of
  // round trips. Keep the all-or-nothing transaction, with time for maintenance.
  }, { maxWait: 10000, timeout: 600000 });
}
