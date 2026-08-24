// @vitest-environment node
//
// SPRINT-004's heart: the site read-path firewall. Requires local Postgres
// and must not skip — a skipped sites matrix means this sprint's privacy
// work is unverified.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });
import { validateBoundary, boundaryColumns } from "@/lib/sites/boundary";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for site integration tests.");
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

function requireOwnerForBoundary(ownerId: string | null): string {
  if (!ownerId) throw new Error("test fixture: a boundary-bearing row needs a real ownerId");
  return ownerId;
}

describe("sites: read-path firewall", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let repo: typeof import("@/lib/flights/repo");
  let associate: typeof import("@/lib/sites/associate");
  let siteRepo: typeof import("@/lib/sites/repo");
  const ids: string[] = [];
  const siteIds: string[] = [];
  const zoneIds: string[] = [];
  const flightIds: string[] = [];
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
    kind?: "takeoff" | "landing" | "both";
    visibility: "private" | "public";
    ownerId: string | null;
    name?: string;
    /** SPRINT-006: a square boundary (metre half-size) around (lat, lon), for
     *  the boundary-bearing-row privacy re-run. */
    boundaryHalfSizeM?: number;
  }) {
    seq += 1;
    const name = opts.name ?? `Matrix Site ${seq}${suffix}`;
    const boundaryCols = opts.boundaryHalfSizeM
      ? testBoundaryColumns(opts.lat, opts.lon, opts.boundaryHalfSizeM, requireOwnerForBoundary(opts.ownerId))
      : {};
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
        ...boundaryCols,
      },
    });
    siteIds.push(site.id);
    return site;
  }

  async function createFlight(opts: {
    ownerId: string;
    visibility: "private" | "friends" | "public";
    status?: string;
    takeoffSiteId?: string | null;
    takeoffSiteName?: string | null;
    takeoffZoneId?: string | null;
    takeoffZoneName?: string | null;
    landingSiteId?: string | null;
    landingSiteName?: string | null;
    landingZoneId?: string | null;
    landingZoneName?: string | null;
    takeoffLat?: number | null;
    takeoffLon?: number | null;
    landingLat?: number | null;
    landingLon?: number | null;
    flightDate?: Date;
  }) {
    seq += 1;
    const flight = await prisma.flight.create({
      data: {
        ownerId: opts.ownerId,
        visibility: opts.visibility,
        status: opts.status ?? "ready",
        igcSha256: `sitesmx${suffix}${seq}`,
        flightDate: opts.flightDate ?? new Date("2026-06-01T00:00:00.000Z"),
        takeoffAt: new Date("2026-06-01T10:00:00.000Z"),
        takeoffSiteId: opts.takeoffSiteId ?? null,
        takeoffSiteName: opts.takeoffSiteName ?? null,
        takeoffZoneId: opts.takeoffZoneId ?? null,
        takeoffZoneName: opts.takeoffZoneName ?? null,
        landingSiteId: opts.landingSiteId ?? null,
        landingSiteName: opts.landingSiteName ?? null,
        landingZoneId: opts.landingZoneId ?? null,
        landingZoneName: opts.landingZoneName ?? null,
        takeoffLat: opts.takeoffLat ?? null,
        takeoffLon: opts.takeoffLon ?? null,
        landingLat: opts.landingLat ?? null,
        landingLon: opts.landingLon ?? null,
      },
    });
    flightIds.push(flight.id);
    return flight;
  }

  async function befriend(a: string, b: string) {
    await prisma.friendship.create({
      data: { requesterId: a, addresseeId: b, status: "accepted" },
    });
  }

  /** A flight bound the way real app code would (via the sole cache writer). */
  async function createFlightWithSite(opts: {
    ownerId: string;
    visibility: "private" | "friends" | "public";
    site: { id: string; name: string; visibility: string };
    endpoint: "takeoff" | "landing";
  }) {
    const { locationCachePatch } = associate;
    const patch = locationCachePatch(opts.site, null, opts.endpoint);
    return createFlight({
      ownerId: opts.ownerId,
      visibility: opts.visibility,
      ...patch,
    });
  }

  async function createZone(opts: {
    siteId: string;
    lat: number;
    lon: number;
    kind?: "takeoff" | "landing" | "both";
    visibility: "private" | "public";
    ownerId: string | null;
    name?: string;
    boundaryHalfSizeM?: number;
  }) {
    seq += 1;
    const name = opts.name ?? `Matrix Zone ${seq}${suffix}`;
    const boundaryCols = opts.boundaryHalfSizeM
      ? testBoundaryColumns(opts.lat, opts.lon, opts.boundaryHalfSizeM, requireOwnerForBoundary(opts.ownerId))
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

  /** A flight bound to a site AND zone the way real app code would. */
  async function createFlightWithZone(opts: {
    ownerId: string;
    visibility: "private" | "friends" | "public";
    site: { id: string; name: string; visibility: string };
    zone: { id: string; name: string; visibility: string; siteId: string };
    endpoint: "takeoff" | "landing";
  }) {
    const { locationCachePatch } = associate;
    const patch = locationCachePatch(opts.site, opts.zone, opts.endpoint);
    return createFlight({
      ownerId: opts.ownerId,
      visibility: opts.visibility,
      ...patch,
    });
  }

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    repo = await import("@/lib/flights/repo");
    associate = await import("@/lib/sites/associate");
    siteRepo = await import("@/lib/sites/repo");
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.kudo.deleteMany({ where: { flightId: { in: flightIds } } });
    await prisma.friendship.deleteMany({
      where: { OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }] },
    });
    await prisma.flight.deleteMany({ where: { id: { in: flightIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------
  // Matrix: owner / friend / stranger / anonymous × private / public site
  // × flight private / friends / public × takeoff + landing
  // ---------------------------------------------------------------------
  describe("matrix — public flight, private site (the core shadowing case)", () => {
    it("the owner sees the private site's name and id on their own public flight", async () => {
      const owner = await createPilot("shadowown");
      const site = await createSite({ lat: 1, lon: 1, visibility: "private", ownerId: owner });
      const flight = await createFlightWithSite({
        ownerId: owner,
        visibility: "public",
        site,
        endpoint: "takeoff",
      });

      const seen = await repo.getFlightForViewer(flight.id, owner);
      expect(seen?.takeoffSiteId).toBe(site.id);
      expect(seen?.takeoffSiteName).toBe(site.name);
    });

    it("a friend, a stranger, and an anonymous viewer see 'Unknown site' on the same public flight", async () => {
      const owner = await createPilot("shadowowner2");
      const friendViewer = await createPilot("shadowfriend");
      const stranger = await createPilot("shadowstranger");
      await befriend(owner, friendViewer);

      const site = await createSite({ lat: 2, lon: 2, visibility: "private", ownerId: owner });
      const flight = await createFlightWithSite({
        ownerId: owner,
        visibility: "public",
        site,
        endpoint: "takeoff",
      });

      for (const viewerId of [friendViewer, stranger, null]) {
        const seen = await repo.getFlightForViewer(flight.id, viewerId);
        expect(seen).not.toBeNull(); // positive control: the FLIGHT is visible
        expect(seen?.takeoffSiteId).toBeNull();
        expect(seen?.takeoffSiteName).toBeNull();
      }
    });

    it("the same shadowing holds on the landing endpoint", async () => {
      const owner = await createPilot("shadowlanding");
      const stranger = await createPilot("shadowlandingstr");
      const site = await createSite({
        lat: 3,
        lon: 3,
        kind: "landing",
        visibility: "private",
        ownerId: owner,
      });
      const flight = await createFlightWithSite({
        ownerId: owner,
        visibility: "public",
        site,
        endpoint: "landing",
      });

      const ownerView = await repo.getFlightForViewer(flight.id, owner);
      expect(ownerView?.landingSiteName).toBe(site.name);

      const strangerView = await repo.getFlightForViewer(flight.id, stranger);
      expect(strangerView?.landingSiteId).toBeNull();
      expect(strangerView?.landingSiteName).toBeNull();
    });
  });

  describe("matrix — public site is visible to everyone", () => {
    it("owner, friend, stranger, and anonymous all see a public site's name", async () => {
      const owner = await createPilot("pubowner");
      const friendViewer = await createPilot("pubfriend");
      const stranger = await createPilot("pubstranger");
      await befriend(owner, friendViewer);

      const site = await createSite({ lat: 4, lon: 4, visibility: "public", ownerId: owner });
      const flight = await createFlightWithSite({
        ownerId: owner,
        visibility: "public",
        site,
        endpoint: "takeoff",
      });

      for (const viewerId of [owner, friendViewer, stranger, null]) {
        const seen = await repo.getFlightForViewer(flight.id, viewerId);
        expect(seen?.takeoffSiteId).toBe(site.id);
        expect(seen?.takeoffSiteName).toBe(site.name);
      }
    });
  });

  describe("matrix — the flight gate still applies (subresource follows the parent)", () => {
    it("a stranger denied the flight itself never even gets to a site-name question", async () => {
      const owner = await createPilot("gateowner");
      const stranger = await createPilot("gatestranger");
      const site = await createSite({ lat: 5, lon: 5, visibility: "public", ownerId: owner });
      const flight = await createFlightWithSite({
        ownerId: owner,
        visibility: "private",
        site,
        endpoint: "takeoff",
      });

      const seen = await repo.getFlightForViewer(flight.id, stranger);
      expect(seen).toBeNull();

      // Positive control: the owner still sees it.
      const ownerSeen = await repo.getFlightForViewer(flight.id, owner);
      expect(ownerSeen?.takeoffSiteName).toBe(site.name);
    });

    it("friends-only: a friend sees the site name, a non-friend is denied the flight entirely", async () => {
      const owner = await createPilot("friendsgate");
      const friendViewer = await createPilot("friendsgatefriend");
      const stranger = await createPilot("friendsgatestranger");
      await befriend(owner, friendViewer);

      const site = await createSite({ lat: 6, lon: 6, visibility: "public", ownerId: owner });
      const flight = await createFlightWithSite({
        ownerId: owner,
        visibility: "friends",
        site,
        endpoint: "takeoff",
      });

      const friendSeen = await repo.getFlightForViewer(flight.id, friendViewer);
      expect(friendSeen?.takeoffSiteName).toBe(site.name);

      const strangerSeen = await repo.getFlightForViewer(flight.id, stranger);
      expect(strangerSeen).toBeNull();
    });
  });

  describe("matrix — logbook, profile list, and feed agree with the single-flight gate", () => {
    it("a friend's profile view and feed never show a private site name a stranger-gate would also hide", async () => {
      const owner = await createPilot("crosssurface");
      const friendViewer = await createPilot("crosssurfacefriend");
      await befriend(owner, friendViewer);

      const site = await createSite({ lat: 7, lon: 7, visibility: "private", ownerId: owner });
      await createFlightWithSite({
        ownerId: owner,
        visibility: "public",
        site,
        endpoint: "takeoff",
      });

      // Owner's own logbook: full visibility.
      const ownLogbook = await repo.listOwnFlights(owner);
      const ownRow = ownLogbook.find((f) => f.takeoffSiteId === site.id || f.takeoffSiteName === site.name);
      expect(ownRow?.takeoffSiteName).toBe(site.name);

      // Friend viewing owner's profile: site name hidden even though the flight is visible.
      const profileRows = await repo.listProfileFlightsForViewer(owner, friendViewer);
      expect(profileRows.length).toBeGreaterThan(0);
      for (const row of profileRows) {
        expect(row.takeoffSiteId).not.toBe(site.id);
      }

      // Friend's feed: same guarantee.
      const feed = await repo.listFeedForViewer(friendViewer);
      const feedRow = feed.rows.find((r) => r.ownerId === owner);
      expect(feedRow).toBeTruthy();
      expect(feedRow?.takeoffSiteId).not.toBe(site.id);
      expect(feedRow?.takeoffSiteName).not.toBe(site.name);
    });
  });

  // ---------------------------------------------------------------------
  // Leak sweep
  // ---------------------------------------------------------------------
  describe("leak sweep", () => {
    it("no flight created through the real cache writer carries a cached name whose site is not public", async () => {
      const owner = await createPilot("sweepowner");
      const privSite = await createSite({ lat: 8, lon: 8, visibility: "private", ownerId: owner });
      const pubSite = await createSite({ lat: 9, lon: 9, visibility: "public", ownerId: owner });

      await createFlightWithSite({ ownerId: owner, visibility: "public", site: privSite, endpoint: "takeoff" });
      await createFlightWithSite({ ownerId: owner, visibility: "public", site: pubSite, endpoint: "landing" });

      const rows = await prisma.flight.findMany({
        where: { id: { in: flightIds } },
        select: { id: true, takeoffSiteId: true, takeoffSiteName: true, landingSiteId: true, landingSiteName: true },
      });
      const siteVisibilityById = new Map(
        (await prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, visibility: true } })).map(
          (s) => [s.id, s.visibility],
        ),
      );

      for (const row of rows) {
        if (row.takeoffSiteId && row.takeoffSiteName) {
          expect(siteVisibilityById.get(row.takeoffSiteId)).toBe("public");
        }
        if (row.landingSiteId && row.landingSiteName) {
          expect(siteVisibilityById.get(row.landingSiteId)).toBe("public");
        }
      }
    });
  });

  // ---------------------------------------------------------------------
  // Stale-row defence — the test that proves strict beats fast
  // ---------------------------------------------------------------------
  describe("stale-row defence", () => {
    it("the read path strips a hand-written cached name that points at a private site", async () => {
      const owner = await createPilot("staleowner");
      const stranger = await createPilot("stalestranger");
      const site = await createSite({ lat: 10, lon: 10, visibility: "private", ownerId: owner });

      // Hand-write a row that never went through siteCachePatch — a poisoned
      // cache column, exactly what a bug or a direct DB edit could produce.
      const flight = await createFlight({
        ownerId: owner,
        visibility: "public",
        takeoffSiteId: site.id,
        takeoffSiteName: site.name, // <- the poison: cached name for a private site
      });

      const strangerView = await repo.getFlightForViewer(flight.id, stranger);
      expect(strangerView?.takeoffSiteId).toBeNull();
      expect(strangerView?.takeoffSiteName).toBeNull();

      // Positive control: the owner still sees it (proves the flight/site setup is sane).
      const ownerView = await repo.getFlightForViewer(flight.id, owner);
      expect(ownerView?.takeoffSiteName).toBe(site.name);
    });
  });

  // ---------------------------------------------------------------------
  // Transitions: promote / demote / rename / delete
  // ---------------------------------------------------------------------
  describe("transitions", () => {
    it("promoting a private site to public populates the cache on every referencing flight", async () => {
      const owner = await createPilot("promote");
      const site = await createSite({ lat: 11, lon: 11, visibility: "private", ownerId: owner });
      const flight = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });

      let row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteName).toBeNull();

      await associate.setSiteVisibility(site.id, owner, "public");

      row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteName).toBe(site.name);
    });

    it("demoting a public site to private nulls the cache on every referencing flight", async () => {
      const owner = await createPilot("demote");
      const site = await createSite({ lat: 12, lon: 12, visibility: "public", ownerId: owner });
      const flight = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });

      let row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteName).toBe(site.name);

      await associate.setSiteVisibility(site.id, owner, "private");

      row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBe(site.id); // id stays bound
      expect(row.takeoffSiteName).toBeNull(); // name is stripped from the cache
    });

    it("renaming a public site updates the cache on every referencing flight", async () => {
      const owner = await createPilot("rename");
      const site = await createSite({ lat: 13, lon: 13, visibility: "public", ownerId: owner });
      const flight = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });

      const newName = `Renamed ${seq}${suffix}`;
      await associate.renameSite(site.id, owner, newName, newName.toLowerCase());

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteName).toBe(newName);
    });

    it("renaming a private site never populates the cache", async () => {
      const owner = await createPilot("renameprivate");
      const site = await createSite({ lat: 14, lon: 14, visibility: "private", ownerId: owner });
      const flight = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });

      const newName = `RenamedPriv ${seq}${suffix}`;
      await associate.renameSite(site.id, owner, newName, newName.toLowerCase());

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteName).toBeNull();
    });

    it("deleting a site nulls the id on referencing flights but KEEPS the cached name (historical fallback)", async () => {
      const owner = await createPilot("deletesite");
      const site = await createSite({ lat: 15, lon: 15, visibility: "public", ownerId: owner });
      const flight = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });
      const deletedName = site.name;

      await associate.deleteSite(site.id, owner);
      siteIds.splice(siteIds.indexOf(site.id), 1); // already gone; don't try to delete it again in afterAll

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBeNull();
      expect(row.takeoffSiteName).toBe(deletedName);

      // And the read path serves that historical name to anyone who can see the flight.
      const seen = await repo.getFlightForViewer(flight.id, null);
      expect(seen?.takeoffSiteId).toBeNull();
      expect(seen?.takeoffSiteName).toBe(deletedName);
    });

    it("flipping a flight's own visibility writes nothing to the site row", async () => {
      const owner = await createPilot("flipvis");
      const site = await createSite({ lat: 16, lon: 16, visibility: "public", ownerId: owner });
      const flight = await createFlightWithSite({ ownerId: owner, visibility: "private", site, endpoint: "takeoff" });

      const before = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });

      await prisma.flight.update({ where: { id: flight.id }, data: { visibility: "public" } });

      const after = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(after.name).toBe(before.name);
      expect(after.visibility).toBe(before.visibility);
    });
  });

  // ---------------------------------------------------------------------
  // Ingest race: a demotion between an earlier match and the create
  // transaction's re-check must never cache a now-forbidden name.
  // ---------------------------------------------------------------------
  describe("ingest race", () => {
    it("resolveLocationCache reflects a demotion that happened after an earlier match", async () => {
      const siteOwner = await createPilot("raceowner");
      const flightOwner = await createPilot("raceflightowner");
      const site = await createSite({ lat: 17, lon: 17, visibility: "public", ownerId: siteOwner });

      // T0: matches while public — this is what findLocation would have
      // returned before the transaction, i.e. the value ingestFlight would
      // carry into its transaction as `takeoffMatch`.
      const atMatchTime = await associate.resolveLocationCache(prisma, site.id, null, "takeoff", flightOwner);
      expect(atMatchTime.takeoffSiteId).toBe(site.id);
      expect(atMatchTime.takeoffSiteName).toBe(site.name);

      // T1: a concurrent demotion — the site becomes private, owned by
      // someone other than the flight's owner.
      await associate.setSiteVisibility(site.id, siteOwner, "private");

      // T2: the re-check inside the create transaction — must now resolve to
      // "no match at all", not a stale public name.
      const atWriteTime = await associate.resolveLocationCache(prisma, site.id, null, "takeoff", flightOwner);
      expect(atWriteTime.takeoffSiteId).toBeNull();
      expect(atWriteTime.takeoffSiteName).toBeNull();
    });

    it("resolveLocationCache still binds (without caching a name) when the flight's own owner demoted their own site", async () => {
      const owner = await createPilot("raceownsite");
      const site = await createSite({ lat: 18, lon: 18, visibility: "public", ownerId: owner });

      await associate.resolveLocationCache(prisma, site.id, null, "takeoff", owner);
      await associate.setSiteVisibility(site.id, owner, "private");

      const afterDemotion = await associate.resolveLocationCache(prisma, site.id, null, "takeoff", owner);
      // The owner can still legitimately bind to their own now-private site —
      // the id stays, but the cache correctly withholds the name.
      expect(afterDemotion.takeoffSiteId).toBe(site.id);
      expect(afterDemotion.takeoffSiteName).toBeNull();
    });

    it("resolveLocationCache resolves to no match when the site was deleted concurrently", async () => {
      const owner = await createPilot("racedeleted");
      const site = await createSite({ lat: 19, lon: 19, visibility: "public", ownerId: owner });
      await associate.deleteSite(site.id, owner);
      siteIds.splice(siteIds.indexOf(site.id), 1);

      const patch = await associate.resolveLocationCache(prisma, site.id, null, "takeoff", owner);
      expect(patch.takeoffSiteId).toBeNull();
      expect(patch.takeoffSiteName).toBeNull();
    });

    it("a zone demoted between match and create degrades to SITE-ONLY, not to nothing", async () => {
      const zoneOwner = await createPilot("racezoneowner");
      const flightOwner = await createPilot("racezoneflightowner");
      const site = await createSite({ lat: 17.5, lon: 17.5, visibility: "public", ownerId: zoneOwner });
      const zone = await createZone({ siteId: site.id, lat: 17.5, lon: 17.5, visibility: "public", ownerId: zoneOwner });

      // T0: matches while public, as seen by a DIFFERENT pilot's flight.
      const atMatchTime = await associate.resolveLocationCache(prisma, site.id, zone.id, "takeoff", flightOwner);
      expect(atMatchTime.takeoffZoneId).toBe(zone.id);
      expect(atMatchTime.takeoffZoneName).toBe(zone.name);

      // T1: the zone's owner demotes it — flightOwner has no claim to a
      // private zone owned by someone else.
      await associate.setZoneVisibility(zone.id, zoneOwner, "private");

      const atWriteTime = await associate.resolveLocationCache(prisma, site.id, zone.id, "takeoff", flightOwner);
      // Degrades to site-only — the site binding survives, the zone doesn't.
      expect(atWriteTime.takeoffSiteId).toBe(site.id);
      expect(atWriteTime.takeoffSiteName).toBe(site.name);
      expect(atWriteTime.takeoffZoneId).toBeNull();
      expect(atWriteTime.takeoffZoneName).toBeNull();
    });

    it("resolveLocationCache still binds a zone (without caching a name) when the flight's own owner demoted their own zone", async () => {
      const owner = await createPilot("racezoneownsite");
      const site = await createSite({ lat: 17.55, lon: 17.55, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: 17.55, lon: 17.55, visibility: "public", ownerId: owner });

      await associate.resolveLocationCache(prisma, site.id, zone.id, "takeoff", owner);
      await associate.setZoneVisibility(zone.id, owner, "private");

      const afterDemotion = await associate.resolveLocationCache(prisma, site.id, zone.id, "takeoff", owner);
      // The owner can still legitimately bind to their own now-private zone.
      expect(afterDemotion.takeoffZoneId).toBe(zone.id);
      expect(afterDemotion.takeoffZoneName).toBeNull();
    });

    it("a site demoted between match and create caches NEITHER the site nor its zone", async () => {
      const owner = await createPilot("racesitezonedemote");
      const site = await createSite({ lat: 17.6, lon: 17.6, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: 17.6, lon: 17.6, visibility: "public", ownerId: owner });

      await associate.setSiteVisibility(site.id, owner, "private");
      const owned = owner; // the owner's OWN site — they can still bind, just no name
      const asOwner = await associate.resolveLocationCache(prisma, site.id, zone.id, "takeoff", owned);
      expect(asOwner.takeoffSiteId).toBe(site.id); // still bound, owner's own private site
      expect(asOwner.takeoffSiteName).toBeNull();
      expect(asOwner.takeoffZoneId).toBe(zone.id); // zone id follows the owner's own claim
      expect(asOwner.takeoffZoneName).toBeNull();

      const stranger = await createPilot("racesitezonestranger");
      const asStranger = await associate.resolveLocationCache(prisma, site.id, zone.id, "takeoff", stranger);
      expect(asStranger.takeoffSiteId).toBeNull(); // not the stranger's to bind at all
      expect(asStranger.takeoffZoneId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Feed keyset cursor stability, unchanged by site resolution
  // ---------------------------------------------------------------------
  describe("feed cursor stability", () => {
    it("pagination is stable across a page boundary once site fields are resolved", async () => {
      const owner = await createPilot("cursorowner");
      const viewer = await createPilot("cursorviewer");
      await befriend(owner, viewer);

      const site = await createSite({ lat: 20, lon: 20, visibility: "private", ownerId: owner });
      const dates = ["2026-05-01", "2026-05-02", "2026-05-03"];
      for (const d of dates) {
        seq += 1;
        const f = await prisma.flight.create({
          data: {
            ownerId: owner,
            visibility: "public",
            status: "ready",
            igcSha256: `cursor${suffix}${seq}`,
            flightDate: new Date(`${d}T00:00:00.000Z`),
            takeoffAt: new Date(`${d}T10:00:00.000Z`),
            takeoffSiteId: site.id,
            takeoffSiteName: null,
          },
        });
        flightIds.push(f.id);
      }

      const page1 = await repo.listFeedForViewer(viewer, { limit: 2 });
      expect(page1.rows.length).toBe(2);
      expect(page1.nextCursor).toBeTruthy();
      for (const row of page1.rows) {
        expect(row.takeoffSiteId).toBeNull(); // private site, viewer isn't the owner
      }

      const page2 = await repo.listFeedForViewer(viewer, { limit: 2, cursor: page1.nextCursor });
      expect(page2.rows.length).toBeGreaterThan(0);
      const page1Ids = new Set(page1.rows.map((r) => r.id));
      for (const row of page2.rows) {
        expect(page1Ids.has(row.id)).toBe(false); // no overlap/duplication across the boundary
      }
    });
  });

  // ---------------------------------------------------------------------
  // Fail-closed discipline: every denial above is paired with a positive
  // control (asserted inline in each test) so an empty/null result can't
  // pass vacuously. This test adds one more explicit belt-and-suspenders
  // check on the visibility truth table itself.
  // ---------------------------------------------------------------------
  describe("fail-closed discipline", () => {
    it("an orphaned private site (no owner) is visible to nobody, including the site's former self", async () => {
      const former = await createPilot("orphanformer");
      const site = await createSite({ lat: 21, lon: 21, visibility: "private", ownerId: null });
      const flight = await createFlightWithSite({
        ownerId: former,
        visibility: "public",
        site,
        endpoint: "takeoff",
      });

      for (const viewerId of [former, null]) {
        const seen = await repo.getFlightForViewer(flight.id, viewerId);
        expect(seen?.takeoffSiteId).toBeNull();
        expect(seen?.takeoffSiteName).toBeNull();
      }

      // Positive control: the flight itself (unrelated to the site) is still visible.
      const seen = await repo.getFlightForViewer(flight.id, null);
      expect(seen).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // PR3: createOrAttachSiteFromFlight — create, dedup, re-associate
  // ---------------------------------------------------------------------
  describe("createOrAttachSiteFromFlight — create", () => {
    it("creates a public site and binds it to the flight", async () => {
      const owner = await createPilot("createpub");
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 30, takeoffLon: 30 });

      const { site, createdSite } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Create Pub Ridge", visibility: "public" },
      });
      siteIds.push(site.id);

      expect(createdSite).toBe(true);
      expect(site.visibility).toBe("public");

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBe(site.id);
      expect(row.takeoffSiteName).toBe("Create Pub Ridge");
    });

    it("creates a private site and binds it, with no cached name", async () => {
      const owner = await createPilot("createpriv");
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 31, takeoffLon: 31 });

      const { site } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Create Priv Ridge", visibility: "private" },
      });
      siteIds.push(site.id);

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBe(site.id);
      expect(row.takeoffSiteName).toBeNull();
    });

    it("rejects every invalid name the same way validateSiteName does", async () => {
      const owner = await createPilot("createbadname");
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 32, takeoffLon: 32 });

      for (const badName of ["A", "Unknown Site", "---", "Sonoma <script>"]) {
        await expect(
          siteRepo.createOrAttachSiteFromFlight({
            flightId: flight.id,
            ownerId: owner,
            endpoint: "takeoff",
            site: { mode: "create", name: badName, visibility: "public" },
          }),
        ).rejects.toThrow();
      }
    });

    it("a proximity-scoped duplicate name is refused with a steer to reuse", async () => {
      const owner = await createPilot("dupname");
      const flightA = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 33, takeoffLon: 33 });
      const { site } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightA.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Duplicate Ridge", visibility: "public" },
      });
      siteIds.push(site.id);

      const flightB = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 33.001, takeoffLon: 33.001 });
      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flightB.id,
          ownerId: owner,
          endpoint: "takeoff",
          site: { mode: "create", name: "duplicate ridge", visibility: "public" }, // same normalizedName, different case
        }),
      ).rejects.toThrow(/already exists nearby/);

      const countAtLocation = await prisma.site.count({ where: { normalizedName: "duplicate ridge" } });
      expect(countAtLocation).toBe(1);
    });

    it("concurrent creation by two different pilots at the same spot with the same name resolves to one site", async () => {
      const pilotA = await createPilot("concurrentA");
      const pilotB = await createPilot("concurrentB");
      const flightA = await createFlight({ ownerId: pilotA, visibility: "public", takeoffLat: 34, takeoffLon: 34 });
      const flightB = await createFlight({ ownerId: pilotB, visibility: "public", takeoffLat: 34.0005, takeoffLon: 34.0005 });

      const { site: siteA } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightA.id,
        ownerId: pilotA,
        endpoint: "takeoff",
        site: { mode: "create", name: "Shared Launch", visibility: "public" },
      });
      siteIds.push(siteA.id);

      // Pilot B's attempt at the same public name nearby is rejected, steering to reuse.
      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flightB.id,
          ownerId: pilotB,
          endpoint: "takeoff",
          site: { mode: "create", name: "Shared Launch", visibility: "public" },
        }),
      ).rejects.toThrow();

      // Pilot B reuses the existing site instead — resolves to exactly one site.
      const { site: siteB, createdSite: createdB } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightB.id,
        ownerId: pilotB,
        endpoint: "takeoff",
        site: { mode: "reuse", id: siteA.id },
      });
      expect(createdB).toBe(false);
      expect(siteB.id).toBe(siteA.id);

      const countAtLocation = await prisma.site.count({ where: { normalizedName: "shared launch" } });
      expect(countAtLocation).toBe(1);
    });

    it("the daily create cap refuses further creates for the same owner", async () => {
      const owner = await createPilot("dailycap");
      // Spread far enough apart (0.5 deg =~ 55 km) that none of these collide
      // with each other's proximity-scoped dedup check.
      for (let i = 0; i < siteRepo.DAILY_CREATE_CAP; i++) {
        const lat = 40 + i * 0.5;
        const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: lat, takeoffLon: 40 });
        const { site } = await siteRepo.createOrAttachSiteFromFlight({
          flightId: flight.id,
          ownerId: owner,
          endpoint: "takeoff",
          site: { mode: "create", name: `Cap Site ${i}`, visibility: "public" },
        });
        siteIds.push(site.id);
      }

      const overflowFlight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 60, takeoffLon: 40 });
      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: overflowFlight.id,
          ownerId: owner,
          endpoint: "takeoff",
          site: { mode: "create", name: "One Too Many", visibility: "public" },
        }),
      ).rejects.toThrow(/limit/i);
    });

    it("a non-owner cannot name a site on someone else's flight", async () => {
      const owner = await createPilot("nameowner");
      const stranger = await createPilot("namestranger");
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 35, takeoffLon: 35 });

      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flight.id,
          ownerId: stranger,
          endpoint: "takeoff",
          site: { mode: "create", name: "Hijacked Site", visibility: "public" },
        }),
      ).rejects.toThrow();

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBeNull();
    });

    it("a flight with no fix for that endpoint offers no affordance (the call itself is refused)", async () => {
      const owner = await createPilot("nofix");
      // No landingLat/Lon set.
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 36, takeoffLon: 36 });

      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flight.id,
          ownerId: owner,
          endpoint: "landing",
          site: { mode: "create", name: "No Fix LZ", visibility: "public" },
        }),
      ).rejects.toThrow(/landing coordinate/);
    });
  });

  describe("suggestNearbyLocations — the reuse-first dialog step", () => {
    it("surfaces a nearby visible site with distance and bearing", async () => {
      const owner = await createPilot("suggestowner");
      const site = await createSite({ lat: 37, lon: 37, visibility: "public", ownerId: owner });

      const suggestions = await siteRepo.suggestNearbyLocations(37.01, 37.01, owner);
      const match = suggestions.find((s) => s.id === site.id);
      expect(match).toBeTruthy();
      expect(match?.distanceM).toBeGreaterThan(0);
      expect(typeof match?.bearingDeg).toBe("number");
    });

    it("is kind-agnostic: a landing-kind site is still suggested for a takeoff naming flow", async () => {
      const owner = await createPilot("suggestkind");
      const site = await createSite({ lat: 38, lon: 38, kind: "landing", visibility: "public", ownerId: owner });

      const suggestions = await siteRepo.suggestNearbyLocations(38.001, 38.001, owner);
      expect(suggestions.some((s) => s.id === site.id)).toBe(true);
    });

    it("never surfaces a private site the viewer cannot see", async () => {
      const owner = await createPilot("suggestprivowner");
      const stranger = await createPilot("suggestprivstranger");
      const site = await createSite({ lat: 39, lon: 39, visibility: "private", ownerId: owner });

      const suggestions = await siteRepo.suggestNearbyLocations(39.001, 39.001, stranger);
      expect(suggestions.some((s) => s.id === site.id)).toBe(false);

      // Positive control: the owner does see it.
      const ownSuggestions = await siteRepo.suggestNearbyLocations(39.001, 39.001, owner);
      expect(ownSuggestions.some((s) => s.id === site.id)).toBe(true);
    });
  });

  describe("reuse — opposite-endpoint widening", () => {
    it("widens kind to 'both' when a takeoff-kind site is reused on a landing", async () => {
      const owner = await createPilot("widenowner");
      const flightA = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 41, takeoffLon: 41 });
      const { site } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightA.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Widen Site", visibility: "public" },
      });
      siteIds.push(site.id);
      expect(site.kind).toBe("takeoff");

      const flightB = await createFlight({ ownerId: owner, visibility: "public", landingLat: 41, landingLon: 41 });
      const { site: widened } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightB.id,
        ownerId: owner,
        endpoint: "landing",
        site: { mode: "reuse", id: site.id },
      });
      expect(widened.kind).toBe("both");
    });

    it("never narrows an already-'both' site back down", async () => {
      const owner = await createPilot("neverNarrow");
      const site = await createSite({ lat: 42, lon: 42, kind: "both", visibility: "public", ownerId: owner });
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 42, takeoffLon: 42 });

      const { site: result } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
      });
      expect(result.kind).toBe("both");
    });
  });

  describe("reassociateOwnFlights — retroactive fix", () => {
    it("re-associates the creator's own older unmatched flights but not another pilot's", async () => {
      const owner = await createPilot("retroowner");
      const other = await createPilot("retroother");

      // An older flight of the owner's, already ready, missing a takeoff site,
      // sitting right where the new site will be created.
      const olderOwn = await createFlight({
        ownerId: owner,
        visibility: "public",
        takeoffLat: 43,
        takeoffLon: 43,
        flightDate: new Date("2026-01-01T00:00:00.000Z"),
      });
      // Another pilot's flight at the exact same spot — must NOT be touched.
      const othersFlight = await createFlight({
        ownerId: other,
        visibility: "public",
        takeoffLat: 43,
        takeoffLon: 43,
      });

      const current = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 43, takeoffLon: 43 });
      const { site, reassociated } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: current.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Retro Site", visibility: "public" },
      });
      siteIds.push(site.id);

      expect(reassociated.updated).toBeGreaterThanOrEqual(1);

      const olderRow = await prisma.flight.findUniqueOrThrow({ where: { id: olderOwn.id } });
      expect(olderRow.takeoffSiteId).toBe(site.id);
      expect(olderRow.takeoffSiteName).toBe("Retro Site");

      const othersRow = await prisma.flight.findUniqueOrThrow({ where: { id: othersFlight.id } });
      expect(othersRow.takeoffSiteId).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // PR4: creator undo (unpublish / delete), guarded by "no other pilot
  // depends on this site."
  // ---------------------------------------------------------------------
  describe("creator undo — unpublish", () => {
    it("unpublishes a site with no other pilot's flight attached", async () => {
      const owner = await createPilot("undopub");
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 50, takeoffLon: 50 });
      const { site } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Undo Pub Site", visibility: "public" },
      });
      siteIds.push(site.id);

      const updated = await associate.unpublishOwnSite(site.id, owner);
      expect(updated.visibility).toBe("private");

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBe(site.id); // still bound
      expect(row.takeoffSiteName).toBeNull(); // cache stripped

      // The owner still sees the name via the live resolver, cache or not.
      const seen = await repo.getFlightForViewer(flight.id, owner);
      expect(seen?.takeoffSiteName).toBe("Undo Pub Site");
    });

    it("refuses to unpublish once another pilot's flight depends on it", async () => {
      const owner = await createPilot("undoblocked");
      const other = await createPilot("undoblockedother");
      const flightA = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 51, takeoffLon: 51 });
      const { site } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightA.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Undo Blocked Site", visibility: "public" },
      });
      siteIds.push(site.id);

      // Another pilot's flight now depends on it (via reuse).
      const flightB = await createFlight({ ownerId: other, visibility: "public", takeoffLat: 51.0005, takeoffLon: 51.0005 });
      await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightB.id,
        ownerId: other,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
      });

      await expect(associate.unpublishOwnSite(site.id, owner)).rejects.toThrow(/depends on this site/);

      const row = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
      expect(row.visibility).toBe("public"); // unchanged
    });

    it("a non-owner cannot unpublish someone else's site", async () => {
      const owner = await createPilot("undononowner");
      const stranger = await createPilot("undononownerstr");
      const site = await createSite({ lat: 52, lon: 52, visibility: "public", ownerId: owner });

      await expect(associate.unpublishOwnSite(site.id, stranger)).rejects.toThrow();
    });
  });

  describe("creator undo — delete", () => {
    it("deletes a site with no other pilot's flight attached", async () => {
      const owner = await createPilot("undodel");
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 53, takeoffLon: 53 });
      const { site } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Undo Delete Site", visibility: "public" },
      });

      await associate.deleteSite(site.id, owner);

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBeNull();
      expect(row.takeoffSiteName).toBe("Undo Delete Site"); // historical fallback

      const siteRow = await prisma.site.findUnique({ where: { id: site.id } });
      expect(siteRow).toBeNull();
    });

    it("refuses to delete once another pilot's flight depends on it", async () => {
      const owner = await createPilot("undodelblocked");
      const other = await createPilot("undodelblockedother");
      const flightA = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 54, takeoffLon: 54 });
      const { site } = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightA.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Undo Delete Blocked", visibility: "public" },
      });
      siteIds.push(site.id);

      const flightB = await createFlight({ ownerId: other, visibility: "public", takeoffLat: 54.0005, takeoffLon: 54.0005 });
      await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightB.id,
        ownerId: other,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
      });

      await expect(associate.deleteSite(site.id, owner)).rejects.toThrow(/depends on this site/);

      const stillThere = await prisma.site.findUnique({ where: { id: site.id } });
      expect(stillThere).not.toBeNull();
    });
  });

  // =======================================================================
  // SPRINT-005 PR2 — the two-level read-path firewall
  // =======================================================================

  // ---------------------------------------------------------------------
  // Matrix, second dimension: site visibility × zone visibility
  // ---------------------------------------------------------------------
  describe("zone matrix — (public site, public zone)", () => {
    it("owner, friend, stranger, and anonymous all see the zone name", async () => {
      const owner = await createPilot("zmx-pubpub-owner");
      const friendViewer = await createPilot("zmx-pubpub-friend");
      const stranger = await createPilot("zmx-pubpub-stranger");
      await befriend(owner, friendViewer);

      const site = await createSite({ lat: -140, lon: -140, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -140, lon: -140, visibility: "public", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      for (const viewerId of [owner, friendViewer, stranger, null]) {
        const seen = await repo.getFlightForViewer(flight.id, viewerId);
        expect(seen?.takeoffSiteId).toBe(site.id);
        expect(seen?.takeoffZoneId).toBe(zone.id);
        expect(seen?.takeoffZoneName).toBe(zone.name);
      }
    });
  });

  describe("zone matrix — (public site, private zone)", () => {
    it("only the zone's own owner sees the zone; everyone else falls back to the site name", async () => {
      const siteOwner = await createPilot("zmx-pubpriv-siteowner");
      const zoneOwner = await createPilot("zmx-pubpriv-zoneowner");
      const stranger = await createPilot("zmx-pubpriv-stranger");
      const site = await createSite({ lat: -139, lon: -139, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({ siteId: site.id, lat: -139, lon: -139, visibility: "private", ownerId: zoneOwner });
      const flight = await createFlightWithZone({ ownerId: zoneOwner, visibility: "public", site, zone, endpoint: "takeoff" });

      const zoneOwnerView = await repo.getFlightForViewer(flight.id, zoneOwner);
      expect(zoneOwnerView?.takeoffZoneId).toBe(zone.id);
      expect(zoneOwnerView?.takeoffZoneName).toBe(zone.name);

      for (const viewerId of [siteOwner, stranger, null]) {
        const seen = await repo.getFlightForViewer(flight.id, viewerId);
        expect(seen).not.toBeNull(); // positive control: the public FLIGHT is visible
        expect(seen?.takeoffSiteId).toBe(site.id); // the site itself is still public
        expect(seen?.takeoffSiteName).toBe(site.name);
        expect(seen?.takeoffZoneId).toBeNull(); // but the private zone never leaks
        expect(seen?.takeoffZoneName).toBeNull();
      }
    });
  });

  describe("zone matrix — (private site, private zone, same owner)", () => {
    it("only the shared owner sees both; everyone else sees Unknown site entirely", async () => {
      const owner = await createPilot("zmx-privpriv-owner");
      const stranger = await createPilot("zmx-privpriv-stranger");
      const site = await createSite({ lat: -138, lon: -138, visibility: "private", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -138, lon: -138, visibility: "private", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      const ownerView = await repo.getFlightForViewer(flight.id, owner);
      expect(ownerView?.takeoffSiteId).toBe(site.id);
      expect(ownerView?.takeoffZoneId).toBe(zone.id);

      for (const viewerId of [stranger, null]) {
        const seen = await repo.getFlightForViewer(flight.id, viewerId);
        expect(seen).not.toBeNull(); // positive control
        expect(seen?.takeoffSiteId).toBeNull();
        expect(seen?.takeoffSiteName).toBeNull();
        expect(seen?.takeoffZoneId).toBeNull();
        expect(seen?.takeoffZoneName).toBeNull();
      }
    });
  });

  describe("zone matrix — (private site, public zone — the incoherent row)", () => {
    it("is neutralized at read time: visible only to the SITE's owner, never to the zone's own owner if different", async () => {
      const siteOwner = await createPilot("zmx-privpub-siteowner");
      const zoneOwner = await createPilot("zmx-privpub-zoneowner");
      const stranger = await createPilot("zmx-privpub-stranger");
      const site = await createSite({ lat: -137, lon: -137, visibility: "private", ownerId: siteOwner });
      // This row should never be reachable through PR3's create flow (refused
      // at write time); written directly here to prove the READ side closes
      // it independently, per SPRINT-005's two-layer design.
      const zone = await createZone({ siteId: site.id, lat: -137, lon: -137, visibility: "public", ownerId: zoneOwner });
      const flight = await createFlightWithZone({ ownerId: siteOwner, visibility: "public", site, zone, endpoint: "takeoff" });

      const siteOwnerView = await repo.getFlightForViewer(flight.id, siteOwner);
      expect(siteOwnerView?.takeoffSiteId).toBe(site.id);
      expect(siteOwnerView?.takeoffZoneId).toBe(zone.id);

      for (const viewerId of [zoneOwner, stranger, null]) {
        const seen = await repo.getFlightForViewer(flight.id, viewerId);
        expect(seen).not.toBeNull();
        expect(seen?.takeoffSiteId).toBeNull();
        expect(seen?.takeoffZoneId).toBeNull();
      }
    });
  });

  describe("zone matrix — logbook, profile list, feed, and listOwnFlightsByIds all agree", () => {
    it("a private zone under a public site never appears on any surface but its owner's", async () => {
      const siteOwner = await createPilot("zmx-surfaces-siteowner");
      const zoneOwner = await createPilot("zmx-surfaces-zoneowner");
      const friendViewer = await createPilot("zmx-surfaces-friend");
      await befriend(zoneOwner, friendViewer);

      const site = await createSite({ lat: -136, lon: -136, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({ siteId: site.id, lat: -136, lon: -136, visibility: "private", ownerId: zoneOwner });
      const flight = await createFlightWithZone({ ownerId: zoneOwner, visibility: "public", site, zone, endpoint: "takeoff" });

      // Owner's own logbook: full visibility, via listOwnFlights.
      const ownLogbook = await repo.listOwnFlights(zoneOwner);
      const ownRow = ownLogbook.find((f) => f.id === flight.id);
      expect(ownRow?.takeoffZoneName).toBe(zone.name);

      // listOwnFlightsByIds: same owner-scoped resolver, same guarantee.
      const byIds = await repo.listOwnFlightsByIds(zoneOwner, [flight.id]);
      expect(byIds[0]?.takeoffZoneId).toBe(zone.id);
      expect(byIds[0]?.takeoffZoneName).toBe(zone.name);

      // Friend viewing the zone owner's profile: zone hidden, site survives.
      const profileRows = await repo.listProfileFlightsForViewer(zoneOwner, friendViewer);
      const profileRow = profileRows.find((f) => f.id === flight.id);
      expect(profileRow?.takeoffSiteId).toBe(site.id);
      expect(profileRow?.takeoffZoneId).toBeNull();

      // Friend's feed: same guarantee.
      const feed = await repo.listFeedForViewer(friendViewer);
      const feedRow = feed.rows.find((r) => r.id === flight.id);
      expect(feedRow).toBeTruthy();
      expect(feedRow?.takeoffZoneId).toBeNull();
      expect(feedRow?.takeoffZoneName).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Leak sweep, extended to zones
  // ---------------------------------------------------------------------
  describe("leak sweep — zones", () => {
    it("no flight created through the real cache writer carries a cached zone name whose zone (or parent site) is not public", async () => {
      const owner = await createPilot("sweepzoneowner");
      const pubSite = await createSite({ lat: -135, lon: -135, visibility: "public", ownerId: owner });
      const privSite = await createSite({ lat: -134, lon: -134, visibility: "private", ownerId: owner });
      const pubZoneUnderPubSite = await createZone({ siteId: pubSite.id, lat: -135, lon: -135, visibility: "public", ownerId: owner });
      const privZoneUnderPubSite = await createZone({ siteId: pubSite.id, lat: -134.999, lon: -134.999, visibility: "private", ownerId: owner });
      // The incoherent row: a public zone under a private site. Written
      // directly via locationCachePatch (not the create flow, which refuses
      // it) — the sweep must still prove no leak reaches the cache.
      const pubZoneUnderPrivSite = await createZone({ siteId: privSite.id, lat: -134, lon: -134, visibility: "public", ownerId: owner });

      await createFlightWithZone({ ownerId: owner, visibility: "public", site: pubSite, zone: pubZoneUnderPubSite, endpoint: "takeoff" });
      await createFlightWithZone({ ownerId: owner, visibility: "public", site: pubSite, zone: privZoneUnderPubSite, endpoint: "landing" });
      await createFlightWithZone({ ownerId: owner, visibility: "public", site: privSite, zone: pubZoneUnderPrivSite, endpoint: "takeoff" });

      const rows = await prisma.flight.findMany({
        where: { id: { in: flightIds } },
        select: {
          id: true,
          takeoffZoneId: true,
          takeoffZoneName: true,
          landingZoneId: true,
          landingZoneName: true,
        },
      });
      const zoneRows = await prisma.zone.findMany({
        where: { id: { in: zoneIds } },
        select: { id: true, visibility: true, siteId: true },
      });
      const siteRows = await prisma.site.findMany({
        where: { id: { in: siteIds } },
        select: { id: true, visibility: true },
      });
      const zoneById = new Map(zoneRows.map((z) => [z.id, z]));
      const siteVisibilityById = new Map(siteRows.map((s) => [s.id, s.visibility]));

      for (const row of rows) {
        for (const [zoneId, zoneName] of [
          [row.takeoffZoneId, row.takeoffZoneName],
          [row.landingZoneId, row.landingZoneName],
        ] as const) {
          if (!zoneId || !zoneName) continue;
          const zone = zoneById.get(zoneId);
          expect(zone).toBeTruthy();
          expect(zone?.visibility).toBe("public");
          expect(siteVisibilityById.get(zone!.siteId)).toBe("public");
        }
      }
    });
  });

  // ---------------------------------------------------------------------
  // Stale-row defence — zones
  // ---------------------------------------------------------------------
  describe("stale-row defence — zones", () => {
    it("strips a hand-written cached zone name pointing at a private zone", async () => {
      const owner = await createPilot("stalezoneowner");
      const stranger = await createPilot("stalezonestranger");
      const site = await createSite({ lat: -133, lon: -133, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -133, lon: -133, visibility: "private", ownerId: owner });

      // Hand-write a row that never went through locationCachePatch — a
      // poisoned cache column, exactly what a bug or a direct DB edit could
      // produce.
      const flight = await createFlight({
        ownerId: owner,
        visibility: "public",
        takeoffSiteId: site.id,
        takeoffSiteName: site.name,
        takeoffZoneId: zone.id,
        takeoffZoneName: zone.name, // <- the poison: cached name for a private zone
      });

      const strangerView = await repo.getFlightForViewer(flight.id, stranger);
      expect(strangerView?.takeoffSiteId).toBe(site.id); // the public site survives
      expect(strangerView?.takeoffZoneId).toBeNull(); // the private zone does not
      expect(strangerView?.takeoffZoneName).toBeNull();

      // Positive control: the owner still sees it.
      const ownerView = await repo.getFlightForViewer(flight.id, owner);
      expect(ownerView?.takeoffZoneName).toBe(zone.name);
    });

    it("strips a hand-written zone id whose siteId disagrees with the row's takeoffSiteId (mismatch, not a leak)", async () => {
      const owner = await createPilot("mismatchowner");
      const siteA = await createSite({ lat: -132, lon: -132, visibility: "public", ownerId: owner });
      const siteB = await createSite({ lat: -131, lon: -131, visibility: "public", ownerId: owner });
      // A zone that REALLY belongs to siteB...
      const zoneUnderB = await createZone({ siteId: siteB.id, lat: -131, lon: -131, visibility: "public", ownerId: owner });

      // ...hand-written onto a flight whose takeoffSiteId is siteA instead.
      const flight = await createFlight({
        ownerId: owner,
        visibility: "public",
        takeoffSiteId: siteA.id,
        takeoffSiteName: siteA.name,
        takeoffZoneId: zoneUnderB.id,
        takeoffZoneName: zoneUnderB.name,
      });

      const seen = await repo.getFlightForViewer(flight.id, owner);
      expect(seen?.takeoffSiteId).toBe(siteA.id); // the site itself still resolves
      expect(seen?.takeoffZoneId).toBeNull(); // the mismatched zone is stripped
      expect(seen?.takeoffZoneName).toBeNull();
    });

    it("a zone id with a NULL site id renders 'Unknown site', not a dangling zone name (the absent CHECK's job)", async () => {
      const owner = await createPilot("danglingzoneowner");
      const site = await createSite({ lat: -130, lon: -130, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -130, lon: -130, visibility: "public", ownerId: owner });

      // The invariant zoneId ⇒ siteId is enforced by the single writer, not a
      // DB CHECK — hand-write the row a CHECK would have blocked.
      const flight = await createFlight({
        ownerId: owner,
        visibility: "public",
        takeoffSiteId: null,
        takeoffSiteName: null,
        takeoffZoneId: zone.id,
        takeoffZoneName: zone.name,
      });

      const seen = await repo.getFlightForViewer(flight.id, owner);
      expect(seen?.takeoffSiteId).toBeNull();
      expect(seen?.takeoffSiteName).toBeNull();
      expect(seen?.takeoffZoneId).toBeNull();
      expect(seen?.takeoffZoneName).toBeNull(); // never rendered bare
    });
  });

  // ---------------------------------------------------------------------
  // Conjunction: a public zone under a demoted site
  // ---------------------------------------------------------------------
  describe("conjunction — demote/re-promote", () => {
    it("a public zone under a demoted site is invisible to everyone but the owner, in matching AND display, with no write to the zone's own visibility", async () => {
      const owner = await createPilot("conjowner");
      const stranger = await createPilot("conjstranger");
      const site = await createSite({ lat: -129, lon: -129, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -129, lon: -129, visibility: "public", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      await associate.setSiteVisibility(site.id, owner, "private");

      // The zone's OWN visibility column is untouched by the demote.
      const zoneRow = await prisma.zone.findUniqueOrThrow({ where: { id: zone.id } });
      expect(zoneRow.visibility).toBe("public");

      // Matching: findLocation for a stranger no longer finds it. Uses the
      // app's extended client (lib/prisma), not this file's raw
      // PrismaClient — findLocation's Db type requires it structurally.
      const { findLocation } = await import("@/lib/sites/lookup");
      const { prisma: appPrisma } = await import("@/lib/prisma");
      const strangerMatch = await findLocation(appPrisma, { lat: -129, lon: -129, kind: "takeoff", viewerId: stranger });
      expect(strangerMatch).toBeNull();
      const ownerMatch = await findLocation(appPrisma, { lat: -129, lon: -129, kind: "takeoff", viewerId: owner });
      expect(ownerMatch?.zone?.id).toBe(zone.id);

      // Display: the cache was nulled by the demote transaction.
      const rowAfterDemote = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(rowAfterDemote.takeoffZoneName).toBeNull();

      // Re-promotion restores it automatically — no write to the zone needed.
      await associate.setSiteVisibility(site.id, owner, "public");
      const rowAfterPromote = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(rowAfterPromote.takeoffZoneName).toBe(zone.name);

      const strangerView = await repo.getFlightForViewer(flight.id, stranger);
      expect(strangerView?.takeoffZoneName).toBe(zone.name);
    });

    it("re-promoting a site restores ONLY its still-public zones' names, not a zone that was demoted independently", async () => {
      const owner = await createPilot("conjselective");
      const site = await createSite({ lat: -128, lon: -128, visibility: "public", ownerId: owner });
      const stillPublicZone = await createZone({ siteId: site.id, lat: -128, lon: -128, visibility: "public", ownerId: owner });
      const nowPrivateZone = await createZone({ siteId: site.id, lat: -127.999, lon: -127.999, visibility: "public", ownerId: owner });
      const flightA = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone: stillPublicZone, endpoint: "takeoff" });
      const flightB = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone: nowPrivateZone, endpoint: "takeoff" });

      // Independently demote ONE of the two zones before the site demote/promote cycle.
      await associate.setZoneVisibility(nowPrivateZone.id, owner, "private");
      await associate.setSiteVisibility(site.id, owner, "private");
      await associate.setSiteVisibility(site.id, owner, "public");

      const rowA = await prisma.flight.findUniqueOrThrow({ where: { id: flightA.id } });
      const rowB = await prisma.flight.findUniqueOrThrow({ where: { id: flightB.id } });
      expect(rowA.takeoffZoneName).toBe(stillPublicZone.name); // restored
      expect(rowB.takeoffZoneName).toBeNull(); // stays hidden — it's private on its own merits now
    });
  });

  // ---------------------------------------------------------------------
  // Transitions: zone promote / demote / rename / delete
  // ---------------------------------------------------------------------
  describe("zone transitions", () => {
    it("promoting a private zone to public populates the cache when the parent site is public", async () => {
      const owner = await createPilot("zonepromote");
      const site = await createSite({ lat: -127, lon: -127, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -127, lon: -127, visibility: "private", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      let row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffZoneName).toBeNull();

      await associate.setZoneVisibility(zone.id, owner, "public");

      row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffZoneName).toBe(zone.name);
    });

    it("promoting a zone whose PARENT site is private does not populate the cache (the write-time conjunction)", async () => {
      const owner = await createPilot("zonepromoteprivsite");
      const site = await createSite({ lat: -126, lon: -126, visibility: "private", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -126, lon: -126, visibility: "private", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      await associate.setZoneVisibility(zone.id, owner, "public");

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffZoneName).toBeNull(); // parent still private — conjunction withholds it
    });

    it("demoting a public zone nulls the cache on every referencing flight", async () => {
      const owner = await createPilot("zonedemote");
      const site = await createSite({ lat: -125, lon: -125, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -125, lon: -125, visibility: "public", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      await associate.setZoneVisibility(zone.id, owner, "private");

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffZoneId).toBe(zone.id); // id stays bound
      expect(row.takeoffZoneName).toBeNull(); // name stripped
    });

    it("renaming a public zone updates the cache on every referencing flight", async () => {
      const owner = await createPilot("zonerename");
      const site = await createSite({ lat: -124, lon: -124, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -124, lon: -124, visibility: "public", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      const newName = `Renamed Zone ${seq}${suffix}`;
      await associate.renameZone(zone.id, owner, newName, newName.toLowerCase());

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffZoneName).toBe(newName);
    });

    it("renaming a private zone never populates the cache", async () => {
      const owner = await createPilot("zonerenameprivate");
      const site = await createSite({ lat: -123, lon: -123, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -123, lon: -123, visibility: "private", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      const newName = `RenamedPriv Zone ${seq}${suffix}`;
      await associate.renameZone(zone.id, owner, newName, newName.toLowerCase());

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffZoneName).toBeNull();
    });

    it("a non-owner cannot promote someone else's zone; renaming a PRIVATE zone also stays owner-only", async () => {
      const owner = await createPilot("zonenonowner");
      const stranger = await createPilot("zonenonownerstr");
      const site = await createSite({ lat: -122, lon: -122, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -122, lon: -122, visibility: "public", ownerId: owner });
      // SPRINT-007: renaming a PUBLIC zone is now open to any onboarded
      // pilot (community edit v1) — that case is covered separately below.
      // A PRIVATE zone is the one where a stranger must still be refused.
      const privateZone = await createZone({ siteId: site.id, lat: -122, lon: -122, visibility: "private", ownerId: owner });

      await expect(associate.renameZone(privateZone.id, stranger, "Hijack", "hijack")).rejects.toThrow();
      await expect(associate.setZoneVisibility(zone.id, stranger, "private")).rejects.toThrow();
    });

    it("SPRINT-007: an onboarded stranger MAY rename a PUBLIC zone — community edit v1", async () => {
      const owner = await createPilot("zonecommrename-owner");
      const stranger = await createPilot("zonecommrename-stranger");
      const site = await createSite({ lat: -122.02, lon: -122.02, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -122.02, lon: -122.02, visibility: "public", ownerId: owner });

      const renamed = await associate.renameZone(zone.id, stranger, "Renamed by stranger", "renamed by stranger");
      expect(renamed.name).toBe("Renamed by stranger");
    });
  });

  // ---------------------------------------------------------------------
  // Deletes: zone delete vs. site delete
  // ---------------------------------------------------------------------
  describe("deletes", () => {
    it("deleting a zone keeps the flight's SITE binding but drops the zone name entirely (no history)", async () => {
      const owner = await createPilot("deletezone");
      const site = await createSite({ lat: -121, lon: -121, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -121, lon: -121, visibility: "public", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });
      const deletedZoneName = zone.name;

      await associate.deleteZone(zone.id, owner);
      zoneIds.splice(zoneIds.indexOf(zone.id), 1);

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBe(site.id); // site binding survives
      expect(row.takeoffSiteName).toBe(site.name);
      expect(row.takeoffZoneId).toBeNull();
      expect(row.takeoffZoneName).toBeNull(); // NOT kept as history, unlike a deleted site

      const seen = await repo.getFlightForViewer(flight.id, null);
      expect(seen?.takeoffSiteName).toBe(site.name);
      expect(seen?.takeoffZoneName).not.toBe(deletedZoneName);
    });

    it("deleting a site cascades its zones, keeps the site name as history, and drops the zone names", async () => {
      const owner = await createPilot("deletesitewithzone");
      const site = await createSite({ lat: -120, lon: -120, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -120, lon: -120, visibility: "public", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });
      const deletedSiteName = site.name;

      await associate.deleteSite(site.id, owner);
      siteIds.splice(siteIds.indexOf(site.id), 1);
      zoneIds.splice(zoneIds.indexOf(zone.id), 1); // cascade-deleted with the site

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBeNull();
      expect(row.takeoffSiteName).toBe(deletedSiteName); // site name kept as history
      expect(row.takeoffZoneId).toBeNull();
      expect(row.takeoffZoneName).toBeNull(); // zone name is NOT kept as history

      const zoneRow = await prisma.zone.findUnique({ where: { id: zone.id } });
      expect(zoneRow).toBeNull(); // cascaded away
    });

    it("deleting a site refuses while another pilot owns a zone under it, even with no flight referencing either", async () => {
      const siteOwner = await createPilot("deletesiteotherzone");
      const otherZoneOwner = await createPilot("deletesiteotherzoneowner");
      const site = await createSite({ lat: -119, lon: -119, visibility: "public", ownerId: siteOwner });
      // No flight references this zone at all — the guard must still fire,
      // because it protects the CONTRIBUTION, not just current references.
      await createZone({ siteId: site.id, lat: -119, lon: -119, visibility: "public", ownerId: otherZoneOwner });

      await expect(associate.deleteSite(site.id, siteOwner)).rejects.toThrow(/depends on this site/);

      const stillThere = await prisma.site.findUnique({ where: { id: site.id } });
      expect(stillThere).not.toBeNull();
    });

    it("unpublishing a site refuses while another pilot owns a zone under it", async () => {
      const siteOwner = await createPilot("unpubsiteotherzone");
      const otherZoneOwner = await createPilot("unpubsiteotherzoneowner");
      const site = await createSite({ lat: -118, lon: -118, visibility: "public", ownerId: siteOwner });
      await createZone({ siteId: site.id, lat: -118, lon: -118, visibility: "public", ownerId: otherZoneOwner });

      await expect(associate.unpublishOwnSite(site.id, siteOwner)).rejects.toThrow(/depends on this site/);

      const stillPublic = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
      expect(stillPublic.visibility).toBe("public");
    });

    it("deleting a site succeeds once the other-owned zone is gone (the operator-remedy escape hatch)", async () => {
      const siteOwner = await createPilot("delsiteafterzone1");
      const otherZoneOwner = await createPilot("delsiteafterzone2");
      const site = await createSite({ lat: -117, lon: -117, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({ siteId: site.id, lat: -117, lon: -117, visibility: "public", ownerId: otherZoneOwner });

      await expect(associate.deleteSite(site.id, siteOwner)).rejects.toThrow();

      // The other pilot's own zone-delete clears the block (or, in
      // production, an operator's zone-force-private/merge would).
      await associate.deleteZone(zone.id, otherZoneOwner);
      zoneIds.splice(zoneIds.indexOf(zone.id), 1);

      await associate.deleteSite(site.id, siteOwner);
      siteIds.splice(siteIds.indexOf(site.id), 1);

      const stillThere = await prisma.site.findUnique({ where: { id: site.id } });
      expect(stillThere).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Creator undo — zones
  // ---------------------------------------------------------------------
  describe("zone creator undo", () => {
    it("unpublishes a zone with no other pilot's flight attached", async () => {
      const owner = await createPilot("zoneundopub");
      const site = await createSite({ lat: -116, lon: -116, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -116, lon: -116, visibility: "public", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      const updated = await associate.unpublishOwnZone(zone.id, owner);
      expect(updated.visibility).toBe("private");

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffZoneId).toBe(zone.id); // still bound
      expect(row.takeoffZoneName).toBeNull(); // cache stripped

      const seen = await repo.getFlightForViewer(flight.id, owner);
      expect(seen?.takeoffZoneName).toBe(zone.name); // live resolver still shows the owner
    });

    it("refuses to unpublish or delete a zone once another pilot's flight depends on it", async () => {
      const owner = await createPilot("zoneundoblocked");
      const other = await createPilot("zoneundoblockedother");
      const site = await createSite({ lat: -115, lon: -115, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -115, lon: -115, visibility: "public", ownerId: owner });
      await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      // Another pilot's flight now depends on the zone directly.
      await createFlightWithZone({ ownerId: other, visibility: "public", site, zone, endpoint: "takeoff" });

      await expect(associate.unpublishOwnZone(zone.id, owner)).rejects.toThrow(/depends on this zone/);
      await expect(associate.deleteZone(zone.id, owner)).rejects.toThrow(/depends on this zone/);

      const row = await prisma.zone.findUniqueOrThrow({ where: { id: zone.id } });
      expect(row.visibility).toBe("public"); // unchanged
    });

    it("a non-owner cannot unpublish or delete someone else's zone", async () => {
      const owner = await createPilot("zoneundononowner");
      const stranger = await createPilot("zoneundononownerstr");
      const site = await createSite({ lat: -114, lon: -114, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -114, lon: -114, visibility: "public", ownerId: owner });

      await expect(associate.unpublishOwnZone(zone.id, stranger)).rejects.toThrow();
      await expect(associate.deleteZone(zone.id, stranger)).rejects.toThrow();
    });

    // -------------------------------------------------------------------
    // Decision 4: the PARENT SITE'S owner may also rename/unpublish/delete
    // a zone they didn't create.
    // -------------------------------------------------------------------
    it("the site's owner can rename a zone contributed by a different pilot", async () => {
      const siteOwner = await createPilot("siteownerrename");
      const zoneCreator = await createPilot("zonecreatorrename");
      const site = await createSite({ lat: -112.5, lon: -112.5, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({ siteId: site.id, lat: -112.5, lon: -112.5, visibility: "public", ownerId: zoneCreator });

      const newName = `Site Owner Renamed ${seq}${suffix}`;
      const updated = await associate.renameZone(zone.id, siteOwner, newName, newName.toLowerCase());
      expect(updated.name).toBe(newName);
      expect(updated.ownerId).toBe(zoneCreator); // ownership itself is untouched
    });

    it("the site's owner can unpublish a zone contributed by a different pilot", async () => {
      const siteOwner = await createPilot("siteownerunpub");
      const zoneCreator = await createPilot("zonecreatorunpub");
      const site = await createSite({ lat: -112.4, lon: -112.4, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({ siteId: site.id, lat: -112.4, lon: -112.4, visibility: "public", ownerId: zoneCreator });
      // Bound to the CALLER's (site owner's) own flight — the zone creator
      // themselves has no flight referencing it yet, so the guard passes.
      const flight = await createFlightWithZone({ ownerId: siteOwner, visibility: "public", site, zone, endpoint: "takeoff" });

      const updated = await associate.unpublishOwnZone(zone.id, siteOwner);
      expect(updated.visibility).toBe("private");

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffZoneName).toBeNull();
    });

    it("the site's owner can delete a zone contributed by a different pilot", async () => {
      const siteOwner = await createPilot("siteownerdel");
      const zoneCreator = await createPilot("zonecreatordel");
      const site = await createSite({ lat: -112.3, lon: -112.3, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({ siteId: site.id, lat: -112.3, lon: -112.3, visibility: "public", ownerId: zoneCreator });

      await associate.deleteZone(zone.id, siteOwner);
      zoneIds.splice(zoneIds.indexOf(zone.id), 1);

      const zoneRow = await prisma.zone.findUnique({ where: { id: zone.id } });
      expect(zoneRow).toBeNull();
    });

    it("the site owner's delete is STILL blocked while the zone creator's own flight depends on it", async () => {
      const siteOwner = await createPilot("siteownerblocked");
      const zoneCreator = await createPilot("zonecreatorblocked");
      const site = await createSite({ lat: -112.2, lon: -112.2, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({ siteId: site.id, lat: -112.2, lon: -112.2, visibility: "public", ownerId: zoneCreator });
      await createFlightWithZone({ ownerId: zoneCreator, visibility: "public", site, zone, endpoint: "takeoff" });

      // The site owner did not create this reference — it's the ZONE
      // creator's own flight — but "another pilot" is anyone but the
      // CALLER, so it still blocks the site owner's delete too.
      await expect(associate.deleteZone(zone.id, siteOwner)).rejects.toThrow(/depends on this zone/);
    });

    it("a stranger who owns neither the zone nor its parent site still cannot unpublish or delete it", async () => {
      const zoneCreator = await createPilot("neitherzonecreator");
      const siteOwner = await createPilot("neithersiteowner");
      const stranger = await createPilot("neitherstranger");
      const site = await createSite({ lat: -112.1, lon: -112.1, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({ siteId: site.id, lat: -112.1, lon: -112.1, visibility: "public", ownerId: zoneCreator });

      // SPRINT-007: renaming a PUBLIC zone is now open to any onboarded
      // pilot (community edit v1) — covered separately. Unpublish/delete
      // stay creator-or-site-owner-only, unaffected by this sprint.
      await expect(associate.unpublishOwnZone(zone.id, stranger)).rejects.toThrow();
      await expect(associate.deleteZone(zone.id, stranger)).rejects.toThrow();
    });

    // -------------------------------------------------------------------
    // Deleting the LAST zone under a site leaves a fully functional bare
    // site — decision 1's whole point, re-verified end to end here.
    // -------------------------------------------------------------------
    it("deleting the last zone under a site leaves a fully functional bare site", async () => {
      const owner = await createPilot("lastzoneowner");
      const site = await createSite({ lat: -111.5, lon: -111.5, visibility: "public", ownerId: owner });
      const onlyZone = await createZone({ siteId: site.id, lat: -111.5, lon: -111.5, visibility: "public", ownerId: owner });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone: onlyZone, endpoint: "takeoff" });

      await associate.deleteZone(onlyZone.id, owner);
      zoneIds.splice(zoneIds.indexOf(onlyZone.id), 1);

      // The flight falls back cleanly to the site.
      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBe(site.id);
      expect(row.takeoffSiteName).toBe(site.name);
      expect(row.takeoffZoneId).toBeNull();
      const seen = await repo.getFlightForViewer(flight.id, null);
      expect(seen?.takeoffSiteId).toBe(site.id);

      // The now-zoneless site still matches a brand-new flight at the same spot.
      const { findLocation } = await import("@/lib/sites/lookup");
      const { prisma: appPrisma } = await import("@/lib/prisma");
      const match = await findLocation(appPrisma, { lat: -111.5, lon: -111.5, kind: "takeoff", viewerId: null });
      expect(match?.site.id).toBe(site.id);
      expect(match?.zone).toBeNull();

      // The site itself can still be renamed/deleted/undone normally — it's
      // a fully first-class bare site, not a leftover husk.
      const newName = `Bare Now ${seq}${suffix}`;
      const renamed = await associate.renameSite(site.id, owner, newName, newName.toLowerCase());
      expect(renamed.name).toBe(newName);
    });
  });

  // ---------------------------------------------------------------------
  // Feed cursor stability, unchanged by two-level resolution
  // ---------------------------------------------------------------------
  describe("feed cursor stability — zones", () => {
    it("pagination is stable across a page boundary once zone fields are resolved too", async () => {
      const owner = await createPilot("zonecursorowner");
      const viewer = await createPilot("zonecursorviewer");
      await befriend(owner, viewer);

      const site = await createSite({ lat: -113, lon: -113, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -113, lon: -113, visibility: "private", ownerId: owner });
      const dates = ["2026-05-04", "2026-05-05", "2026-05-06"];
      for (const d of dates) {
        seq += 1;
        const f = await prisma.flight.create({
          data: {
            ownerId: owner,
            visibility: "public",
            status: "ready",
            igcSha256: `zonecursor${suffix}${seq}`,
            flightDate: new Date(`${d}T00:00:00.000Z`),
            takeoffAt: new Date(`${d}T10:00:00.000Z`),
            takeoffSiteId: site.id,
            takeoffSiteName: site.name,
            takeoffZoneId: zone.id,
            takeoffZoneName: null,
          },
        });
        flightIds.push(f.id);
      }

      const page1 = await repo.listFeedForViewer(viewer, { limit: 2 });
      expect(page1.rows.length).toBe(2);
      expect(page1.nextCursor).toBeTruthy();
      for (const row of page1.rows) {
        expect(row.takeoffZoneId).toBeNull(); // private zone, viewer isn't the owner
      }

      const page2 = await repo.listFeedForViewer(viewer, { limit: 2, cursor: page1.nextCursor });
      expect(page2.rows.length).toBeGreaterThan(0);
      const page1Ids = new Set(page1.rows.map((r) => r.id));
      for (const row of page2.rows) {
        expect(page1Ids.has(row.id)).toBe(false);
      }
    });
  });

  // =======================================================================
  // SPRINT-005 PR3 — "Which spot?" (create, dedup, re-associate)
  // =======================================================================
  describe("createOrAttachSiteFromFlight — zones", () => {
    it("creates a site AND a first zone together in one call", async () => {
      const owner = await createPilot("createsitezone");
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 90, takeoffLon: 90 });

      const result = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "create", name: "Combo Ridge", visibility: "public" },
        zone: { mode: "create", name: "Combo Launch", visibility: "public" },
      });
      siteIds.push(result.site.id);
      if (result.zone) zoneIds.push(result.zone.id);

      expect(result.createdSite).toBe(true);
      expect(result.createdZone).toBe(true);
      expect(result.zone?.siteId).toBe(result.site.id);
      expect(result.zone?.kind).toBe("takeoff"); // set from the endpoint, not left at "unknown"

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffSiteId).toBe(result.site.id);
      expect(row.takeoffZoneId).toBe(result.zone?.id);
      expect(row.takeoffZoneName).toBe("Combo Launch");
    });

    it("adds a zone to an EXISTING visible site, including one owned by a different pilot", async () => {
      const siteOwner = await createPilot("existingsiteowner");
      const zoneCreator = await createPilot("existingsitezonecreator");
      const site = await createSite({ lat: -109, lon: -109, visibility: "public", ownerId: siteOwner });

      const flight = await createFlight({ ownerId: zoneCreator, visibility: "public", takeoffLat: 91, takeoffLon: 91 });
      const result = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: zoneCreator,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
        zone: { mode: "create", name: "Contributed Spot", visibility: "public" },
      });
      if (result.zone) zoneIds.push(result.zone.id);

      expect(result.createdSite).toBe(false);
      expect(result.zone?.ownerId).toBe(zoneCreator); // the CONTRIBUTOR owns the zone, not the site owner
      expect(result.zone?.siteId).toBe(site.id);
    });

    it("reuses a sibling zone under the resolved site", async () => {
      const owner = await createPilot("reusezone");
      const site = await createSite({ lat: -108, lon: -108, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -108, lon: -108, visibility: "public", ownerId: owner });

      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 92, takeoffLon: 92 });
      const result = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
        zone: { mode: "reuse", id: zone.id },
      });

      expect(result.createdZone).toBe(false);
      expect(result.zone?.id).toBe(zone.id);
    });

    it("refuses to reuse a zone under the WRONG site", async () => {
      const owner = await createPilot("reusewrongzone");
      const siteA = await createSite({ lat: -107, lon: -107, visibility: "public", ownerId: owner });
      const siteB = await createSite({ lat: -106, lon: -106, visibility: "public", ownerId: owner });
      const zoneUnderB = await createZone({ siteId: siteB.id, lat: -106, lon: -106, visibility: "public", ownerId: owner });

      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 93, takeoffLon: 93 });
      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flight.id,
          ownerId: owner,
          endpoint: "takeoff",
          site: { mode: "reuse", id: siteA.id },
          zone: { mode: "reuse", id: zoneUnderB.id },
        }),
      ).rejects.toThrow(/zone/i);
    });

    it("a public zone name colliding with a PUBLIC sibling is refused with a steer to reuse", async () => {
      const owner = await createPilot("zonecollidepublic");
      const site = await createSite({ lat: -105, lon: -105, visibility: "public", ownerId: owner });
      await createZone({ siteId: site.id, lat: -105, lon: -105, visibility: "public", ownerId: owner, name: "Shared Zone Name" });

      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 95, takeoffLon: 95 });
      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flight.id,
          ownerId: owner,
          endpoint: "takeoff",
          site: { mode: "reuse", id: site.id },
          zone: { mode: "create", name: "shared zone name", visibility: "public" },
        }),
      ).rejects.toThrow(/already exists/);

      const countAtLocation = await prisma.zone.count({ where: { siteId: site.id, normalizedName: "shared zone name" } });
      expect(countAtLocation).toBe(1);
    });

    it("a public zone name matching a DIFFERENT pilot's PRIVATE sibling succeeds — a second row, no leak", async () => {
      const privateZoneOwner = await createPilot("privzonenameowner");
      const publicZoneCreator = await createPilot("pubzonenamecreator");
      const site = await createSite({ lat: -104, lon: -104, visibility: "public", ownerId: privateZoneOwner });
      await createZone({
        siteId: site.id,
        lat: -104,
        lon: -104,
        visibility: "private",
        ownerId: privateZoneOwner,
        name: "Ambiguous Name",
      });

      const flight = await createFlight({ ownerId: publicZoneCreator, visibility: "public", takeoffLat: 96, takeoffLon: 96 });
      const result = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: publicZoneCreator,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
        zone: { mode: "create", name: "Ambiguous Name", visibility: "public" },
      });
      if (result.zone) zoneIds.push(result.zone.id);

      expect(result.createdZone).toBe(true); // NOT refused — the private sibling is invisible to this pilot
      const countAtLocation = await prisma.zone.count({ where: { siteId: site.id, normalizedName: "ambiguous name" } });
      expect(countAtLocation).toBe(2); // two distinct rows now exist
    });

    it("refuses to create a PUBLIC zone under a PRIVATE site", async () => {
      const owner = await createPilot("pubzoneprivsite");
      const site = await createSite({ lat: -103, lon: -103, visibility: "private", ownerId: owner });

      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 97, takeoffLon: 97 });
      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flight.id,
          ownerId: owner,
          endpoint: "takeoff",
          site: { mode: "reuse", id: site.id },
          zone: { mode: "create", name: "Should Fail", visibility: "public" },
        }),
      ).rejects.toThrow(/publish the site first/i);

      const created = await prisma.zone.findFirst({ where: { siteId: site.id, normalizedName: "should fail" } });
      expect(created).toBeNull();
    });

    it("a PRIVATE zone under a private site succeeds (the coherent private/private case)", async () => {
      const owner = await createPilot("privzoneprivsite");
      const site = await createSite({ lat: -102, lon: -102, visibility: "private", ownerId: owner });

      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 98, takeoffLon: 98 });
      const result = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flight.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
        zone: { mode: "create", name: "Private Spot", visibility: "private" },
      });
      if (result.zone) zoneIds.push(result.zone.id);

      expect(result.createdZone).toBe(true);
      expect(result.zone?.visibility).toBe("private");
    });

    it("opposite-endpoint zone reuse widens Zone.kind to 'both', never narrows", async () => {
      const owner = await createPilot("widenzonekind");
      const site = await createSite({ lat: -101, lon: -101, visibility: "public", ownerId: owner });
      const flightA = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 99, takeoffLon: 99 });
      const created = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightA.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
        zone: { mode: "create", name: "Widen Zone", visibility: "public" },
      });
      if (created.zone) zoneIds.push(created.zone.id);
      expect(created.zone?.kind).toBe("takeoff");

      const flightB = await createFlight({ ownerId: owner, visibility: "public", landingLat: 99, landingLon: 99 });
      const widened = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightB.id,
        ownerId: owner,
        endpoint: "landing",
        site: { mode: "reuse", id: site.id },
        zone: { mode: "reuse", id: created.zone!.id },
      });
      expect(widened.zone?.kind).toBe("both");

      // Never narrows back down on a subsequent takeoff reuse.
      const flightC = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 99, takeoffLon: 99 });
      const stillBoth = await siteRepo.createOrAttachSiteFromFlight({
        flightId: flightC.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
        zone: { mode: "reuse", id: created.zone!.id },
      });
      expect(stillBoth.zone?.kind).toBe("both");
    });

    it("concurrent same-name public zone creation never produces more than one row (partial index enforced)", async () => {
      // A genuine race between two open transactions: whichever code path
      // actually fires depends on real timing (the loser either hits the
      // in-transaction pre-probe, which throws a steer-to-reuse error, or
      // slips past it and hits the DB-level partial unique index, which
      // createOrAttachSiteFromFlight catches and resolves to a reuse). Both
      // outcomes are correct; what must hold regardless is the DB
      // invariant: never more than one public "Race Zone" under this site.
      const pilotA = await createPilot("concurrentzoneA");
      const pilotB = await createPilot("concurrentzoneB");
      const site = await createSite({ lat: -100, lon: -100, visibility: "public", ownerId: pilotA });

      const flightA = await createFlight({ ownerId: pilotA, visibility: "public", takeoffLat: 100, takeoffLon: 100 });
      const flightB = await createFlight({ ownerId: pilotB, visibility: "public", takeoffLat: 100.0002, takeoffLon: 100.0002 });

      const results = await Promise.allSettled([
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flightA.id,
          ownerId: pilotA,
          endpoint: "takeoff",
          site: { mode: "reuse", id: site.id },
          zone: { mode: "create", name: "Race Zone", visibility: "public" },
        }),
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flightB.id,
          ownerId: pilotB,
          endpoint: "takeoff",
          site: { mode: "reuse", id: site.id },
          zone: { mode: "create", name: "Race Zone", visibility: "public" },
        }),
      ]);

      for (const r of results) {
        if (r.status === "fulfilled" && r.value.zone) zoneIds.push(r.value.zone.id);
      }
      // At least one side must have succeeded — the race can't fail both.
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);

      const zones = await prisma.zone.findMany({ where: { siteId: site.id, normalizedName: "race zone" } });
      expect(zones.length).toBe(1);
    });

    it("a non-owner cannot name a zone on someone else's flight", async () => {
      const owner = await createPilot("zonehijackowner");
      const stranger = await createPilot("zonehijackstranger");
      const site = await createSite({ lat: -99, lon: -99, visibility: "public", ownerId: owner });
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 101, takeoffLon: 101 });

      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flight.id,
          ownerId: stranger,
          endpoint: "takeoff",
          site: { mode: "reuse", id: site.id },
          zone: { mode: "create", name: "Hijacked Spot", visibility: "public" },
        }),
      ).rejects.toThrow();

      const row = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
      expect(row.takeoffZoneId).toBeNull();
    });

    it("the shared daily cap refuses across sites AND zones combined", async () => {
      const owner = await createPilot("sharedcap");
      const site = await createSite({ lat: -98, lon: -98, visibility: "public", ownerId: owner });

      // One site already "used" one slot conceptually; fill the rest with
      // zones under the same site (spread out so none collide on proximity).
      for (let i = 0; i < siteRepo.DAILY_CREATE_CAP - 1; i++) {
        const lat = 102 + i * 0.01; // ~1.1 km apart — outside SUGGEST_RADIUS_M
        const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: lat, takeoffLon: 102 });
        const result = await siteRepo.createOrAttachSiteFromFlight({
          flightId: flight.id,
          ownerId: owner,
          endpoint: "takeoff",
          site: { mode: "create", name: `Cap Zone Site ${i}`, visibility: "public" },
        });
        siteIds.push(result.site.id);
      }

      const overflowFlight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 103.5, takeoffLon: 102 });
      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: overflowFlight.id,
          ownerId: owner,
          endpoint: "takeoff",
          site: { mode: "reuse", id: site.id },
          zone: { mode: "create", name: "One Too Many Zone", visibility: "public" },
        }),
      ).rejects.toThrow(/limit/i);
    });
  });

  describe("suggestNearbyLocations — nested zones under sites", () => {
    it("surfaces a site's visible zones nested underneath it", async () => {
      const owner = await createPilot("nestedsuggest");
      const site = await createSite({ lat: -96, lon: -96, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -96, lon: -96, visibility: "public", ownerId: owner });

      const suggestions = await siteRepo.suggestNearbyLocations(-95.999, -95.999, owner);
      const match = suggestions.find((s) => s.id === site.id);
      expect(match).toBeTruthy();
      expect(match?.zones.some((z) => z.id === zone.id)).toBe(true);
    });

    it("surfaces a site via a nearby visible zone even when the site's own coordinate is outside the box", async () => {
      const owner = await createPilot("farsitesuggest");
      // Site anchor far from the query point (just past SUGGEST_RADIUS_M),
      // but its zone sits right at the query point.
      const site = await createSite({ lat: -95, lon: -95, visibility: "public", ownerId: owner });
      const zone = await createZone({
        siteId: site.id,
        lat: -94.98, // ~2.2 km away — outside SUGGEST_RADIUS_M from the site's OWN anchor
        lon: -95,
        visibility: "public",
        ownerId: owner,
      });

      const suggestions = await siteRepo.suggestNearbyLocations(-94.98, -95, owner);
      const match = suggestions.find((s) => s.id === site.id);
      expect(match).toBeTruthy();
      expect(match?.zones.some((z) => z.id === zone.id)).toBe(true);
    });

    it("never surfaces a private zone the viewer cannot see, even nested under a visible site", async () => {
      const owner = await createPilot("privzonesuggestowner");
      const stranger = await createPilot("privzonesuggeststranger");
      const site = await createSite({ lat: -94, lon: -94, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -94, lon: -94, visibility: "private", ownerId: owner });

      const strangerSuggestions = await siteRepo.suggestNearbyLocations(-93.999, -93.999, stranger);
      const strangerMatch = strangerSuggestions.find((s) => s.id === site.id);
      expect(strangerMatch?.zones.some((z) => z.id === zone.id)).toBe(false);

      const ownSuggestions = await siteRepo.suggestNearbyLocations(-93.999, -93.999, owner);
      const ownMatch = ownSuggestions.find((s) => s.id === site.id);
      expect(ownMatch?.zones.some((z) => z.id === zone.id)).toBe(true);
    });
  });

  describe("reassociateOwnFlights — zone upgrades the creator's already-site-bound back-catalog", () => {
    it("upgrades the creator's own already-site-bound flights to the new zone; another pilot's stay at the site level", async () => {
      const owner = await createPilot("upgradeowner");
      const other = await createPilot("upgradeother");
      const site = await createSite({ lat: -93, lon: -93, visibility: "public", ownerId: owner });

      // The creator's own OLDER flight, already bound to the bare site
      // (takeoffZoneId null) — exactly the split-logbook state SPRINT-005
      // exists to fix.
      const olderOwnAtSite = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });
      // Another pilot's flight, also already bound to the bare site — must
      // NOT be touched.
      const othersAtSite = await createFlightWithSite({ ownerId: other, visibility: "public", site, endpoint: "takeoff" });
      // Set their coordinates to the site's own spot so they fall within
      // the new zone's radius once one is created there.
      await prisma.flight.update({ where: { id: olderOwnAtSite.id }, data: { takeoffLat: -93, takeoffLon: -93 } });
      await prisma.flight.update({ where: { id: othersAtSite.id }, data: { takeoffLat: -93, takeoffLon: -93 } });

      const current = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: -93, takeoffLon: -93 });
      const result = await siteRepo.createOrAttachSiteFromFlight({
        flightId: current.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
        zone: { mode: "create", name: "Upgrade Zone", visibility: "public" },
      });
      if (result.zone) zoneIds.push(result.zone.id);

      expect(result.reassociated.updated).toBeGreaterThanOrEqual(1);

      const olderRow = await prisma.flight.findUniqueOrThrow({ where: { id: olderOwnAtSite.id } });
      expect(olderRow.takeoffZoneId).toBe(result.zone?.id);
      expect(olderRow.takeoffZoneName).toBe("Upgrade Zone");

      const othersRow = await prisma.flight.findUniqueOrThrow({ where: { id: othersAtSite.id } });
      expect(othersRow.takeoffZoneId).toBeNull(); // another pilot's flight is never touched
      expect(othersRow.takeoffSiteId).toBe(site.id); // still correctly at the site level
    });

    it("does NOT upgrade a flight already bound to a DIFFERENT zone under the same site", async () => {
      const owner = await createPilot("noupgradeowner");
      const site = await createSite({ lat: -92, lon: -92, visibility: "public", ownerId: owner });
      const otherZone = await createZone({ siteId: site.id, lat: -92, lon: -92, visibility: "public", ownerId: owner });
      const alreadyZoned = await createFlightWithZone({
        ownerId: owner,
        visibility: "public",
        site,
        zone: otherZone,
        endpoint: "takeoff",
      });

      const current = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: -92, takeoffLon: -92 });
      const result = await siteRepo.createOrAttachSiteFromFlight({
        flightId: current.id,
        ownerId: owner,
        endpoint: "takeoff",
        site: { mode: "reuse", id: site.id },
        zone: { mode: "create", name: "New Sibling Zone", visibility: "public" },
      });
      if (result.zone) zoneIds.push(result.zone.id);

      const stillOtherZone = await prisma.flight.findUniqueOrThrow({ where: { id: alreadyZoned.id } });
      expect(stillOtherZone.takeoffZoneId).toBe(otherZone.id); // untouched — already zoned, not null
    });
  });

  // ---------------------------------------------------------------------
  // SPRINT-006: the privacy matrix, re-run with boundary-bearing rows.
  // Decision 1 ("a boundary is geometry, never identity") is a claim about
  // lib/flights/repo.ts's read-path firewall — which this sprint does not
  // touch at all. These are the same core cells the SPRINT-004/005 matrix
  // above already proves for circle-only rows, re-run against otherwise
  // IDENTICAL fixtures that additionally carry a boundary — if a boundary's
  // mere presence changed any of these outcomes, decision 1 would be wrong.
  // ---------------------------------------------------------------------
  describe("SPRINT-006: privacy matrix re-run with boundary-bearing rows", () => {
    it("a PRIVATE boundary-bearing site is invisible to a stranger through a PUBLIC flight (the core shadowing case)", async () => {
      const owner = await createPilot("b6privsiteowner");
      const stranger = await createPilot("b6privsitestranger");
      const site = await createSite({ lat: 70, lon: 70, visibility: "private", ownerId: owner, boundaryHalfSizeM: 100 });
      const flight = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });

      const strangerView = await repo.getFlightForViewer(flight.id, stranger);
      expect(strangerView?.takeoffSiteName ?? null).toBeNull();

      const ownerView = await repo.getFlightForViewer(flight.id, owner);
      expect(ownerView?.takeoffSiteName).toBe(site.name);

      const anonView = await repo.getFlightForViewer(flight.id, null);
      expect(anonView?.takeoffSiteName ?? null).toBeNull();
    });

    it("a PUBLIC boundary-bearing site is visible to everyone", async () => {
      const owner = await createPilot("b6pubsiteowner");
      const stranger = await createPilot("b6pubsitestranger");
      const site = await createSite({ lat: 71, lon: 71, visibility: "public", ownerId: owner, boundaryHalfSizeM: 100 });
      const flight = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });

      for (const viewerId of [owner, stranger, null]) {
        const seen = await repo.getFlightForViewer(flight.id, viewerId);
        expect(seen?.takeoffSiteName).toBe(site.name);
      }
    });

    it("zone conjunction holds for a boundary-bearing PRIVATE zone under a PUBLIC site — hidden from a stranger, visible to the zone owner", async () => {
      const siteOwner = await createPilot("b6zoneconjsiteowner");
      const zoneOwner = await createPilot("b6zoneconjzoneowner");
      const stranger = await createPilot("b6zoneconjstranger");
      const site = await createSite({ lat: 72, lon: 72, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({
        siteId: site.id,
        lat: 72,
        lon: 72,
        visibility: "private",
        ownerId: zoneOwner,
        boundaryHalfSizeM: 50,
      });
      const flight = await createFlightWithZone({ ownerId: zoneOwner, visibility: "public", site, zone, endpoint: "takeoff" });

      const zoneOwnerView = await repo.getFlightForViewer(flight.id, zoneOwner);
      expect(zoneOwnerView?.takeoffZoneName).toBe(zone.name);
      expect(zoneOwnerView?.takeoffSiteName).toBe(site.name); // the site itself is public — still shown

      const strangerView = await repo.getFlightForViewer(flight.id, stranger);
      expect(strangerView?.takeoffZoneName ?? null).toBeNull();
      expect(strangerView?.takeoffSiteName).toBe(site.name); // conjunction: only the ZONE name is stripped
    });

    it("zone conjunction holds for a boundary-bearing zone under a PRIVATE site — the site gate strips the zone too, even though the zone itself is public", async () => {
      const owner = await createPilot("b6zoneconjprivsiteowner");
      const stranger = await createPilot("b6zoneconjprivsitestranger");
      const site = await createSite({ lat: 73, lon: 73, visibility: "private", ownerId: owner });
      const zone = await createZone({
        siteId: site.id,
        lat: 73,
        lon: 73,
        visibility: "public",
        ownerId: owner,
        boundaryHalfSizeM: 50,
      });
      const flight = await createFlightWithZone({ ownerId: owner, visibility: "public", site, zone, endpoint: "takeoff" });

      const strangerView = await repo.getFlightForViewer(flight.id, stranger);
      expect(strangerView?.takeoffSiteName ?? null).toBeNull();
      expect(strangerView?.takeoffZoneName ?? null).toBeNull(); // the parent gate strips the zone too

      const ownerView = await repo.getFlightForViewer(flight.id, owner);
      expect(ownerView?.takeoffSiteName).toBe(site.name);
      expect(ownerView?.takeoffZoneName).toBe(zone.name);
    });

    it("a boundary-bearing site/zone pair behaves identically whether or not either row actually carries a boundary", async () => {
      // Two byte-identical scenarios except one pair of rows has boundaries
      // and the other doesn't — same visibility inputs must produce the
      // same read-path outcome.
      const owner = await createPilot("b6identowner");
      const stranger = await createPilot("b6identstranger");

      const circleSite = await createSite({ lat: 74, lon: 74, visibility: "private", ownerId: owner });
      const circleZone = await createZone({ siteId: circleSite.id, lat: 74, lon: 74, visibility: "public", ownerId: owner });
      const circleFlight = await createFlightWithZone({
        ownerId: owner,
        visibility: "public",
        site: circleSite,
        zone: circleZone,
        endpoint: "takeoff",
      });

      const boundarySite = await createSite({
        lat: 75,
        lon: 75,
        visibility: "private",
        ownerId: owner,
        boundaryHalfSizeM: 100,
      });
      const boundaryZone = await createZone({
        siteId: boundarySite.id,
        lat: 75,
        lon: 75,
        visibility: "public",
        ownerId: owner,
        boundaryHalfSizeM: 50,
      });
      const boundaryFlight = await createFlightWithZone({
        ownerId: owner,
        visibility: "public",
        site: boundarySite,
        zone: boundaryZone,
        endpoint: "takeoff",
      });

      const circleStrangerView = await repo.getFlightForViewer(circleFlight.id, stranger);
      const boundaryStrangerView = await repo.getFlightForViewer(boundaryFlight.id, stranger);
      expect(boundaryStrangerView?.takeoffSiteName ?? null).toEqual(circleStrangerView?.takeoffSiteName ?? null);
      expect(boundaryStrangerView?.takeoffZoneName ?? null).toEqual(circleStrangerView?.takeoffZoneName ?? null);

      // Names are unique per fixture by construction — compare VISIBILITY
      // (present vs. null), not the literal string, which is what actually
      // exercises decision 1 ("a boundary is geometry, never identity").
      const circleOwnerView = await repo.getFlightForViewer(circleFlight.id, owner);
      const boundaryOwnerView = await repo.getFlightForViewer(boundaryFlight.id, owner);
      expect(boundaryOwnerView?.takeoffSiteName != null).toBe(circleOwnerView?.takeoffSiteName != null);
      expect(boundaryOwnerView?.takeoffZoneName != null).toBe(circleOwnerView?.takeoffZoneName != null);
      expect(boundaryOwnerView?.takeoffSiteName).toBe(boundarySite.name);
      expect(boundaryOwnerView?.takeoffZoneName).toBe(boundaryZone.name);
    });

    it("boundary JSON is never selected into a viewer-facing flight read", async () => {
      const owner = await createPilot("b6noleakowner");
      const site = await createSite({ lat: 76, lon: 76, visibility: "public", ownerId: owner, boundaryHalfSizeM: 100 });
      const flight = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });

      const seen = await repo.getFlightForViewer(flight.id, owner);
      expect(seen).not.toHaveProperty("boundary");
      expect(seen).not.toHaveProperty("takeoffSite");
      expect(JSON.stringify(seen)).not.toContain("coordinates");
    });
  });

  // ---------------------------------------------------------------------
  // SPRINT-006 PR3: the boundary write path — setSiteBoundary/
  // clearSiteBoundary/setZoneBoundary/clearZoneBoundary and the two
  // owner-scoped picker listings. Coordinate band 77-79.9 is disjoint from
  // every other range used in this file and lib/sites/lookup.test.ts.
  // ---------------------------------------------------------------------
  describe("SPRINT-006 PR3: boundary write path", () => {
    function squarePolygon(lat: number, lon: number, halfSizeM: number) {
      const dLat = halfSizeM / 111_320;
      const dLon = halfSizeM / (111_320 * Math.cos((lat * Math.PI) / 180));
      return {
        type: "Polygon",
        coordinates: [
          [
            [lon - dLon, lat - dLat],
            [lon + dLon, lat - dLat],
            [lon + dLon, lat + dLat],
            [lon - dLon, lat + dLat],
            [lon - dLon, lat - dLat],
          ],
        ],
      };
    }

    it("setSiteBoundary: the owner can set a valid boundary; a nonexistent site is refused", async () => {
      const owner = await createPilot("b6wpsiteowner");
      const site = await createSite({ lat: 77, lon: 77, visibility: "public", ownerId: owner });

      const updated = await associate.setSiteBoundary(site.id, owner, squarePolygon(77, 77, 200));
      expect(updated.boundary).not.toBeNull();
      expect(updated.boundaryMinLat).not.toBeNull();
      expect(updated.boundaryUpdatedById).toBe(owner);

      await expect(associate.setSiteBoundary("nonexistent-site-id", owner, squarePolygon(77, 77, 200))).rejects.toThrow(
        /not found/i,
      );
    });

    it("SPRINT-007: an onboarded STRANGER may set a PUBLIC site's boundary — community edit v1 — but not a PRIVATE one", async () => {
      const owner = await createPilot("b6wpsitecomm-owner");
      const stranger = await createPilot("b6wpsitecomm-stranger");
      const publicSite = await createSite({ lat: 77.05, lon: 77.05, visibility: "public", ownerId: owner });
      const privateSite = await createSite({ lat: 77.06, lon: 77.06, visibility: "private", ownerId: owner });

      const byStranger = await associate.setSiteBoundary(publicSite.id, stranger, squarePolygon(77.05, 77.05, 200));
      expect(byStranger.boundary).not.toBeNull();
      expect(byStranger.boundaryUpdatedById).toBe(stranger); // attribution follows the actual editor, not the owner

      await expect(
        associate.setSiteBoundary(privateSite.id, stranger, squarePolygon(77.06, 77.06, 200)),
      ).rejects.toThrow(/don't have permission to edit it/i);
    });

    it("setSiteBoundary rejects an invalid boundary with a named reason, and clearSiteBoundary always succeeds for the owner", async () => {
      const owner = await createPilot("b6wpsiteinvalid");
      const site = await createSite({ lat: 77.1, lon: 77.1, visibility: "public", ownerId: owner });

      await expect(
        associate.setSiteBoundary(site.id, owner, { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] }),
      ).rejects.toThrow(/invalid boundary/i);

      const set = await associate.setSiteBoundary(site.id, owner, squarePolygon(77.1, 77.1, 200));
      expect(set.boundary).not.toBeNull();

      const cleared = await associate.clearSiteBoundary(site.id, owner);
      expect(cleared.boundary).toBeNull();
      expect(cleared.boundaryMinLat).toBeNull();
      expect(cleared.boundaryUpdatedById).toBe(owner); // clearing still attributes who cleared it
    });

    it("setZoneBoundary/clearZoneBoundary: the zone's own owner, the parent site's owner, and (SPRINT-007) any onboarded pilot on a PUBLIC zone may edit", async () => {
      const siteOwner = await createPilot("b6wpzonesiteowner");
      const zoneOwner = await createPilot("b6wpzonezoneowner");
      const stranger = await createPilot("b6wpzonestranger");
      const site = await createSite({ lat: 77.2, lon: 77.2, visibility: "public", ownerId: siteOwner });
      const zone = await createZone({ siteId: site.id, lat: 77.2, lon: 77.2, visibility: "public", ownerId: zoneOwner });

      // The zone's own owner can set it.
      const byZoneOwner = await associate.setZoneBoundary(zone.id, zoneOwner, squarePolygon(77.2, 77.2, 100));
      expect(byZoneOwner.boundary).not.toBeNull();
      expect(byZoneOwner.boundaryUpdatedById).toBe(zoneOwner);

      // The PARENT SITE's owner may also edit it (decision 4) — critically,
      // with NO flight of theirs ever bound to this zone. This is the exact
      // reachability gap both independent SPRINT-006 drafts left (a
      // bound-flight-only edit surface makes this power unreachable in
      // practice) — proven fixed at the associate.ts layer here.
      const bySiteOwner = await associate.setZoneBoundary(zone.id, siteOwner, squarePolygon(77.2, 77.2, 150));
      expect(bySiteOwner.boundary).not.toBeNull();
      expect(bySiteOwner.boundaryUpdatedById).toBe(siteOwner);

      // SPRINT-007: this "stranger" is actually now a valid community
      // editor of a PUBLIC zone — the assertion below moved to its own
      // test using a PRIVATE zone, where a stranger is still refused.
      const byStranger = await associate.setZoneBoundary(zone.id, stranger, squarePolygon(77.2, 77.2, 100));
      expect(byStranger.boundaryUpdatedById).toBe(stranger);

      const cleared = await associate.clearZoneBoundary(zone.id, zoneOwner);
      expect(cleared.boundary).toBeNull();
    });

    it("SPRINT-007: a stranger may NOT edit a boundary under a PRIVATE site, even for an otherwise-public-looking zone", async () => {
      const siteOwner = await createPilot("b6wpzonepriv-siteowner");
      const zoneOwner = await createPilot("b6wpzonepriv-zoneowner");
      const stranger = await createPilot("b6wpzonepriv-stranger");
      const privateSite = await createSite({ lat: 77.25, lon: 77.25, visibility: "private", ownerId: siteOwner });
      // A "public" zone under a PRIVATE site is not effectively public — the
      // SPRINT-005 conjunction applies to community edit-control exactly as
      // it does to everything else.
      const zone = await createZone({ siteId: privateSite.id, lat: 77.25, lon: 77.25, visibility: "public", ownerId: zoneOwner });

      await expect(
        associate.setZoneBoundary(zone.id, stranger, squarePolygon(77.25, 77.25, 100)),
      ).rejects.toThrow(/don't have permission to edit it/i);
    });

    it("a boundary edit is never refused because another pilot's flight references the row", async () => {
      const owner = await createPilot("b6wpstillref-owner");
      const otherPilot = await createPilot("b6wpstillref-other");
      const site = await createSite({ lat: 77.3, lon: 77.3, visibility: "public", ownerId: owner });
      // Another pilot's flight depends on this site — rename/delete would
      // refuse; a boundary edit must not.
      await createFlightWithSite({ ownerId: otherPilot, visibility: "public", site, endpoint: "takeoff" });

      const updated = await associate.setSiteBoundary(site.id, owner, squarePolygon(77.3, 77.3, 200));
      expect(updated.boundary).not.toBeNull();
    });

    it("a TIGHTENED boundary never un-binds an already-bound flight — the drawer's or anyone else's", async () => {
      const owner = await createPilot("b6wptighten-owner");
      const otherPilot = await createPilot("b6wptighten-other");
      const site = await createSite({ lat: 77.4, lon: 77.4, visibility: "public", ownerId: owner });
      const ownFlight = await createFlightWithSite({ ownerId: owner, visibility: "public", site, endpoint: "takeoff" });
      const otherFlight = await createFlightWithSite({ ownerId: otherPilot, visibility: "public", site, endpoint: "takeoff" });

      // A boundary far tighter than the site's own anchor precision — must
      // still contain the anchor itself, but nothing else, once validated.
      await associate.setSiteBoundary(site.id, owner, squarePolygon(77.4, 77.4, 20));

      const ownAfter = await prisma.flight.findUniqueOrThrow({ where: { id: ownFlight.id } });
      const otherAfter = await prisma.flight.findUniqueOrThrow({ where: { id: otherFlight.id } });
      expect(ownAfter.takeoffSiteId).toBe(site.id);
      expect(otherAfter.takeoffSiteId).toBe(site.id);
    });

    it("widening a boundary re-associates the drawer's OWN previously-unmatched flights, but not other pilots'", async () => {
      const owner = await createPilot("b6wpwiden-owner");
      const otherPilot = await createPilot("b6wpwiden-other");
      const site = await createSite({ lat: 77.5, lon: 77.5, visibility: "public", ownerId: owner, kind: "takeoff" });

      const farLon = 77.5 + 1000 / (111_320 * Math.cos((77.5 * Math.PI) / 180)); // ~1000m east, past the 600m circle
      const ownUnmatched = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 77.5, takeoffLon: farLon });
      const otherUnmatched = await createFlight({ ownerId: otherPilot, visibility: "public", takeoffLat: 77.5, takeoffLon: farLon });

      await associate.setSiteBoundary(site.id, owner, squarePolygon(77.5, 77.5, 1500));

      const ownAfter = await prisma.flight.findUniqueOrThrow({ where: { id: ownUnmatched.id } });
      const otherAfter = await prisma.flight.findUniqueOrThrow({ where: { id: otherUnmatched.id } });
      expect(ownAfter.takeoffSiteId).toBe(site.id); // the drawer's own flight picked up
      expect(otherAfter.takeoffSiteId).toBeNull(); // another pilot's flight is untouched
    });

    it("the num_nulls CHECK rejects a hand-written half-written boundary row", async () => {
      const owner = await createPilot("b6wpcheck-owner");
      const site = await createSite({ lat: 77.6, lon: 77.6, visibility: "public", ownerId: owner });

      await expect(
        prisma.site.update({ where: { id: site.id }, data: { boundaryMinLat: 1, boundaryMaxLat: 2 } }),
      ).rejects.toThrow();
    });

    it("listOwnedSitesForBoundaryEditing returns exactly the caller's own sites, with hasBoundary reflecting state", async () => {
      const owner = await createPilot("b6wplistsite-owner");
      const stranger = await createPilot("b6wplistsite-stranger");
      const ownedNoBoundary = await createSite({ lat: 77.7, lon: 77.7, visibility: "public", ownerId: owner });
      const ownedWithBoundary = await createSite({
        lat: 77.71,
        lon: 77.71,
        visibility: "public",
        ownerId: owner,
        boundaryHalfSizeM: 100,
      });
      await createSite({ lat: 77.72, lon: 77.72, visibility: "public", ownerId: stranger });

      const listing = await associate.listOwnedSitesForBoundaryEditing(owner);
      const byId = new Map(listing.map((s) => [s.id, s]));
      expect(byId.has(ownedNoBoundary.id)).toBe(true);
      expect(byId.get(ownedNoBoundary.id)?.hasBoundary).toBe(false);
      expect(byId.has(ownedWithBoundary.id)).toBe(true);
      expect(byId.get(ownedWithBoundary.id)?.hasBoundary).toBe(true);
      expect(listing.every((s) => s.id !== undefined)).toBe(true);
      // No stranger-owned site leaks into this caller's listing.
      const strangerListing = await associate.listOwnedSitesForBoundaryEditing(stranger);
      expect(strangerListing.some((s) => s.id === ownedNoBoundary.id)).toBe(false);
    });

    it("listOwnedZonesForBoundaryEditing returns the caller's own zones AND zones under sites they own, correctly flagging editableAsSiteOwner", async () => {
      const siteOwner = await createPilot("b6wplistzone-siteowner");
      const zoneOwner = await createPilot("b6wplistzone-zoneowner");
      const unrelated = await createPilot("b6wplistzone-unrelated");
      const site = await createSite({ lat: 77.8, lon: 77.8, visibility: "public", ownerId: siteOwner });
      const ownZone = await createZone({ siteId: site.id, lat: 77.8, lon: 77.8, visibility: "public", ownerId: zoneOwner });
      const otherSite = await createSite({ lat: 77.81, lon: 77.81, visibility: "public", ownerId: unrelated });
      await createZone({ siteId: otherSite.id, lat: 77.81, lon: 77.81, visibility: "public", ownerId: unrelated });

      const siteOwnerListing = await associate.listOwnedZonesForBoundaryEditing(siteOwner);
      const entry = siteOwnerListing.find((z) => z.id === ownZone.id);
      expect(entry).toBeDefined();
      expect(entry?.editableAsSiteOwner).toBe(true); // siteOwner doesn't own the zone directly

      const zoneOwnerListing = await associate.listOwnedZonesForBoundaryEditing(zoneOwner);
      const ownEntry = zoneOwnerListing.find((z) => z.id === ownZone.id);
      expect(ownEntry).toBeDefined();
      expect(ownEntry?.editableAsSiteOwner).toBe(false); // zoneOwner owns it directly

      const unrelatedListing = await associate.listOwnedZonesForBoundaryEditing(unrelated);
      expect(unrelatedListing.some((z) => z.id === ownZone.id)).toBe(false); // no leak
    });

    it("boundary writes are capped per caller per day", async () => {
      const owner = await createPilot("b6wpcap-owner");
      const sites = await Promise.all(
        Array.from({ length: associate.DAILY_COMMUNITY_EDIT_CAP + 1 }, (_, i) =>
          createSite({ lat: 77.9 + i * 0.001, lon: 77.9 + i * 0.001, visibility: "public", ownerId: owner }),
        ),
      );

      for (const site of sites.slice(0, associate.DAILY_COMMUNITY_EDIT_CAP)) {
        await associate.setSiteBoundary(site.id, owner, squarePolygon(site.lat, site.lon, 50));
      }

      const overCap = sites[associate.DAILY_COMMUNITY_EDIT_CAP];
      await expect(
        associate.setSiteBoundary(overCap.id, owner, squarePolygon(overCap.lat, overCap.lon, 50)),
      ).rejects.toThrow(/daily community-edit limit/i);
    });

    it("suggestNearbyLocations offers a site whose boundary contains the point even when its anchor is outside the 2km suggest radius", async () => {
      const owner = await createPilot("b6suggestowner");
      const site = await createSite({
        lat: 55,
        lon: 55,
        visibility: "public",
        ownerId: owner,
        boundaryHalfSizeM: 3000, // reaches well past the 2km suggest radius
      });

      // A point 2.5km east of the anchor — outside SUGGEST_RADIUS_M (2km)
      // from the anchor, but inside the 3km-half boundary.
      const farLon = 55 + 2500 / (111_320 * Math.cos((55 * Math.PI) / 180));
      const suggestions = await siteRepo.suggestNearbyLocations(55, farLon, owner);
      expect(suggestions.some((s) => s.id === site.id)).toBe(true);
    });

    it("the in-transaction duplicate-name probe rejects a name conflict against a boundary-reaching site outside the suggest radius", async () => {
      const owner = await createPilot("b6dedupowner");
      const site = await createSite({
        lat: 55.1,
        lon: 55.1,
        visibility: "public",
        ownerId: owner,
        boundaryHalfSizeM: 3000,
        name: `B6 Dedup Ridge ${suffix}`,
      });

      const farLon = 55.1 + 2500 / (111_320 * Math.cos((55.1 * Math.PI) / 180));
      const flight = await createFlight({ ownerId: owner, visibility: "public", takeoffLat: 55.1, takeoffLon: farLon });

      await expect(
        siteRepo.createOrAttachSiteFromFlight({
          flightId: flight.id,
          ownerId: owner,
          endpoint: "takeoff",
          site: { mode: "create", name: site.name, visibility: "public" },
        }),
      ).rejects.toThrow(/already exists nearby/i);
    });
  });

  // ---------------------------------------------------------------------
  // SPRINT-006: a kind:"both" row's boundary governs BOTH takeoff and
  // landing matching (interview decision 3 — one shared boundary, not an
  // endpoint-specific pair). Coordinate band 56.x.
  // ---------------------------------------------------------------------
  describe("SPRINT-006: kind:\"both\" boundary applies to both endpoints", () => {
    it("a single boundary on a kind:both site matches both a takeoff and a landing endpoint", async () => {
      const owner = await createPilot("b6bothkindowner");
      const site = await createSite({
        lat: 56,
        lon: 56,
        kind: "both",
        visibility: "public",
        ownerId: owner,
        boundaryHalfSizeM: 1500, // past both the 600m takeoff AND 900m landing circle
      });

      const farLon = 56 + 1200 / (111_320 * Math.cos((56 * Math.PI) / 180));
      // Uses the app's extended client (lib/prisma), not this file's raw
      // PrismaClient — findLocation's Db type requires it structurally.
      const { findLocation } = await import("@/lib/sites/lookup");
      const { prisma: appPrisma } = await import("@/lib/prisma");

      const takeoffMatch = await findLocation(appPrisma, { lat: 56, lon: farLon, kind: "takeoff", viewerId: null });
      expect(takeoffMatch?.site.id).toBe(site.id);

      const landingMatch = await findLocation(appPrisma, { lat: 56, lon: farLon, kind: "landing", viewerId: null });
      expect(landingMatch?.site.id).toBe(site.id);
    });
  });
});
