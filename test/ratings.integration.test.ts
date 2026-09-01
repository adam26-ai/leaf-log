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
          // Also carries two launch-type tags, to prove a single flight can
          // contribute to more than one skillTagCounts bucket.
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
          launchTypes: ["RS", "CL"],
        },
        {
          // No flightDate, no site, no glider — must be counted as a flight
          // and airtime, but must not add a flying day, a site, or a glider.
          // Carries a Flight-type tag and the Restricted Landing Field flag.
          ownerId,
          visibility: "public",
          status: "ready",
          igcSha256: `bare_${suffix}`,
          durationS: 500,
          flightDate: null,
          takeoffAt: null,
          takeoffSiteId: null,
          glider: null,
          flightTypeTags: ["XC"],
          restrictedLandingField: true,
        },
        {
          // Not ready: must be excluded from every count, exactly like statsFrom.
          ownerId,
          visibility: "public",
          status: "uploaded",
          igcSha256: `not_ready_${suffix}`,
        },
        {
          // Tandem: must be excluded from solo airtime but still counted in
          // total airtime, flight count, and flying days.
          ownerId,
          visibility: "public",
          status: "ready",
          igcSha256: `tandem_${suffix}`,
          durationS: 2000,
          occupancy: "tandem",
          flightDate: new Date("2026-06-03T00:00:00.000Z"),
          takeoffAt: new Date("2026-06-03T09:00:00.000Z"),
        },
        {
          // Surface Tow (a launch-type tag, not an occupancy) — solo-equivalent,
          // same as null occupancy — must count toward solo airtime, not just
          // total airtime.
          ownerId,
          visibility: "public",
          status: "ready",
          igcSha256: `tow_${suffix}`,
          durationS: 700,
          launchTypes: ["ST"],
          flightDate: new Date("2026-06-03T00:00:00.000Z"),
          takeoffAt: new Date("2026-06-03T11:00:00.000Z"),
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

    expect(stats.flightCount).toBe(6); // the "uploaded" flight is excluded
    expect(stats.flyingDayCount).toBe(3); // 2026-06-01 (x2, deduped) + 2026-06-02 + 2026-06-03 (x2, deduped)
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

  it("excludes tandem flights from solo airtime but keeps them in total airtime", async () => {
    const rows = await repo.listOwnFlights(ownerId);
    const stats = ratingStatsFrom(rows);

    expect(stats.totalAirtimeSeconds).toBe(9500); // 3600 + 1800 + 900 + 500 + 2000 + 700
    expect(stats.soloAirtimeSeconds).toBe(7500); // total minus the 2000s tandem flight
    expect(stats.soloAirtimeIsExact).toBe(true);
  });

  it("tallies self-reported skill tags across flights, including a flight with two launch-type tags", async () => {
    const rows = await repo.listOwnFlights(ownerId);
    const stats = ratingStatsFrom(rows);

    expect(stats.skillTagCounts).toEqual({
      XC: 1,
      CL: 1,
      RS: 1,
      FSL: 0,
      TUR: 0,
      HA: 0,
      AWCL: 0,
      ST: 1,
      RLF: 1,
    });
  });

  it("returns the exact RatingStats object end to end", async () => {
    const rows = await repo.listOwnFlights(ownerId);
    expect(ratingStatsFrom(rows)).toEqual({
      flightCount: 6,
      flyingDayCount: 3,
      totalAirtimeSeconds: 9500,
      soloAirtimeSeconds: 7500,
      soloAirtimeIsExact: true,
      siteCount: 2,
      gliderCount: 2,
      skillTagCounts: {
        XC: 1,
        CL: 1,
        RS: 1,
        FSL: 0,
        TUR: 0,
        HA: 0,
        AWCL: 0,
        ST: 1,
        RLF: 1,
      },
    });
  });
});
