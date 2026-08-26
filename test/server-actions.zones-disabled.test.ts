// @vitest-environment node
//
// SPRINT-008 PR3: every zone-parallel server action rejects/null-returns
// when ZONES_ENABLED is off, and a rejected call writes nothing. Each
// action's gate check runs before its own auth check (verified by reading
// the source — see the comment on each `it` below), so none of these need
// a signed-in session to exercise; `@/lib/auth` is mocked purely so that
// importing these "use server" files doesn't pull in next-auth's own
// `next/server` import, which fails outside an actual Next.js runtime.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for server-action integration tests.");
}

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}s8a`;

describe("SPRINT-008 PR3: zone-parallel server actions reject when disabled", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let associate: typeof import("@/lib/sites/associate");
  let siteAction: typeof import("@/app/flights/[id]/site-action");
  let boundaryAction: typeof import("@/app/flights/[id]/boundary-action");
  let communityAction: typeof import("@/app/flights/[id]/community-action");
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
    const name = `S8 PR3 Site ${seq}${suffix}`;
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

  async function createZone(opts: { siteId: string; lat: number; lon: number; visibility: "private" | "public"; ownerId: string | null }) {
    seq += 1;
    const name = `S8 PR3 Zone ${seq}${suffix}`;
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
      },
    });
    zoneIds.push(zone.id);
    return zone;
  }

  async function createFlightWithZone(opts: {
    ownerId: string;
    site: { id: string; name: string; visibility: string };
    zone: { id: string; name: string; visibility: string; siteId: string };
  }) {
    seq += 1;
    const { locationCachePatch } = associate;
    const patch = locationCachePatch(opts.site, opts.zone, "takeoff");
    const flight = await prisma.flight.create({
      data: {
        ownerId: opts.ownerId,
        visibility: "public",
        status: "ready",
        igcSha256: `s8pr3${suffix}${seq}`,
        flightDate: new Date("2026-06-01T00:00:00.000Z"),
        takeoffAt: new Date("2026-06-01T10:00:00.000Z"),
        ...patch,
      },
    });
    flightIds.push(flight.id);
    return flight;
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    associate = await import("@/lib/sites/associate");
    siteAction = await import("@/app/flights/[id]/site-action");
    boundaryAction = await import("@/app/flights/[id]/boundary-action");
    communityAction = await import("@/app/flights/[id]/community-action");
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.flight.deleteMany({ where: { id: { in: flightIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  // nameSite's gate check is the very first line of the function, before
  // getCurrentUserId() — so this rejection needs no session at all.
  it("nameSite rejects a request carrying a zone choice, writing no Zone row", async () => {
    // Scoped to this fixture's own name rather than a global prisma.zone.count()
    // — this suite shares one Postgres with every other integration test
    // file, and vitest can run files concurrently, so a global count races
    // with unrelated zone creation elsewhere and flakes.
    const zoneName = `S8 PR3 Never Created Zone ${suffix}`;
    const result = await siteAction.nameSite({
      flightId: "nonexistent-flight-id",
      endpoint: "takeoff",
      site: { mode: "create", name: "S8 PR3 Never Created", visibility: "public" },
      zone: { mode: "create", name: zoneName, visibility: "public" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/zones are not available/i);
    expect(await prisma.zone.count({ where: { name: zoneName } })).toBe(0);
  });

  it("nameSite with no zone choice is unaffected by the gate — fails on auth instead, not on zones", async () => {
    const result = await siteAction.nameSite({
      flightId: "nonexistent-flight-id",
      endpoint: "takeoff",
      site: { mode: "create", name: "S8 PR3 Site Only", visibility: "public" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/zones are not available/i);
      expect(result.error).toMatch(/signed in/i);
    }
  });

  it("unpublishZoneForFlight and deleteZoneForFlight reject unconditionally, before touching the zone row", async () => {
    const owner = await createPilot("s8pr3undo");
    const site = await createSite({ lat: 46, lon: 46, visibility: "public", ownerId: owner });
    process.env.ZONES_ENABLED = "true";
    const zone = await createZone({ siteId: site.id, lat: 46, lon: 46, visibility: "public", ownerId: owner });
    const flight = await createFlightWithZone({ ownerId: owner, site, zone });
    delete process.env.ZONES_ENABLED;

    const unpublishResult = await siteAction.unpublishZoneForFlight(flight.id, "takeoff");
    expect(unpublishResult.ok).toBe(false);
    if (!unpublishResult.ok) expect(unpublishResult.error).toMatch(/zones are not available/i);

    const deleteResult = await siteAction.deleteZoneForFlight(flight.id, "takeoff");
    expect(deleteResult.ok).toBe(false);
    if (!deleteResult.ok) expect(deleteResult.error).toMatch(/zones are not available/i);

    const row = await prisma.zone.findUniqueOrThrow({ where: { id: zone.id } });
    expect(row.visibility).toBe("public"); // never unpublished
    expect(row.name).toBe(zone.name); // never deleted or altered
  });

  it("boundary-action.ts's zone-level functions all reject/null-return, and never write to the zone row", async () => {
    const owner = await createPilot("s8pr3boundary");
    const site = await createSite({ lat: 47, lon: 47, visibility: "public", ownerId: owner });
    process.env.ZONES_ENABLED = "true";
    const zone = await createZone({ siteId: site.id, lat: 47, lon: 47, visibility: "public", ownerId: owner });
    const flight = await createFlightWithZone({ ownerId: owner, site, zone });
    delete process.env.ZONES_ENABLED;

    const before = await prisma.zone.findUniqueOrThrow({ where: { id: zone.id } });

    const saveFlightResult = await boundaryAction.saveBoundaryForFlightEndpoint(flight.id, "takeoff", "zone", {
      type: "Polygon",
      coordinates: [],
    });
    expect(saveFlightResult.ok).toBe(false);
    if (!saveFlightResult.ok) expect(saveFlightResult.error).toMatch(/zones are not available/i);

    const clearFlightResult = await boundaryAction.clearBoundaryForFlightEndpoint(flight.id, "takeoff", "zone");
    expect(clearFlightResult.ok).toBe(false);
    if (!clearFlightResult.ok) expect(clearFlightResult.error).toMatch(/zones are not available/i);

    const saveOwnedResult = await boundaryAction.saveBoundaryForOwnedRow("zone", zone.id, {
      type: "Polygon",
      coordinates: [],
    });
    expect(saveOwnedResult.ok).toBe(false);
    if (!saveOwnedResult.ok) expect(saveOwnedResult.error).toMatch(/zones are not available/i);

    const clearOwnedResult = await boundaryAction.clearBoundaryForOwnedRow("zone", zone.id);
    expect(clearOwnedResult.ok).toBe(false);
    if (!clearOwnedResult.ok) expect(clearOwnedResult.error).toMatch(/zones are not available/i);

    expect(await boundaryAction.getBoundaryForOwnedRow("zone", zone.id)).toBeNull();
    expect(await boundaryAction.getBoundaryForPublicRow("zone", zone.id)).toBeNull();

    const after = await prisma.zone.findUniqueOrThrow({ where: { id: zone.id } });
    expect(after.boundary).toEqual(before.boundary);
    expect(after.boundaryMinLat).toEqual(before.boundaryMinLat);
  });

  it("community-action.ts's zone-level functions all reject/null-return, and never write an audit entry or endorsement", async () => {
    const owner = await createPilot("s8pr3community");
    const site = await createSite({ lat: 48, lon: 48, visibility: "public", ownerId: owner });
    process.env.ZONES_ENABLED = "true";
    const zone = await createZone({ siteId: site.id, lat: 48, lon: 48, visibility: "public", ownerId: owner });
    delete process.env.ZONES_ENABLED;

    const auditBefore = await prisma.locationAuditEntry.count({ where: { zoneId: zone.id } });
    const endorsementBefore = await prisma.zoneEndorsement.count({ where: { zoneId: zone.id } });
    const nameBefore = zone.name;

    expect(await communityAction.getCommunityInfoForRow("zone", zone.id)).toBeNull();

    const renameResult = await communityAction.renamePublicRow("zone", zone.id, "Should Never Apply");
    expect(renameResult.ok).toBe(false);
    if (!renameResult.ok) expect(renameResult.error).toMatch(/zones are not available/i);

    const endorseResult = await communityAction.toggleEndorsement("zone", zone.id);
    expect(endorseResult.ok).toBe(false);
    if (!endorseResult.ok) expect(endorseResult.error).toMatch(/zones are not available/i);

    const row = await prisma.zone.findUniqueOrThrow({ where: { id: zone.id } });
    expect(row.name).toBe(nameBefore);
    expect(await prisma.locationAuditEntry.count({ where: { zoneId: zone.id } })).toBe(auditBefore);
    expect(await prisma.zoneEndorsement.count({ where: { zoneId: zone.id } })).toBe(endorsementBefore);
  });

  // Anchoring decision 6 / PR3's fail-closed check: suppression at read
  // time must not accidentally reveal anything about a zone whose parent
  // site is private, or about a private zone itself — same posture as
  // every prior sprint, now re-verified through the gated action layer too.
  it("a public zone under a private parent site, and a private zone, both fail closed identically through getCommunityInfoForRow for an anonymous viewer — gate-on legacy", async () => {
    const owner = await createPilot("s8pr3failclosed");
    process.env.ZONES_ENABLED = "true";
    try {
      const privateSite = await createSite({ lat: 49, lon: 49, visibility: "private", ownerId: owner });
      const publicZoneUnderPrivateSite = await createZone({
        siteId: privateSite.id,
        lat: 49,
        lon: 49,
        visibility: "public",
        ownerId: owner,
      });
      const publicSite = await createSite({ lat: 49.5, lon: 49.5, visibility: "public", ownerId: owner });
      const privateZone = await createZone({
        siteId: publicSite.id,
        lat: 49.5,
        lon: 49.5,
        visibility: "private",
        ownerId: owner,
      });

      // The viewer is anonymous throughout this file (auth mocked to
      // null) — both rows must be invisible to that viewer regardless,
      // the same conjunction/private-visibility rules from SPRINT-005/007.
      expect(await communityAction.getCommunityInfoForRow("zone", publicZoneUnderPrivateSite.id)).toBeNull();
      expect(await communityAction.getCommunityInfoForRow("zone", privateZone.id)).toBeNull();
    } finally {
      delete process.env.ZONES_ENABLED;
    }
  });
});
