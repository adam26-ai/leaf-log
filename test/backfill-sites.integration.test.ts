// @vitest-environment node
//
// scripts/backfill-sites.ts's core sweep. Requires local Postgres and must
// not skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for backfill-sites integration tests.");
}

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("scripts/backfill-sites.ts — runBackfill", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let runBackfill: typeof import("@/scripts/backfill-sites").runBackfill;
  const ids: string[] = [];
  const siteIds: string[] = [];
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
    kind?: "takeoff" | "landing" | "both";
    visibility: "private" | "public";
    ownerId: string | null;
  }) {
    seq += 1;
    const name = `Backfill Site ${seq}${suffix}`;
    const site = await prisma.site.create({
      data: {
        name,
        normalizedName: name.toLowerCase(),
        lat: opts.lat,
        lon: opts.lon,
        kind: opts.kind ?? "takeoff",
        visibility: opts.visibility,
        ownerId: opts.ownerId,
        source: "user",
      },
    });
    siteIds.push(site.id);
    return site;
  }

  async function createFlight(opts: {
    ownerId: string;
    takeoffLat?: number | null;
    takeoffLon?: number | null;
    landingLat?: number | null;
    landingLon?: number | null;
  }) {
    seq += 1;
    const flight = await prisma.flight.create({
      data: {
        ownerId: opts.ownerId,
        visibility: "public",
        status: "ready",
        igcSha256: `backfillmx${suffix}${seq}`,
        flightDate: new Date("2026-06-01T00:00:00.000Z"),
        takeoffAt: new Date("2026-06-01T10:00:00.000Z"),
        takeoffLat: opts.takeoffLat ?? null,
        takeoffLon: opts.takeoffLon ?? null,
        landingLat: opts.landingLat ?? null,
        landingLon: opts.landingLon ?? null,
      },
    });
    flightIds.push(flight.id);
    return flight;
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    ({ runBackfill } = await import("@/scripts/backfill-sites"));
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.flight.deleteMany({ where: { id: { in: flightIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it("backfills a flight missing a takeoff site that matches a public site", async () => {
    const owner = await createPilot("bfpub");
    const site = await createSite({ lat: 60, lon: 60, visibility: "public", ownerId: owner });
    const flight = await createFlight({ ownerId: owner, takeoffLat: 60, takeoffLon: 60 });

    const updated = await runBackfill();
    expect(updated).toBeGreaterThanOrEqual(1);

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(row.takeoffSiteId).toBe(site.id);
    expect(row.takeoffSiteName).toBe(site.name);
  });

  it("backfills a landing site too, not just takeoff", async () => {
    const owner = await createPilot("bflanding");
    const site = await createSite({ lat: 61, lon: 61, kind: "landing", visibility: "public", ownerId: owner });
    const flight = await createFlight({ ownerId: owner, landingLat: 61, landingLon: 61 });

    await runBackfill();

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(row.landingSiteId).toBe(site.id);
    expect(row.landingSiteName).toBe(site.name);
  });

  it("is owner-scoped: does not match a private site owned by someone else", async () => {
    const siteOwner = await createPilot("bfsiteowner");
    const flightOwner = await createPilot("bfflightowner");
    await createSite({ lat: 62, lon: 62, visibility: "private", ownerId: siteOwner });
    const flight = await createFlight({ ownerId: flightOwner, takeoffLat: 62, takeoffLon: 62 });

    await runBackfill();

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(row.takeoffSiteId).toBeNull();
  });

  it("does match the owner's own private site", async () => {
    const owner = await createPilot("bfownprivate");
    const site = await createSite({ lat: 63, lon: 63, visibility: "private", ownerId: owner });
    const flight = await createFlight({ ownerId: owner, takeoffLat: 63, takeoffLon: 63 });

    await runBackfill();

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(row.takeoffSiteId).toBe(site.id);
    expect(row.takeoffSiteName).toBeNull(); // private: cache stays null
  });

  it("--public-only skips a match against the owner's own private site", async () => {
    const owner = await createPilot("bfpubonly");
    await createSite({ lat: 64, lon: 64, visibility: "private", ownerId: owner });
    const flight = await createFlight({ ownerId: owner, takeoffLat: 64, takeoffLon: 64 });

    await runBackfill({ publicOnly: true });

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(row.takeoffSiteId).toBeNull();
  });

  it("--site-id restricts the sweep to only flights matching that site", async () => {
    const owner = await createPilot("bfsiteidonly");
    const targetSite = await createSite({ lat: 65, lon: 65, visibility: "public", ownerId: owner });
    await createSite({ lat: 66, lon: 66, visibility: "public", ownerId: owner });
    const targetFlight = await createFlight({ ownerId: owner, takeoffLat: 65, takeoffLon: 65 });
    const otherFlight = await createFlight({ ownerId: owner, takeoffLat: 66, takeoffLon: 66 });

    await runBackfill({ siteId: targetSite.id });

    const targetRow = await prisma.flight.findUniqueOrThrow({ where: { id: targetFlight.id } });
    expect(targetRow.takeoffSiteId).toBe(targetSite.id);

    const otherRow = await prisma.flight.findUniqueOrThrow({ where: { id: otherFlight.id } });
    expect(otherRow.takeoffSiteId).toBeNull(); // not swept — didn't match --site-id
  });

  it("is idempotent: a second run doesn't re-touch an already-backfilled flight", async () => {
    const owner = await createPilot("bfidempotent");
    await createSite({ lat: 67, lon: 67, visibility: "public", ownerId: owner });
    const flight = await createFlight({ ownerId: owner, takeoffLat: 67, takeoffLon: 67 });

    const first = await runBackfill();
    expect(first).toBeGreaterThanOrEqual(1);

    const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(row.takeoffSiteId).not.toBeNull();

    // A flight with a site already set is excluded by the sweep's own WHERE
    // clause (only flights missing a site are candidates), so a second run
    // does not depend on this flight for its count.
    const second = await runBackfill({ siteId: row.takeoffSiteId! });
    expect(second).toBe(0);
  });
});
