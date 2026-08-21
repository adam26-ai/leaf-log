// @vitest-environment node
//
// Integration test for viewer-scoped, haversine location lookup (site + zone,
// SPRINT-005). Requires a local Postgres and must not skip — a skipped
// matrix means the privacy work this and the prior sprint establish is
// unverified.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });
import { findLocation } from "./lookup";
import { validateBoundary, boundaryColumns } from "./boundary";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for site lookup integration tests.");
}

const suffix = `${process.pid}${Math.floor(Math.random() * 1e5)}`;

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

function requireOwnerForBoundary(ownerId: string | null): string {
  if (!ownerId) throw new Error("test fixture: a boundary-bearing row needs a real ownerId");
  return ownerId;
}

describe("findLocation (viewer-scoped haversine, zone-first with site fallback)", () => {
  let prisma: import("@/lib/prisma").Db;
  const ids: string[] = [];
  const siteIds: string[] = [];
  const zoneIds: string[] = [];
  let seq = 0;

  async function createPilot(label: string) {
    const handle = `${label}${ids.length}${suffix}`.slice(0, 20).toLowerCase();
    const user = await prisma.user.create({
      data: {
        email: `${handle}@test.local`,
        profile: { create: { handle, displayName: label } },
      },
    });
    ids.push(user.id);
    return user.id;
  }

  async function createSite(opts: {
    lat: number;
    lon: number;
    kind: "takeoff" | "landing" | "both";
    visibility: "private" | "public";
    ownerId: string | null;
    boundaryHalfSizeM?: number;
  }) {
    seq += 1;
    const name = `Test Site ${seq}${suffix}`;
    const boundaryCols = opts.boundaryHalfSizeM
      ? testBoundaryColumns(opts.lat, opts.lon, opts.boundaryHalfSizeM, requireOwnerForBoundary(opts.ownerId))
      : {};
    const site = await prisma.site.create({
      data: {
        name,
        normalizedName: name.toLowerCase(),
        ...boundaryCols,
        lat: opts.lat,
        lon: opts.lon,
        kind: opts.kind,
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
    kind: "takeoff" | "landing" | "both";
    visibility: "private" | "public";
    ownerId: string | null;
    boundaryHalfSizeM?: number;
  }) {
    seq += 1;
    const name = `Test Zone ${seq}${suffix}`;
    const boundaryCols = opts.boundaryHalfSizeM
      ? testBoundaryColumns(opts.lat, opts.lon, opts.boundaryHalfSizeM, requireOwnerForBoundary(opts.ownerId))
      : {};
    const zone = await prisma.zone.create({
      data: {
        siteId: opts.siteId,
        name,
        normalizedName: name.toLowerCase(),
        ...boundaryCols,
        lat: opts.lat,
        lon: opts.lon,
        kind: opts.kind,
        visibility: opts.visibility,
        ownerId: opts.ownerId,
      },
    });
    zoneIds.push(zone.id);
    return zone;
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
  });

  beforeEach(async () => {
    if (zoneIds.length) {
      await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
      zoneIds.length = 0;
    }
    if (siteIds.length) {
      await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
      siteIds.length = 0;
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("names a public site from its coordinates", async () => {
    const site = await createSite({
      lat: 20.0,
      lon: 20.0,
      kind: "takeoff",
      visibility: "public",
      ownerId: null,
    });

    const match = await findLocation(prisma, {
      lat: 20.0,
      lon: 20.0,
      kind: "takeoff",
      viewerId: null,
    });
    expect(match?.site.id).toBe(site.id);
    expect(match?.zone).toBeNull();
  });

  it("names each of several distinct public sites from their own coordinates", async () => {
    const created = await Promise.all(
      [
        [21.0, 21.0],
        [22.0, 22.0],
        [23.0, 23.0],
      ].map(([lat, lon]) =>
        createSite({ lat, lon, kind: "takeoff", visibility: "public", ownerId: null }),
      ),
    );

    for (const site of created) {
      const match = await findLocation(prisma, {
        lat: site.lat,
        lon: site.lon,
        kind: "takeoff",
        viewerId: null,
      });
      expect(match?.site.id).toBe(site.id);
    }
  });

  it("returns null when no site is within range", async () => {
    const match = await findLocation(prisma, {
      lat: 0,
      lon: -140,
      kind: "takeoff",
      viewerId: null,
    });
    expect(match).toBeNull();
  });

  it("respects the tighter takeoff radius", async () => {
    await createSite({ lat: 24.0, lon: 24.0, kind: "takeoff", visibility: "public", ownerId: null });

    // ~3 km north — outside the 600 m takeoff radius.
    const match = await findLocation(prisma, {
      lat: 24.027,
      lon: 24.0,
      kind: "takeoff",
      viewerId: null,
    });
    expect(match).toBeNull();
  });

  it("a private site matches its own owner", async () => {
    const owner = await createPilot("priv-owner");
    const site = await createSite({
      lat: 10.0,
      lon: 10.0,
      kind: "takeoff",
      visibility: "private",
      ownerId: owner,
    });

    const match = await findLocation(prisma, {
      lat: 10.0,
      lon: 10.0,
      kind: "takeoff",
      viewerId: owner,
    });
    expect(match?.site.id).toBe(site.id);
  });

  it("a private site never matches a stranger", async () => {
    const owner = await createPilot("priv-owner2");
    const stranger = await createPilot("priv-stranger");
    await createSite({
      lat: 11.0,
      lon: 11.0,
      kind: "takeoff",
      visibility: "private",
      ownerId: owner,
    });

    const match = await findLocation(prisma, {
      lat: 11.0,
      lon: 11.0,
      kind: "takeoff",
      viewerId: stranger,
    });
    expect(match).toBeNull();
  });

  it("a private site never matches an anonymous viewer", async () => {
    const owner = await createPilot("priv-owner3");
    await createSite({
      lat: 12.0,
      lon: 12.0,
      kind: "takeoff",
      visibility: "private",
      ownerId: owner,
    });

    const match = await findLocation(prisma, {
      lat: 12.0,
      lon: 12.0,
      kind: "takeoff",
      viewerId: null,
    });
    expect(match).toBeNull();
  });

  it("a public site matches everyone: owner, stranger, and anonymous", async () => {
    const owner = await createPilot("pub-owner");
    const stranger = await createPilot("pub-stranger");
    const site = await createSite({
      lat: 13.0,
      lon: 13.0,
      kind: "takeoff",
      visibility: "public",
      ownerId: owner,
    });

    for (const viewerId of [owner, stranger, null]) {
      const match = await findLocation(prisma, {
        lat: 13.0,
        lon: 13.0,
        kind: "takeoff",
        viewerId,
      });
      expect(match?.site.id).toBe(site.id);
    }
  });

  it("an anonymous viewer does not match an orphaned private site", async () => {
    // Simulates the post-SetNull state: ownerId is null but visibility stayed
    // private. Must be readable by nobody, per the fail-closed read predicate.
    await createSite({
      lat: 14.0,
      lon: 14.0,
      kind: "takeoff",
      visibility: "private",
      ownerId: null,
    });

    const anonMatch = await findLocation(prisma, {
      lat: 14.0,
      lon: 14.0,
      kind: "takeoff",
      viewerId: null,
    });
    expect(anonMatch).toBeNull();
  });

  it("a signed-in viewer does not match another orphaned private site either", async () => {
    const someone = await createPilot("orphan-viewer");
    await createSite({
      lat: 15.0,
      lon: 15.0,
      kind: "takeoff",
      visibility: "private",
      ownerId: null,
    });

    const match = await findLocation(prisma, {
      lat: 15.0,
      lon: 15.0,
      kind: "takeoff",
      viewerId: someone,
    });
    expect(match).toBeNull();
  });

  it("sites are fully community-driven: no curated (source='manual') seed exists", async () => {
    const count = await prisma.site.count({ where: { source: "manual" } });
    expect(count).toBe(0);
  });

  // ---------------------------------------------------------------------
  // SPRINT-005: zone matching
  // ---------------------------------------------------------------------

  it("a zone beats its parent site at the same spot", async () => {
    const site = await createSite({
      lat: -70,
      lon: -70,
      kind: "takeoff",
      visibility: "public",
      ownerId: null,
    });
    const zone = await createZone({
      siteId: site.id,
      lat: -70,
      lon: -70,
      kind: "takeoff",
      visibility: "public",
      ownerId: null,
    });

    const match = await findLocation(prisma, {
      lat: -70,
      lon: -70,
      kind: "takeoff",
      viewerId: null,
    });
    expect(match?.zone?.id).toBe(zone.id);
    expect(match?.site.id).toBe(site.id);
  });

  it("a site with a zone still matches a flight outside every zone radius but inside the site radius (no dead ends)", async () => {
    const site = await createSite({
      lat: -69,
      lon: -69,
      kind: "takeoff",
      visibility: "public",
      ownerId: null,
    });
    await createZone({
      siteId: site.id,
      // ~350 m north of the site — outside the 300 m zone-takeoff radius.
      lat: -69 + 350 / 111_320,
      lon: -69,
      kind: "takeoff",
      visibility: "public",
      ownerId: null,
    });

    const match = await findLocation(prisma, {
      lat: -69,
      lon: -69,
      kind: "takeoff",
      viewerId: null,
    });
    expect(match?.site.id).toBe(site.id);
    expect(match?.zone).toBeNull();
  });

  it("a private zone matches its own owner and no one else, including the site's owner", async () => {
    const siteOwner = await createPilot("zone-site-owner");
    const zoneOwner = await createPilot("zone-owner");
    const stranger = await createPilot("zone-stranger");
    const site = await createSite({
      lat: -68,
      lon: -68,
      kind: "takeoff",
      visibility: "public",
      ownerId: siteOwner,
    });
    const zone = await createZone({
      siteId: site.id,
      lat: -68,
      lon: -68,
      kind: "takeoff",
      visibility: "private",
      ownerId: zoneOwner,
    });

    const ownerMatch = await findLocation(prisma, {
      lat: -68,
      lon: -68,
      kind: "takeoff",
      viewerId: zoneOwner,
    });
    expect(ownerMatch?.zone?.id).toBe(zone.id);

    for (const viewerId of [siteOwner, stranger, null]) {
      const match = await findLocation(prisma, {
        lat: -68,
        lon: -68,
        kind: "takeoff",
        viewerId,
      });
      // The private zone never matches; the flight falls back to the
      // (public) parent site instead — still no dead end.
      expect(match?.zone).toBeNull();
      expect(match?.site.id).toBe(site.id);
    }
  });

  it("a public zone under a private site matches nobody but the site's owner", async () => {
    const siteOwner = await createPilot("private-site-owner");
    const stranger = await createPilot("private-site-stranger");
    const site = await createSite({
      lat: -67,
      lon: -67,
      kind: "takeoff",
      visibility: "private",
      ownerId: siteOwner,
    });
    // A row that should never be reachable through the create flow (PR3
    // refuses it at write time) — written directly here to prove the READ
    // side's conjunction neutralizes it independently, per SPRINT-005's
    // two-layer design.
    const zone = await createZone({
      siteId: site.id,
      lat: -67,
      lon: -67,
      kind: "takeoff",
      visibility: "public",
      ownerId: siteOwner,
    });

    const ownerMatch = await findLocation(prisma, {
      lat: -67,
      lon: -67,
      kind: "takeoff",
      viewerId: siteOwner,
    });
    expect(ownerMatch?.zone?.id).toBe(zone.id);

    for (const viewerId of [stranger, null]) {
      const match = await findLocation(prisma, {
        lat: -67,
        lon: -67,
        kind: "takeoff",
        viewerId,
      });
      expect(match).toBeNull();
    }
  });

  it("an anonymous caller matches no private zone, orphaned or not", async () => {
    const owner = await createPilot("zone-orphan-source");
    const site = await createSite({
      lat: -66,
      lon: -66,
      kind: "takeoff",
      visibility: "public",
      ownerId: null,
    });
    // Orphaned: ownerId null but visibility stayed private (the post-SetNull
    // state) — must be readable by nobody, including the site's own owner.
    await createZone({
      siteId: site.id,
      lat: -66,
      lon: -66,
      kind: "takeoff",
      visibility: "private",
      ownerId: null,
    });

    const anonMatch = await findLocation(prisma, {
      lat: -66,
      lon: -66,
      kind: "takeoff",
      viewerId: null,
    });
    expect(anonMatch?.zone).toBeNull();
    expect(anonMatch?.site.id).toBe(site.id);

    const ownerMatch = await findLocation(prisma, {
      lat: -66,
      lon: -66,
      kind: "takeoff",
      viewerId: owner,
    });
    expect(ownerMatch?.zone).toBeNull();
  });

  it("a zone under a different, farther site can beat a nearer bare site — accepted collision, tested", async () => {
    const nearSite = await createSite({
      lat: -65,
      lon: -65,
      kind: "takeoff",
      visibility: "public",
      ownerId: null,
    });
    const farSite = await createSite({
      // ~290 m east — within the far site's own 600 m site radius from ITS
      // own centre, but this test queries from nearSite's centre.
      lat: -65,
      lon: -65 + 290 / (111_320 * Math.cos((-65 * Math.PI) / 180)),
      kind: "takeoff",
      visibility: "public",
      ownerId: null,
    });
    const farZone = await createZone({
      siteId: farSite.id,
      lat: farSite.lat,
      lon: farSite.lon,
      kind: "takeoff",
      visibility: "public",
      ownerId: null,
    });

    // Query from a point 50 m from nearSite's own centre — well inside
    // nearSite's bare-site radius, but farZone (≈240 m away) is still
    // within the zone radius and wins because zones always beat sites.
    const match = await findLocation(prisma, {
      lat: -65 + 50 / 111_320,
      lon: -65,
      kind: "takeoff",
      viewerId: null,
    });
    expect(match?.zone?.id).toBe(farZone.id);
    expect(match?.site.id).toBe(farSite.id);
    expect(match?.site.id).not.toBe(nearSite.id);
  });

  // -------------------------------------------------------------------
  // SPRINT-006: boundary-aware matching. Coordinate band 80-89 is disjoint
  // from every other lat/lon range used across this file and the other
  // integration test files sharing the live Postgres test DB (see the
  // SPRINT-005 lesson about cross-file coordinate collisions under
  // Vitest's default file-level concurrency).
  // -------------------------------------------------------------------

  it("a point OUTSIDE the site's circle but INSIDE its drawn boundary matches", async () => {
    const owner = await createPilot("b6-outside-circle");
    // 600m takeoff circle; a 1500m-half-size boundary reaches well past it.
    const site = await createSite({
      lat: 80,
      lon: 80,
      kind: "takeoff",
      visibility: "public",
      ownerId: owner,
      boundaryHalfSizeM: 1500,
    });

    const match = await findLocation(prisma, {
      lat: 80,
      lon: 80 + 1000 / (111_320 * Math.cos((80 * Math.PI) / 180)),
      kind: "takeoff",
      viewerId: null,
    });
    expect(match?.site.id).toBe(site.id);
    expect(match?.zone).toBeNull();
  });

  it("a point INSIDE the site's circle but OUTSIDE a TIGHTER drawn boundary does NOT match", async () => {
    const owner = await createPilot("b6-tighter-boundary");
    await createSite({
      lat: 81,
      lon: 81,
      kind: "takeoff",
      visibility: "public",
      ownerId: owner,
      boundaryHalfSizeM: 50, // far tighter than the 600m circle
    });

    // 300m away — inside the 600m circle, outside the 50m-half boundary.
    const match = await findLocation(prisma, {
      lat: 81,
      lon: 81 + 300 / (111_320 * Math.cos((81 * Math.PI) / 180)),
      kind: "takeoff",
      viewerId: null,
    });
    expect(match).toBeNull();
  });

  it("a zone boundary reaching past its parent site's circle still yields the zone with its parent", async () => {
    const owner = await createPilot("b6-zone-past-parent");
    const site = await createSite({ lat: 82, lon: 82, kind: "landing", visibility: "public", ownerId: owner });
    const zone = await createZone({
      siteId: site.id,
      lat: 82,
      lon: 82,
      kind: "landing",
      visibility: "public",
      ownerId: owner,
      boundaryHalfSizeM: 1200, // past the 900m landing circle
    });

    const match = await findLocation(prisma, {
      lat: 82,
      lon: 82 + 1000 / (111_320 * Math.cos((82 * Math.PI) / 180)),
      kind: "landing",
      viewerId: null,
    });
    expect(match?.zone?.id).toBe(zone.id);
    expect(match?.site.id).toBe(site.id);
  });

  it("ranks a boundary-bearing site and a circle-only site by anchor distance alone — no membership tier", async () => {
    const owner = await createPilot("b6-ranking");
    // A big boundary-bearing site, further away by anchor...
    const farBoundarySite = await createSite({
      lat: 83,
      lon: 83,
      kind: "takeoff",
      visibility: "public",
      ownerId: owner,
      boundaryHalfSizeM: 2000,
    });
    // ...and a plain circle site, closer to the query point by anchor.
    const nearCircleSite = await createSite({
      lat: 83,
      lon: 83 + 100 / (111_320 * Math.cos((83 * Math.PI) / 180)),
      kind: "takeoff",
      visibility: "public",
      ownerId: owner,
    });

    // Query point is inside BOTH the boundary (2000m half-size) and the
    // circle site's own 600m radius — the nearer ANCHOR must win regardless
    // of which row matched by boundary vs. circle.
    const match = await findLocation(prisma, {
      lat: 83,
      lon: 83 + 150 / (111_320 * Math.cos((83 * Math.PI) / 180)),
      kind: "takeoff",
      viewerId: null,
    });
    expect(match?.site.id).toBe(nearCircleSite.id);
    expect(match?.site.id).not.toBe(farBoundarySite.id);
  });

  it("a PRIVATE boundary-bearing site never matches a stranger's ingest", async () => {
    const owner = await createPilot("b6-private-owner");
    const stranger = await createPilot("b6-private-stranger");
    await createSite({
      lat: 84,
      lon: 84,
      kind: "takeoff",
      visibility: "private",
      ownerId: owner,
      boundaryHalfSizeM: 500,
    });

    const strangerMatch = await findLocation(prisma, { lat: 84, lon: 84, kind: "takeoff", viewerId: stranger });
    expect(strangerMatch).toBeNull();

    const ownerMatch = await findLocation(prisma, { lat: 84, lon: 84, kind: "takeoff", viewerId: owner });
    expect(ownerMatch).not.toBeNull();
  });

  it("a malformed stored boundary is skipped at match time, never thrown, and the flight falls back to Unknown site", async () => {
    const owner = await createPilot("b6-malformed");
    const site = await createSite({ lat: 85, lon: 85, kind: "takeoff", visibility: "public", ownerId: owner });
    // Simulate corruption (a future validator bug, a hand-edit, a bad
    // restore) — write a boundary the validator would never produce,
    // bypassing validateBoundary entirely.
    await prisma.site.update({
      where: { id: site.id },
      data: {
        boundary: { garbage: true },
        boundaryMinLat: 84.999,
        boundaryMaxLat: 85.001,
        boundaryMinLon: 84.999,
        boundaryMaxLon: 85.001,
      },
    });

    // If this throws, the test itself fails — that IS the "never thrown
    // into ingest" assertion.
    const match = await findLocation(prisma, { lat: 85, lon: 85, kind: "takeoff", viewerId: null });
    expect(match).toBeNull(); // fails closed — never silently falls back to the (also-present) circle
  });

  it("SITE_BOUNDARY_MATCHING=off reproduces pre-sprint circle-only matching on boundary-bearing rows", async () => {
    const owner = await createPilot("b6-kill-switch");
    await createSite({
      lat: 86,
      lon: 86,
      kind: "takeoff",
      visibility: "public",
      ownerId: owner,
      boundaryHalfSizeM: 1500, // reaches well past the 600m circle
    });

    const farLon = 86 + 1000 / (111_320 * Math.cos((86 * Math.PI) / 180));

    const withBoundaryOn = await findLocation(prisma, { lat: 86, lon: farLon, kind: "takeoff", viewerId: null });
    expect(withBoundaryOn).not.toBeNull(); // boundary reaches this point

    process.env.SITE_BOUNDARY_MATCHING = "off";
    try {
      const withBoundaryOff = await findLocation(prisma, { lat: 86, lon: farLon, kind: "takeoff", viewerId: null });
      expect(withBoundaryOff).toBeNull(); // circle-only: this point is outside the 600m radius
    } finally {
      delete process.env.SITE_BOUNDARY_MATCHING;
    }
  });
});
