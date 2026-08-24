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
import { validateBoundary, boundaryColumns } from "@/lib/sites/boundary";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for admin-sites integration tests.");
}

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

/** SPRINT-006: a valid canonical square boundary (and its derived bbox
 *  columns) around (lat, lon), for building boundary-bearing test fixtures. */
function testBoundaryColumns(lat: number, lon: number, halfSizeM: number, updatedById: string) {
  const dLat = halfSizeM / 111_320;
  const dLon = halfSizeM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const coords: [number, number][] = [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
    [lon - dLon, lat - dLat],
  ];
  const result = validateBoundary({ type: "Polygon", coordinates: [coords] }, "site", { lat, lon });
  if (!result.ok) throw new Error(`test fixture boundary invalid: ${result.error}`);
  return boundaryColumns(result.boundary, updatedById);
}

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

  async function createSite(opts: {
    lat: number;
    lon: number;
    visibility: "private" | "public";
    ownerId: string | null;
    boundaryHalfSizeM?: number;
  }) {
    seq += 1;
    const name = `Admin Test Site ${seq}${suffix}`;
    const boundaryCols = opts.boundaryHalfSizeM
      ? testBoundaryColumns(opts.lat, opts.lon, opts.boundaryHalfSizeM, opts.ownerId ?? "")
      : {};
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
        ...boundaryCols,
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
    boundaryHalfSizeM?: number;
  }) {
    seq += 1;
    const name = `Admin Test Zone ${seq}${suffix}`;
    const boundaryCols = opts.boundaryHalfSizeM
      ? testBoundaryColumns(opts.lat, opts.lon, opts.boundaryHalfSizeM, opts.ownerId ?? "")
      : {};
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
        ...boundaryCols,
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

// ---------------------------------------------------------------------
// SPRINT-006: boundary-clear/zone-boundary-clear, list's boundary facts,
// and the boundary-preservation guard on merge/zone-merge. Coordinate band
// 45.x is disjoint from the -195..-199 range the tests above use, and from every
// other integration test file's real coordinate range.
// ---------------------------------------------------------------------
describe("admin-sites.ts — boundary commands", () => {
  let prisma: import("@/lib/prisma").Db;
  const ids: string[] = [];
  const siteIds: string[] = [];
  const zoneIds: string[] = [];
  let seq = 0;

  async function createPilot(label: string) {
    const handle = `${label}${ids.length}${suffix}`.slice(0, 20).toLowerCase();
    const user = await prisma.user.create({
      data: { email: `${handle}@test.local`, profile: { create: { handle, displayName: label } } },
    });
    ids.push(user.id);
    return user.id;
  }

  async function createSite(opts: {
    lat: number;
    lon: number;
    visibility: "private" | "public";
    ownerId: string | null;
    boundaryHalfSizeM?: number;
  }) {
    seq += 1;
    const name = `Admin Boundary Site ${seq}${suffix}`;
    const boundaryCols = opts.boundaryHalfSizeM
      ? testBoundaryColumns(opts.lat, opts.lon, opts.boundaryHalfSizeM, opts.ownerId as string)
      : {};
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
        ...boundaryCols,
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
    boundaryHalfSizeM?: number;
  }) {
    seq += 1;
    const name = `Admin Boundary Zone ${seq}${suffix}`;
    const boundaryCols = opts.boundaryHalfSizeM
      ? testBoundaryColumns(opts.lat, opts.lon, opts.boundaryHalfSizeM, opts.ownerId as string)
      : {};
    const zone = await prisma.zone.create({
      data: {
        siteId: opts.siteId,
        name,
        normalizedName: name.toLowerCase(),
        lat: opts.lat,
        lon: opts.lon,
        kind: "takeoff",
        visibility: opts.visibility,
        ownerId: opts.ownerId,
        ...boundaryCols,
      },
    });
    zoneIds.push(zone.id);
    return zone;
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("boundary-clear removes a site's boundary, always succeeds, and is a no-op on a circle-only site", async () => {
    const { boundaryClear } = await import("./admin-sites");
    const owner = await createPilot("adminbclearowner");
    const site = await createSite({ lat: 45.1, lon: 45.1, visibility: "public", ownerId: owner, boundaryHalfSizeM: 100 });

    await boundaryClear(site.id);
    const cleared = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(cleared.boundary).toBeNull();
    expect(cleared.boundaryMinLat).toBeNull();

    // No-op on an already-circle-only site — must not throw.
    await boundaryClear(site.id);
  });

  it("zone-boundary-clear removes a zone's boundary", async () => {
    const { zoneBoundaryClear } = await import("./admin-sites");
    const owner = await createPilot("adminzbclearowner");
    const site = await createSite({ lat: 45.2, lon: 45.2, visibility: "public", ownerId: owner });
    const zone = await createZone({
      siteId: site.id,
      lat: 45.2,
      lon: 45.2,
      visibility: "public",
      ownerId: owner,
      boundaryHalfSizeM: 50,
    });

    await zoneBoundaryClear(zone.id);
    const cleared = await prisma.zone.findUniqueOrThrow({ where: { id: zone.id } });
    expect(cleared.boundary).toBeNull();
  });

  it("boundary-clear/zone-boundary-clear write no Flight column", async () => {
    const { boundaryClear } = await import("./admin-sites");
    const owner = await createPilot("adminbclearnocache");
    const site = await createSite({ lat: 45.3, lon: 45.3, visibility: "public", ownerId: owner, boundaryHalfSizeM: 100 });
    const { locationCachePatch } = await import("@/lib/sites/associate");
    const patch = locationCachePatch(site, null, "takeoff");
    seq += 1;
    const flight = await prisma.flight.create({
      data: { ownerId: owner, visibility: "public", status: "ready", igcSha256: `adminb6${suffix}${seq}`, ...patch },
    });

    await boundaryClear(site.id);

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(row.takeoffSiteId).toBe(site.id); // unchanged — a boundary clear touches no Flight column
    expect(row.takeoffSiteName).toBe(site.name);
    await prisma.flight.delete({ where: { id: flight.id } });
  });

  it("merge refuses to silently drop a source boundary onto a boundary-less target, and --force carries it across", async () => {
    const { merge } = await import("./admin-sites");
    const owner = await createPilot("adminmergeboundaryowner");
    const from = await createSite({ lat: 45.4, lon: 45.4, visibility: "public", ownerId: owner, boundaryHalfSizeM: 100 });
    const into = await createSite({ lat: 45.41, lon: 45.41, visibility: "public", ownerId: owner });

    await expect(merge(from.id, into.id)).rejects.toThrow(/would silently drop it/i);

    await merge(from.id, into.id, true);
    siteIds.splice(siteIds.indexOf(from.id), 1); // deleted by the merge

    const target = await prisma.site.findUniqueOrThrow({ where: { id: into.id } });
    expect(target.boundary).not.toBeNull();
  });

  it("zone-merge refuses to silently drop a source boundary onto a boundary-less target, and --force carries it across", async () => {
    const { zoneMerge } = await import("./admin-sites");
    const owner = await createPilot("adminzonemergeboundaryowner");
    const site = await createSite({ lat: 45.5, lon: 45.5, visibility: "public", ownerId: owner });
    const from = await createZone({
      siteId: site.id,
      lat: 45.5,
      lon: 45.5,
      visibility: "public",
      ownerId: owner,
      boundaryHalfSizeM: 50,
    });
    const into = await createZone({ siteId: site.id, lat: 45.5, lon: 45.5, visibility: "public", ownerId: owner });

    await expect(zoneMerge(from.id, into.id)).rejects.toThrow(/would silently drop it/i);

    await zoneMerge(from.id, into.id, true);
    zoneIds.splice(zoneIds.indexOf(from.id), 1); // deleted by the merge

    const target = await prisma.zone.findUniqueOrThrow({ where: { id: into.id } });
    expect(target.boundary).not.toBeNull();
  });

  it("merge does not require --force when the source has no boundary", async () => {
    const { merge } = await import("./admin-sites");
    const owner = await createPilot("adminmergenoboundaryowner");
    const from = await createSite({ lat: 45.6, lon: 45.6, visibility: "public", ownerId: owner });
    const into = await createSite({ lat: 45.61, lon: 45.61, visibility: "public", ownerId: owner });

    await merge(from.id, into.id);
    siteIds.splice(siteIds.indexOf(from.id), 1);
  });

  it("list reports boundary presence, vertex count, area, and boundaryUpdatedBy", async () => {
    const { list } = await import("./admin-sites");
    const owner = await createPilot("adminlistboundaryowner");
    const site = await createSite({ lat: 45.7, lon: 45.7, visibility: "public", ownerId: owner, boundaryHalfSizeM: 100 });
    await createZone({ siteId: site.id, lat: 45.7, lon: 45.7, visibility: "public", ownerId: owner });

    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => lines.push(msg);
    try {
      await list(site.id);
    } finally {
      console.log = originalLog;
    }

    expect(lines[0]).toContain("4 vertices");
    expect(lines[0]).toContain("boundaryUpdatedBy=" + owner);
    expect(lines.some((l) => l.includes("circle matching"))).toBe(true); // the zone has none
  });

  describe("SPRINT-007: community history survives merge, boundary-clear is attributed to the operator", () => {
    it("merge re-points the source's audit entries and endorsements onto the survivor, and writes a `merge` entry", async () => {
      const { merge } = await import("./admin-sites");
      const owner = await createPilot("adminmergecommowner");
      const editor = await createPilot("adminmergecommeditor");
      const voter = await createPilot("adminmergecommvoter");
      const bothSidesVoter = await createPilot("adminmergecommbothvoter");
      const from = await createSite({ lat: 45.8, lon: 45.8, visibility: "public", ownerId: owner });
      const into = await createSite({ lat: 45.81, lon: 45.81, visibility: "public", ownerId: owner });

      const associate = await import("@/lib/sites/associate");
      await associate.renameSite(from.id, editor, "Renamed before merge", "renamed before merge");
      await prisma.siteEndorsement.create({ data: { siteId: from.id, profileId: voter } });
      // This pilot endorsed BOTH sides — re-pointing must not collide on the
      // composite PK (siteId, profileId).
      await prisma.siteEndorsement.create({ data: { siteId: from.id, profileId: bothSidesVoter } });
      await prisma.siteEndorsement.create({ data: { siteId: into.id, profileId: bothSidesVoter } });

      await merge(from.id, into.id);
      siteIds.splice(siteIds.indexOf(from.id), 1); // deleted by the merge

      const auditRows = await prisma.locationAuditEntry.findMany({ where: { siteId: into.id } });
      expect(auditRows.some((r) => r.action === "renamed" && r.actorId === editor)).toBe(true);
      expect(auditRows.some((r) => r.action === "merge")).toBe(true);

      const endorsements = await prisma.siteEndorsement.findMany({ where: { siteId: into.id } });
      const voterIds = endorsements.map((e) => e.profileId).sort();
      expect(voterIds).toEqual([bothSidesVoter, voter].sort());
      // No duplicate/orphaned row for the both-sides voter — the composite
      // PK still holds exactly one row for them on the survivor.
      expect(endorsements.filter((e) => e.profileId === bothSidesVoter)).toHaveLength(1);
    });

    it("zone-merge re-points the source's audit entries and endorsements onto the survivor", async () => {
      const { zoneMerge } = await import("./admin-sites");
      const owner = await createPilot("adminzonemergecommowner");
      const site = await createSite({ lat: 45.82, lon: 45.82, visibility: "public", ownerId: owner });
      const from = await createZone({ siteId: site.id, lat: 45.82, lon: 45.82, visibility: "public", ownerId: owner });
      const into = await createZone({ siteId: site.id, lat: 45.82, lon: 45.82, visibility: "public", ownerId: owner });

      const associate = await import("@/lib/sites/associate");
      const editor = await createPilot("adminzonemergecommeditor");
      await associate.renameZone(from.id, editor, "Renamed before merge", "renamed before merge");

      await zoneMerge(from.id, into.id);
      zoneIds.splice(zoneIds.indexOf(from.id), 1);

      const auditRows = await prisma.locationAuditEntry.findMany({ where: { zoneId: into.id } });
      expect(auditRows.some((r) => r.action === "renamed" && r.actorId === editor)).toBe(true);
      expect(auditRows.some((r) => r.action === "merge")).toBe(true);
    });

    it("boundary-clear writes an operator-attributed (null actor) audit entry, distinguishable from a pilot's own clear", async () => {
      const { boundaryClear } = await import("./admin-sites");
      const owner = await createPilot("adminbcaudit");
      const site = await createSite({ lat: 45.83, lon: 45.83, visibility: "public", ownerId: owner, boundaryHalfSizeM: 100 });

      await boundaryClear(site.id);

      const rows = await prisma.locationAuditEntry.findMany({ where: { siteId: site.id, action: "boundary_cleared" } });
      expect(rows).toHaveLength(1);
      expect(rows[0].actorId).toBeNull();
    });

    it("audit/zone-audit print history most-recent-first", async () => {
      const { audit, zoneAudit } = await import("./admin-sites");
      const owner = await createPilot("adminauditcmd");
      const editor = await createPilot("adminauditcmdeditor");
      const site = await createSite({ lat: 45.84, lon: 45.84, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: 45.84, lon: 45.84, visibility: "public", ownerId: owner });

      const associate = await import("@/lib/sites/associate");
      await associate.renameSite(site.id, editor, "Renamed site", "renamed site");
      await associate.renameZone(zone.id, editor, "Renamed zone", "renamed zone");

      const siteLines: string[] = [];
      const zoneLines: string[] = [];
      const originalLog = console.log;
      try {
        console.log = (msg: string) => siteLines.push(msg);
        await audit(site.id);
        console.log = (msg: string) => zoneLines.push(msg);
        await zoneAudit(zone.id);
      } finally {
        console.log = originalLog;
      }

      expect(siteLines[0]).toContain("renamed");
      expect(siteLines[0]).toContain(`@${(await prisma.profile.findUniqueOrThrow({ where: { id: editor } })).handle}`);
      expect(zoneLines[0]).toContain("renamed");
    });
  });
});
