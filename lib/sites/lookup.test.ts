// @vitest-environment node
//
// Integration test for viewer-scoped, haversine site lookup. Requires a local
// Postgres and must not skip — a skipped sites matrix means the privacy work
// this sprint establishes is unverified.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });
import { findSite } from "./lookup";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for site lookup integration tests.");
}

const suffix = `${process.pid}${Math.floor(Math.random() * 1e5)}`;

describe("findSite (viewer-scoped haversine)", () => {
  let prisma: import("@/lib/prisma").Db;
  const ids: string[] = [];
  const siteIds: string[] = [];
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
    source?: "manual" | "user";
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
        source: opts.source ?? "user",
      },
    });
    siteIds.push(site.id);
    return site;
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
  });

  beforeEach(async () => {
    if (siteIds.length) {
      await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
      siteIds.length = 0;
    }
  });

  afterAll(async () => {
    if (!prisma) return;
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

    const match = await findSite(prisma, {
      lat: 20.0,
      lon: 20.0,
      kind: "takeoff",
      viewerId: null,
    });
    expect(match?.id).toBe(site.id);
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
      const match = await findSite(prisma, {
        lat: site.lat,
        lon: site.lon,
        kind: "takeoff",
        viewerId: null,
      });
      expect(match?.id).toBe(site.id);
    }
  });

  it("returns null when no site is within range", async () => {
    const site = await findSite(prisma, {
      lat: 0,
      lon: -140,
      kind: "takeoff",
      viewerId: null,
    });
    expect(site).toBeNull();
  });

  it("respects the tighter takeoff radius", async () => {
    await createSite({ lat: 24.0, lon: 24.0, kind: "takeoff", visibility: "public", ownerId: null });

    // ~3 km north — outside the 600 m takeoff radius.
    const site = await findSite(prisma, {
      lat: 24.027,
      lon: 24.0,
      kind: "takeoff",
      viewerId: null,
    });
    expect(site).toBeNull();
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

    const match = await findSite(prisma, {
      lat: 10.0,
      lon: 10.0,
      kind: "takeoff",
      viewerId: owner,
    });
    expect(match?.id).toBe(site.id);
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

    const match = await findSite(prisma, {
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

    const match = await findSite(prisma, {
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
      const match = await findSite(prisma, {
        lat: 13.0,
        lon: 13.0,
        kind: "takeoff",
        viewerId,
      });
      expect(match?.id).toBe(site.id);
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

    const anonMatch = await findSite(prisma, {
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

    const match = await findSite(prisma, {
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
});
