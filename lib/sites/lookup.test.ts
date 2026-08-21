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

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for site lookup integration tests.");
}

const suffix = `${process.pid}${Math.floor(Math.random() * 1e5)}`;

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
  }) {
    seq += 1;
    const name = `Test Site ${seq}${suffix}`;
    const site = await prisma.site.create({
      data: {
        name,
        normalizedName: name.toLowerCase(),
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
  }) {
    seq += 1;
    const name = `Test Zone ${seq}${suffix}`;
    const zone = await prisma.zone.create({
      data: {
        siteId: opts.siteId,
        name,
        normalizedName: name.toLowerCase(),
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
});
