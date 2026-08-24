// @vitest-environment node
//
// SPRINT-007 PR1: the audit log, derived contributor roster, and
// endorsements — schema-level constraints and the pure/DB-touching modules
// built directly on the new tables. Requires local Postgres and must not
// skip. Fixture lat/lon band: -150.x / 46.0x (disjoint from every other
// integration test file's band — see the SPRINT-005/006 fixture-collision
// lesson).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
config({ path: ".env.local" });

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

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for community integration tests.");
}

const suffix = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

describe("SPRINT-007: audit log, contributors, endorsements", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let audit: typeof import("@/lib/sites/audit");
  let contributors: typeof import("@/lib/sites/contributors");
  let endorsements: typeof import("@/lib/sites/endorsements");
  let associate: typeof import("@/lib/sites/associate");
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

  async function createSite(opts: { lat: number; lon: number; visibility: "private" | "public"; ownerId: string }) {
    seq += 1;
    const name = `Community Site ${seq}${suffix}`;
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

  async function createZone(opts: { siteId: string; lat: number; lon: number; visibility: "private" | "public"; ownerId: string }) {
    seq += 1;
    const name = `Community Zone ${seq}${suffix}`;
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

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    audit = await import("@/lib/sites/audit");
    contributors = await import("@/lib/sites/contributors");
    endorsements = await import("@/lib/sites/endorsements");
    associate = await import("@/lib/sites/associate");
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.locationAuditEntry.deleteMany({ where: { OR: [{ siteId: { in: siteIds } }, { zoneId: { in: zoneIds } }] } });
    await prisma.siteEndorsement.deleteMany({ where: { siteId: { in: siteIds } } });
    await prisma.zoneEndorsement.deleteMany({ where: { zoneId: { in: zoneIds } } });
    await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  describe("writeAuditEntry", () => {
    it("writes exactly one entry for a public target", async () => {
      const owner = await createPilot("aud");
      const site = await createSite({ lat: -150.1, lon: -150.1, visibility: "public", ownerId: owner });
      await audit.writeAuditEntry(prisma, { siteId: site.id }, owner, "create", "public", { name: site.name });
      const rows = await prisma.locationAuditEntry.findMany({ where: { siteId: site.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("create");
      expect(rows[0].actorId).toBe(owner);
    });

    it("is a no-op for a private target — nothing to leak later", async () => {
      const owner = await createPilot("audpriv");
      const site = await createSite({ lat: -150.2, lon: -150.2, visibility: "private", ownerId: owner });
      await audit.writeAuditEntry(prisma, { siteId: site.id }, owner, "create", "private", { name: site.name });
      await audit.writeAuditEntry(prisma, { siteId: site.id }, owner, "renamed", "private", { from: "a", to: "b" });
      const rows = await prisma.locationAuditEntry.findMany({ where: { siteId: site.id } });
      expect(rows).toHaveLength(0);
    });

    it("a publish writes a `published` entry with no reference to a prior name", async () => {
      const owner = await createPilot("audpub");
      const site = await createSite({ lat: -150.3, lon: -150.3, visibility: "public", ownerId: owner });
      await audit.writeAuditEntry(prisma, { siteId: site.id }, owner, "published", "public", {});
      const rows = await prisma.locationAuditEntry.findMany({ where: { siteId: site.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("published");
      expect(JSON.stringify(rows[0].detail)).not.toMatch(/from|name/);
    });
  });

  describe("DB-level CHECK constraints", () => {
    it("refuses a row with neither siteId nor zoneId", async () => {
      const owner = await createPilot("chk1");
      await expect(
        prisma.locationAuditEntry.create({ data: { actorId: owner, action: "create" } }),
      ).rejects.toThrow();
    });

    it("refuses a row with BOTH siteId and zoneId", async () => {
      const owner = await createPilot("chk2");
      const site = await createSite({ lat: -150.4, lon: -150.4, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -150.4, lon: -150.4, visibility: "public", ownerId: owner });
      await expect(
        prisma.locationAuditEntry.create({
          data: { siteId: site.id, zoneId: zone.id, actorId: owner, action: "create" },
        }),
      ).rejects.toThrow();
    });

    it("refuses an action outside the enum", async () => {
      const owner = await createPilot("chk3");
      const site = await createSite({ lat: -150.5, lon: -150.5, visibility: "public", ownerId: owner });
      await expect(
        prisma.locationAuditEntry.create({
          data: { siteId: site.id, actorId: owner, action: "deleted_everything" },
        }),
      ).rejects.toThrow();
    });
  });

  describe("contributor roster (derived from the audit log)", () => {
    it("lists every distinct actor, ordered by first contribution, excluding non-actors", async () => {
      const creator = await createPilot("c1");
      const editor = await createPilot("c2");
      const bystander = await createPilot("c3");
      const site = await createSite({ lat: -151.0, lon: -151.0, visibility: "public", ownerId: creator });

      await audit.writeAuditEntry(prisma, { siteId: site.id }, creator, "create", "public", { name: site.name });
      await new Promise((r) => setTimeout(r, 5));
      await audit.writeAuditEntry(prisma, { siteId: site.id }, editor, "renamed", "public", { from: "a", to: "b" });
      void bystander; // never contributes — must NOT appear in the roster

      const roster = await contributors.contributorsForSite(site.id);
      expect(roster.map((r) => r.profileId)).toEqual([creator, editor]);
      expect(roster[0].actionCount).toBe(1);
    });

    it("a zone roster is independent of its parent site's", async () => {
      const owner = await createPilot("c4");
      const site = await createSite({ lat: -151.1, lon: -151.1, visibility: "public", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -151.1, lon: -151.1, visibility: "public", ownerId: owner });
      await audit.writeAuditEntry(prisma, { zoneId: zone.id }, owner, "create", "public", { name: zone.name });

      expect(await contributors.contributorsForZone(zone.id)).toHaveLength(1);
      expect(await contributors.contributorsForSite(site.id)).toHaveLength(0);
    });
  });

  describe("endorsements", () => {
    it("toggles on then off, mirroring toggleKudo's mechanic", async () => {
      const owner = await createPilot("e1");
      const voter = await createPilot("e2");
      const site = await createSite({ lat: -152.0, lon: -152.0, visibility: "public", ownerId: owner });

      const on = await endorsements.toggleSiteEndorsement(site.id, voter);
      expect(on).toEqual({ endorsed: true });
      const summaryOn = await endorsements.siteEndorsementSummary(site.id, voter);
      expect(summaryOn).toEqual({ count: 1, hasEndorsed: true });

      const off = await endorsements.toggleSiteEndorsement(site.id, voter);
      expect(off).toEqual({ endorsed: false });
      const summaryOff = await endorsements.siteEndorsementSummary(site.id, voter);
      expect(summaryOff).toEqual({ count: 0, hasEndorsed: false });
    });

    it("self-endorsement is allowed — decision 2", async () => {
      const owner = await createPilot("e3");
      const site = await createSite({ lat: -152.1, lon: -152.1, visibility: "public", ownerId: owner });
      const result = await endorsements.toggleSiteEndorsement(site.id, owner);
      expect(result).toEqual({ endorsed: true });
    });

    it("refuses to endorse a private site", async () => {
      const owner = await createPilot("e4");
      const voter = await createPilot("e5");
      const site = await createSite({ lat: -152.2, lon: -152.2, visibility: "private", ownerId: owner });
      await expect(endorsements.toggleSiteEndorsement(site.id, voter)).rejects.toThrow();
    });

    it("refuses to endorse a public zone under a PRIVATE site — the effective-visibility conjunction", async () => {
      const owner = await createPilot("e6");
      const voter = await createPilot("e7");
      const site = await createSite({ lat: -152.3, lon: -152.3, visibility: "private", ownerId: owner });
      const zone = await createZone({ siteId: site.id, lat: -152.3, lon: -152.3, visibility: "public", ownerId: owner });
      await expect(endorsements.toggleZoneEndorsement(zone.id, voter)).rejects.toThrow();
      const summary = await endorsements.zoneEndorsementSummary(zone.id, voter);
      expect(summary).toBeNull();
    });

    it("batch counts match individual summaries", async () => {
      const owner = await createPilot("e8");
      const voterA = await createPilot("e9");
      const voterB = await createPilot("e10");
      const siteA = await createSite({ lat: -152.4, lon: -152.4, visibility: "public", ownerId: owner });
      const siteB = await createSite({ lat: -152.5, lon: -152.5, visibility: "public", ownerId: owner });
      await endorsements.toggleSiteEndorsement(siteA.id, voterA);
      await endorsements.toggleSiteEndorsement(siteA.id, voterB);
      await endorsements.toggleSiteEndorsement(siteB.id, voterA);

      const counts = await endorsements.siteEndorsementCounts([siteA.id, siteB.id]);
      expect(counts.get(siteA.id)).toBe(2);
      expect(counts.get(siteB.id)).toBe(1);
    });

    it("cascades away when the site is deleted", async () => {
      const owner = await createPilot("e11");
      const voter = await createPilot("e12");
      const site = await createSite({ lat: -152.6, lon: -152.6, visibility: "public", ownerId: owner });
      await endorsements.toggleSiteEndorsement(site.id, voter);
      await prisma.site.delete({ where: { id: site.id } });
      siteIds.splice(siteIds.indexOf(site.id), 1); // already gone
      const remaining = await prisma.siteEndorsement.findMany({ where: { siteId: site.id } });
      expect(remaining).toHaveLength(0);
    });
  });

  describe("actor deletion", () => {
    it("SetNulls the audit actor but the entry survives; the contributor roster drops them", async () => {
      const owner = await createPilot("d1");
      const editor = await createPilot("d2");
      const site = await createSite({ lat: -153.0, lon: -153.0, visibility: "public", ownerId: owner });
      await audit.writeAuditEntry(prisma, { siteId: site.id }, editor, "renamed", "public", { from: "a", to: "b" });

      await prisma.user.delete({ where: { id: editor } });
      ids.splice(ids.indexOf(editor), 1);

      const rows = await prisma.locationAuditEntry.findMany({ where: { siteId: site.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].actorId).toBeNull();

      const roster = await contributors.contributorsForSite(site.id);
      expect(roster).toHaveLength(0);
    });
  });

  describe("PR2: community edit-control", () => {
    it("requires the caller to be ONBOARDED (a real Profile), not merely a User row", async () => {
      const owner = await createPilot("onb1");
      const site = await createSite({ lat: -154.0, lon: -154.0, visibility: "public", ownerId: owner });

      const bareUser = await prisma.user.create({ data: { email: `bare${suffix}@test.local` } });
      ids.push(bareUser.id);

      await expect(associate.renameSite(site.id, bareUser.id, "Hijacked", "hijacked")).rejects.toThrow(
        /permission to edit it/i,
      );
    });

    it("a non-owner's real community edit blocks the creator's own delete/unpublish — hasCommunityFootprint", async () => {
      const owner = await createPilot("fp1");
      const editor = await createPilot("fp2");
      const site = await createSite({ lat: -154.1, lon: -154.1, visibility: "public", ownerId: owner });

      await associate.renameSite(site.id, editor, "Edited by someone else", "edited by someone else");

      await expect(associate.deleteSite(site.id, owner)).rejects.toThrow(/other pilots have contributed/i);
      await expect(associate.unpublishOwnSite(site.id, owner)).rejects.toThrow(/other pilots have contributed/i);
    });

    it("an endorsement with NO edit behind it does NOT block the creator's delete — decision 3", async () => {
      const owner = await createPilot("fp3");
      const voter = await createPilot("fp4");
      const site = await createSite({ lat: -154.2, lon: -154.2, visibility: "public", ownerId: owner });

      await endorsements.toggleSiteEndorsement(site.id, voter);
      await expect(associate.deleteSite(site.id, owner)).resolves.not.toThrow();
    });

    it("the creator can still delete/demote a public row nobody else has touched", async () => {
      const owner = await createPilot("fp5");
      const site = await createSite({ lat: -154.3, lon: -154.3, visibility: "public", ownerId: owner });
      await expect(associate.unpublishOwnSite(site.id, owner)).resolves.not.toThrow();
    });

    it("the daily community-edit cap counts renames AND boundary edits together, not per-action-type", async () => {
      // A genuinely valid lat/lon band — unlike this file's usual -15x.x
      // convention, setSiteBoundary's real geographic-range check requires
      // it. Disjoint from every other integration test file's 46.x usage.
      const owner = await createPilot("cap1");
      const editor = await createPilot("cap2");
      const sites = await Promise.all(
        Array.from({ length: associate.DAILY_COMMUNITY_EDIT_CAP }, (_, i) =>
          createSite({ lat: 46.0 + i * 0.001, lon: 46.0 + i * 0.001, visibility: "public", ownerId: owner }),
        ),
      );
      // Half by rename, half by boundary — a single shared counter, not two
      // independent per-type budgets a vandal could double up on.
      const half = Math.floor(sites.length / 2);
      for (const site of sites.slice(0, half)) {
        await associate.renameSite(site.id, editor, `Renamed ${site.id}`, `renamed ${site.id}`);
      }
      for (const site of sites.slice(half)) {
        await associate.setSiteBoundary(site.id, editor, squarePolygon(site.lat, site.lon, 50));
      }

      const overCapSite = await createSite({ lat: 46.05, lon: 46.05, visibility: "public", ownerId: owner });
      await expect(associate.renameSite(overCapSite.id, editor, "One too many", "one too many")).rejects.toThrow(
        /daily community-edit limit/i,
      );
    });

    it("publishing a private site writes exactly one `published` audit entry with no reference to the prior name", async () => {
      const owner = await createPilot("pub1");
      const site = await createSite({ lat: -154.4, lon: -154.4, visibility: "private", ownerId: owner });
      await associate.setSiteVisibility(site.id, owner, "public");

      const rows = await prisma.locationAuditEntry.findMany({ where: { siteId: site.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].action).toBe("published");
      const roster = await contributors.contributorsForSite(site.id);
      expect(roster.map((r) => r.profileId)).toEqual([owner]);
    });

    it("an onboarded stranger renaming a public zone is attributed correctly, and the parent-site conjunction still gates it", async () => {
      const siteOwner = await createPilot("zc1");
      const zoneOwner = await createPilot("zc2");
      const stranger = await createPilot("zc3");
      const publicSite = await createSite({ lat: -154.5, lon: -154.5, visibility: "public", ownerId: siteOwner });
      const publicZone = await createZone({ siteId: publicSite.id, lat: -154.5, lon: -154.5, visibility: "public", ownerId: zoneOwner });

      const renamed = await associate.renameZone(publicZone.id, stranger, "Stranger's rename", "strangers rename");
      expect(renamed.name).toBe("Stranger's rename");
      const roster = await contributors.contributorsForZone(publicZone.id);
      expect(roster.map((r) => r.profileId)).toContain(stranger);

      const privateSite = await createSite({ lat: -154.6, lon: -154.6, visibility: "private", ownerId: siteOwner });
      const zoneUnderPrivateSite = await createZone({
        siteId: privateSite.id,
        lat: -154.6,
        lon: -154.6,
        visibility: "public",
        ownerId: zoneOwner,
      });
      await expect(
        associate.renameZone(zoneUnderPrivateSite.id, stranger, "Should fail", "should fail"),
      ).rejects.toThrow(/permission to edit it/i);
    });
  });
});
