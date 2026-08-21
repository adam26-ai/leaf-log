// @vitest-environment node
//
// SPRINT-005: smoke coverage for the zone operator commands in
// admin-sites.ts. These run with full DB authority outside any pilot's
// session — the point of the tests is to prove the cache-writing logic is
// correct, not to re-litigate ownership guards (there are none here by
// design).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for admin-sites integration tests.");
}

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("admin-sites.ts — zone commands", () => {
  let prisma: import("@/lib/prisma").Db;
  const ids: string[] = [];
  const siteIds: string[] = [];
  const zoneIds: string[] = [];
  const flightIds: string[] = [];
  let seq = 0;

  async function createPilot(label: string) {
    const handle = `${label}${ids.length}${suffix}`.slice(0, 20).toLowerCase();
    const user = await prisma.user.create({
      data: { email: `${handle}@test.local`, profile: { create: { handle, displayName: label } } },
    });
    ids.push(user.id);
    return user.id;
  }

  async function createSite(opts: { lat: number; lon: number; visibility: "private" | "public"; ownerId: string | null }) {
    seq += 1;
    const name = `Admin Test Site ${seq}${suffix}`;
    const site = await prisma.site.create({
      data: {
        name,
        normalizedName: name.toLowerCase(),
        lat: opts.lat,
        lon: opts.lon,
        kind: "takeoff",
        visibility: opts.visibility,
        ownerId: opts.ownerId,
        source: "user",
      },
    });
    siteIds.push(site.id);
    return site;
  }

  async function createZone(opts: {
    siteId: string;
    lat: number;
    lon: number;
    visibility: "private" | "public";
    ownerId: string | null;
    kind?: "takeoff" | "landing" | "both";
  }) {
    seq += 1;
    const name = `Admin Test Zone ${seq}${suffix}`;
    const zone = await prisma.zone.create({
      data: {
        siteId: opts.siteId,
        name,
        normalizedName: name.toLowerCase(),
        lat: opts.lat,
        lon: opts.lon,
        kind: opts.kind ?? "takeoff",
        visibility: opts.visibility,
        ownerId: opts.ownerId,
      },
    });
    zoneIds.push(zone.id);
    return zone;
  }

  async function createFlightWithZone(opts: {
    ownerId: string;
    site: { id: string; name: string; visibility: string };
    zone: { id: string; name: string; visibility: string; siteId: string };
    endpoint: "takeoff" | "landing";
  }) {
    const { locationCachePatch } = await import("@/lib/sites/associate");
    const patch = locationCachePatch(opts.site, opts.zone, opts.endpoint);
    seq += 1;
    const flight = await prisma.flight.create({
      data: { ownerId: opts.ownerId, visibility: "public", status: "ready", igcSha256: `admin${suffix}${seq}`, ...patch },
    });
    flightIds.push(flight.id);
    return flight;
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.flight.deleteMany({ where: { id: { in: flightIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("zone-rename updates the name and the cache on referencing flights", async () => {
    const { zoneRename } = await import("./admin-sites");
    const owner = await createPilot("adminrenameowner");
    const site = await createSite({ lat: -199, lon: -199, visibility: "public", ownerId: owner });
    const zone = await createZone({ siteId: site.id, lat: -199, lon: -199, visibility: "public", ownerId: owner });
    const flight = await createFlightWithZone({ ownerId: owner, site, zone, endpoint: "takeoff" });

    await zoneRename(zone.id, "Operator Renamed Zone");

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(row.takeoffZoneName).toBe("Operator Renamed Zone");
  });

  it("zone-force-private demotes regardless of references and nulls the cache", async () => {
    const { zoneForcePrivate } = await import("./admin-sites");
    const owner = await createPilot("adminforceprivowner");
    const other = await createPilot("adminforceprivother");
    const site = await createSite({ lat: -198, lon: -198, visibility: "public", ownerId: owner });
    const zone = await createZone({ siteId: site.id, lat: -198, lon: -198, visibility: "public", ownerId: owner });
    await createFlightWithZone({ ownerId: owner, site, zone, endpoint: "takeoff" });
    const otherFlight = await createFlightWithZone({ ownerId: other, site, zone, endpoint: "takeoff" });

    // Deliberately overrides the creator-undo guard — that's the point.
    await zoneForcePrivate(zone.id);

    const zoneRow = await prisma.zone.findUniqueOrThrow({ where: { id: zone.id } });
    expect(zoneRow.visibility).toBe("private");
    const row = await prisma.flight.findUniqueOrThrow({ where: { id: otherFlight.id } });
    expect(row.takeoffZoneId).toBe(zone.id); // still bound
    expect(row.takeoffZoneName).toBeNull(); // cache cleared
  });

  it("zone-merge reassigns flights (even across sites) and deletes the source zone", async () => {
    const { zoneMerge } = await import("./admin-sites");
    const owner = await createPilot("adminmergeowner");
    const siteA = await createSite({ lat: -197, lon: -197, visibility: "public", ownerId: owner });
    const siteB = await createSite({ lat: -196, lon: -196, visibility: "public", ownerId: owner });
    const fromZone = await createZone({ siteId: siteA.id, lat: -197, lon: -197, visibility: "public", ownerId: owner, kind: "landing" });
    const intoZone = await createZone({ siteId: siteB.id, lat: -196, lon: -196, visibility: "public", ownerId: owner, kind: "takeoff" });
    const flight = await createFlightWithZone({ ownerId: owner, site: siteA, zone: fromZone, endpoint: "takeoff" });

    await zoneMerge(fromZone.id, intoZone.id);
    zoneIds.splice(zoneIds.indexOf(fromZone.id), 1); // deleted by the merge

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(row.takeoffSiteId).toBe(siteB.id); // reparented to the target's site
    expect(row.takeoffZoneId).toBe(intoZone.id);
    expect(row.takeoffZoneName).toBe(intoZone.name);

    const stale = await prisma.zone.findUnique({ where: { id: fromZone.id } });
    expect(stale).toBeNull();

    const widened = await prisma.zone.findUniqueOrThrow({ where: { id: intoZone.id } });
    expect(widened.kind).toBe("both"); // widened, never narrowed
  });

  it("zone-merge refuses to merge a zone into itself", async () => {
    const { zoneMerge } = await import("./admin-sites");
    const owner = await createPilot("adminmergeselfowner");
    const site = await createSite({ lat: -195, lon: -195, visibility: "public", ownerId: owner });
    const zone = await createZone({ siteId: site.id, lat: -195, lon: -195, visibility: "public", ownerId: owner });

    await expect(zoneMerge(zone.id, zone.id)).rejects.toThrow(/itself/);
  });
});
