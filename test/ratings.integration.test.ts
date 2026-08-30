// @vitest-environment node
//
// lib/ratings/stats.ts is a sibling to statsFrom (lib/flights/repo.ts) and
// gets the same treatment: a DB-backed integration test, real Prisma client,
// real seeded flights, asserting an exact RatingStats object — this is
// privacy/aggregation-sensitive code operating on data that already passed a
// viewer-scoped read. Requires a local Postgres and must not skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("ratingStatsFrom (DB-backed)", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let repo: typeof import("@/lib/flights/repo");
  let ratingStatsFrom: typeof import("@/lib/ratings/stats").ratingStatsFrom;

  let ownerId = "";
  const siteIds: string[] = [];

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for ratings integration tests.");
    }

    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    repo = await import("@/lib/flights/repo");
    ({ ratingStatsFrom } = await import("@/lib/ratings/stats"));

    const owner = await prisma.user.create({
      data: {
        email: `ratingsowner_${suffix}@test.local`,
        profile: {
          create: { handle: `ratingsowner${suffix}`, displayName: "Ratings Owner" },
        },
      },
    });
    ownerId = owner.id;

    const site = await prisma.site.create({
      data: {
        name: `Ratings Site ${suffix}`,
        normalizedName: `ratings site ${suffix}`.toLowerCase(),
        kind: "takeoff",
        lat: 38.1,
        lon: -122.1,
        visibility: "public",
        ownerId: null,
        source: "user",
      },
    });
    siteIds.push(site.id);

    await prisma.flight.createMany({
      data: [
        {
          // Same flying day as the next flight, same real site, and a
          // glider name that only differs from it by case/whitespace.
          ownerId,
          visibility: "public",
          status: "ready",
          igcSha256: `same_day_a_${suffix}`,
          durationS: 3600,
          flightDate: new Date("2026-06-01T00:00:00.000Z"),
          takeoffAt: new Date("2026-06-01T10:00:00.000Z"),
          takeoffSiteId: site.id,
          glider: "Ozone Buzz Z2",
        },
        {
          ownerId,
          visibility: "public",
          status: "ready",
          igcSha256: `same_day_b_${suffix}`,
          durationS: 1800,
          flightDate: new Date("2026-06-01T00:00:00.000Z"),
          takeoffAt: new Date("2026-06-01T14:00:00.000Z"),
          takeoffSiteId: site.id,
          glider: " ozone buzz z2 ",
        },
        {
          // A deleted site: no takeoffSiteId, only the historical cached
          // name — the same fallback shape lib/sites/associate.ts's
          // deleteSite leaves behind (see test/sites.integration.test.ts
          // "deleting a site nulls the id ... but KEEPS the cached name").
          ownerId,
          visibility: "public",
          status: "ready",
          igcSha256: `deleted_site_${suffix}`,
          durationS: 900,
          flightDate: new Date("2026-06-02T00:00:00.000Z"),
          takeoffAt: new Date("2026-06-02T09:00:00.000Z"),
          takeoffSiteId: null,
          takeoffSiteName: `Deleted Site ${suffix}`,
          glider: "Advance Iota",
        },
        {
          // No flightDate, no site, no glider — must be counted as a flight
          // and airtime, but must not add a flying day, a site, or a glider.
          ownerId,
          visibility: "public",
          status: "ready",
          igcSha256: `bare_${suffix}`,
          durationS: 500,
          flightDate: null,
          takeoffAt: null,
          takeoffSiteId: null,
          glider: null,
        },
        {
          // Not ready: must be excluded from every count, exactly like statsFrom.
          ownerId,
          visibility: "public",
          status: "uploaded",
          igcSha256: `not_ready_${suffix}`,
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.flight.deleteMany({ where: { ownerId } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it("dedupes flying days by ISO flightDate, skipping nulls, and excludes non-ready flights", async () => {
    const rows = await repo.listOwnFlights(ownerId);
    const stats = ratingStatsFrom(rows);

    expect(stats.flightCount).toBe(4); // the "uploaded" flight is excluded
    expect(stats.flyingDayCount).toBe(2); // 2026-06-01 (x2, deduped) + 2026-06-02
  });

  it("dedupes glider names by trim + lowercase, skipping null/empty", async () => {
    const rows = await repo.listOwnFlights(ownerId);
    const stats = ratingStatsFrom(rows);

    expect(stats.gliderCount).toBe(2); // "Ozone Buzz Z2" / " ozone buzz z2 " collapse to one, plus "Advance Iota"
  });

  it("counts a deleted site via its cached-name fallback key, same as statsFrom's siteKey", async () => {
    const rows = await repo.listOwnFlights(ownerId);
    const stats = ratingStatsFrom(rows);

    expect(stats.siteCount).toBe(2); // the shared real site, plus the name-only fallback for the deleted one
  });

  it("aliases soloAirtimeSeconds to totalAirtimeSeconds and flags it inexact pre-PR2", async () => {
    const rows = await repo.listOwnFlights(ownerId);
    const stats = ratingStatsFrom(rows);

    expect(stats.totalAirtimeSeconds).toBe(6800); // 3600 + 1800 + 900 + 500
    expect(stats.soloAirtimeSeconds).toBe(stats.totalAirtimeSeconds);
    expect(stats.soloAirtimeIsExact).toBe(false);
  });

  it("returns the exact RatingStats object end to end", async () => {
    const rows = await repo.listOwnFlights(ownerId);
    expect(ratingStatsFrom(rows)).toEqual({
      flightCount: 4,
      flyingDayCount: 2,
      totalAirtimeSeconds: 6800,
      soloAirtimeSeconds: 6800,
      soloAirtimeIsExact: false,
      siteCount: 2,
      gliderCount: 2,
    });
  });
});
