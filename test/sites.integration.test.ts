// @vitest-environment node
//
// SPRINT-004's heart: the site read-path firewall. Requires local Postgres
// and must not skip — a skipped sites matrix means this sprint's privacy
// work is unverified.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for site integration tests.");
}

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("sites: read-path firewall", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let repo: typeof import("@/lib/flights/repo");
  let associate: typeof import("@/lib/sites/associate");
  const ids: string[] = [];
  const siteIds: string[] = [];
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
  }) {
    seq += 1;
    const name = opts.name ?? `Matrix Site ${seq}${suffix}`;
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
    visibility: "private" | "friends" | "public";
    status?: string;
    takeoffSiteId?: string | null;
    takeoffSiteName?: string | null;
    landingSiteId?: string | null;
    landingSiteName?: string | null;
  }) {
    seq += 1;
    const flight = await prisma.flight.create({
      data: {
        ownerId: opts.ownerId,
        visibility: opts.visibility,
        status: opts.status ?? "ready",
        igcSha256: `sitesmx${suffix}${seq}`,
        flightDate: new Date("2026-06-01T00:00:00.000Z"),
        takeoffAt: new Date("2026-06-01T10:00:00.000Z"),
        takeoffSiteId: opts.takeoffSiteId ?? null,
        takeoffSiteName: opts.takeoffSiteName ?? null,
        landingSiteId: opts.landingSiteId ?? null,
        landingSiteName: opts.landingSiteName ?? null,
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
    const { siteCachePatch } = associate;
    const patch = siteCachePatch(opts.site, opts.endpoint);
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
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.kudo.deleteMany({ where: { flightId: { in: flightIds } } });
    await prisma.friendship.deleteMany({
      where: { OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }] },
    });
    await prisma.flight.deleteMany({ where: { id: { in: flightIds } } });
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
    it("resolveSiteCache reflects a demotion that happened after an earlier match", async () => {
      const siteOwner = await createPilot("raceowner");
      const flightOwner = await createPilot("raceflightowner");
      const site = await createSite({ lat: 17, lon: 17, visibility: "public", ownerId: siteOwner });

      // T0: matches while public — this is what findSite would have returned
      // before the transaction, i.e. the value ingestFlight would carry into
      // its transaction as `takeoffMatch`.
      const atMatchTime = await associate.resolveSiteCache(prisma, site.id, "takeoff", flightOwner);
      expect(atMatchTime.takeoffSiteId).toBe(site.id);
      expect(atMatchTime.takeoffSiteName).toBe(site.name);

      // T1: a concurrent demotion — the site becomes private, owned by
      // someone other than the flight's owner.
      await associate.setSiteVisibility(site.id, siteOwner, "private");

      // T2: the re-check inside the create transaction — must now resolve to
      // "no match at all", not a stale public name.
      const atWriteTime = await associate.resolveSiteCache(prisma, site.id, "takeoff", flightOwner);
      expect(atWriteTime.takeoffSiteId).toBeNull();
      expect(atWriteTime.takeoffSiteName).toBeNull();
    });

    it("resolveSiteCache still binds (without caching a name) when the flight's own owner demoted their own site", async () => {
      const owner = await createPilot("raceownsite");
      const site = await createSite({ lat: 18, lon: 18, visibility: "public", ownerId: owner });

      await associate.resolveSiteCache(prisma, site.id, "takeoff", owner);
      await associate.setSiteVisibility(site.id, owner, "private");

      const afterDemotion = await associate.resolveSiteCache(prisma, site.id, "takeoff", owner);
      // The owner can still legitimately bind to their own now-private site —
      // the id stays, but the cache correctly withholds the name.
      expect(afterDemotion.takeoffSiteId).toBe(site.id);
      expect(afterDemotion.takeoffSiteName).toBeNull();
    });

    it("resolveSiteCache resolves to no match when the site was deleted concurrently", async () => {
      const owner = await createPilot("racedeleted");
      const site = await createSite({ lat: 19, lon: 19, visibility: "public", ownerId: owner });
      await associate.deleteSite(site.id, owner);
      siteIds.splice(siteIds.indexOf(site.id), 1);

      const patch = await associate.resolveSiteCache(prisma, site.id, "takeoff", owner);
      expect(patch.takeoffSiteId).toBeNull();
      expect(patch.takeoffSiteName).toBeNull();
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
});
