// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { changeSiteAdmin, isMainAdmin, isSiteAdmin, listSiteAdmins, searchAdminUsers } from "@/lib/admin";
import { deleteSite, previewSiteDeletion } from "@/lib/sites/associate";
import { listManagedSites } from "@/lib/sites/manage";
import { saveSiteDraft } from "@/lib/sites/editor";
import { getCurrentUserId } from "@/lib/profile";
import { changeSiteAdminAction, searchAdminUsersAction } from "@/app/admin/actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: vi.fn() }));

describe("site administration", () => {
  let main: string, delegate: string, owner: string;
  const users: string[] = [], sites: string[] = [];
  beforeAll(async () => {
    for (const label of ["main", "delegate", "owner"]) {
      const handle = `admin${label}${Date.now()}`.slice(0, 20);
      const user = await prisma.user.create({ data: {
        email: label === "main" ? "leafvario@gmail.com" : `${handle}@test.local`, emailVerified: new Date(),
        profile: { create: { handle, displayName: `Admin test ${label}` } },
      } });
      users.push(user.id);
    }
    [main, delegate, owner] = users;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.flight.deleteMany({ where: { ownerId: { in: users } } });
    await prisma.site.deleteMany({ where: { id: { in: sites } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  async function site(visibility = "public") {
    const row = await prisma.site.create({ data: { ownerId: owner, name: "Admin ridge", normalizedName: "admin ridge", kind: "both", visibility, lat: 45, lon: 6 } });
    sites.push(row.id); return row;
  }

  it("requires verified production identity and ignores local overrides in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_MAIN_ADMIN_USER_ID", delegate);
    expect(await isMainAdmin(delegate)).toBe(false);
    expect(await isMainAdmin(main)).toBe(true);
    await prisma.user.update({ where: { id: main }, data: { emailVerified: null } });
    expect(await isMainAdmin(main)).toBe(false);
    await prisma.user.update({ where: { id: main }, data: { emailVerified: new Date() } });
    vi.unstubAllEnvs();
  });

  it("pins local admin access to the configured ID, not a handle", async () => {
    vi.stubEnv("LOCAL_MAIN_ADMIN_USER_ID", delegate);
    expect(await isMainAdmin(delegate)).toBe(true);
    expect(await isMainAdmin(owner)).toBe(false);
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@example.com/database");
    expect(await isMainAdmin(delegate)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("only lets the main admin search, grant, revoke, restore and remove grants", async () => {
    for (const actor of [null, owner, delegate]) {
      await expect(searchAdminUsers(actor, "Admin test")).rejects.toThrow(/main admin/);
      await expect(listSiteAdmins(actor)).rejects.toThrow(/main admin/);
      await expect(changeSiteAdmin(actor, delegate, "grant")).rejects.toThrow(/main admin/);
    }
    expect(await searchAdminUsers(main, "Admin test")).toHaveLength(3);
    expect(await searchAdminUsers(main, "a")).toEqual([]);
    await expect(changeSiteAdmin(main, main, "revoke")).rejects.toThrow(/cannot be changed/);
    await changeSiteAdmin(main, delegate, "grant");
    expect(await isSiteAdmin(delegate)).toBe(true);
    for (const operation of ["grant", "revoke", "delete"] as const) {
      vi.mocked(getCurrentUserId).mockResolvedValue(delegate);
      expect(await changeSiteAdminAction(owner, operation)).toMatchObject({ ok: false });
    }
    expect(await searchAdminUsersAction("Admin test")).toMatchObject({ ok: false });
    await expect(changeSiteAdmin(main, delegate, "delete")).rejects.toThrow(/Revoke/);
    await changeSiteAdmin(main, delegate, "revoke");
    expect(await isSiteAdmin(delegate)).toBe(false);
    expect(await listSiteAdmins(main)).toEqual([expect.objectContaining({ userId: delegate, revokedAt: expect.any(Date) })]);
    await changeSiteAdmin(main, delegate, "grant");
    expect(await isSiteAdmin(delegate)).toBe(true);
    await changeSiteAdmin(main, delegate, "revoke");
    await changeSiteAdmin(main, delegate, "delete");
    expect(await listSiteAdmins(main)).toEqual([]);
    expect(await prisma.user.findUnique({ where: { id: delegate } })).not.toBeNull();
  });

  it("allows editing/deleting other pilots' public sites while preserving flights and private-site protection", async () => {
    const publicSite = await site(), privateSite = await site("private");
    await changeSiteAdmin(main, delegate, "grant");
    const changed = await prisma.$transaction(tx => saveSiteDraft(tx, delegate, {
      id: publicSite.id, expectedUpdatedAt: publicSite.updatedAt.toISOString(), name: "Renamed by admin", kind: "both", visibility: "public", lat: 45, lon: 6, boundary: null,
    }));
    expect(changed.ownerId).toBe(owner);
    const zone = await prisma.zone.create({ data: { siteId: publicSite.id, ownerId: owner, name: "Launch", normalizedName: "launch", kind: "takeoff", visibility: "public", lat: 45, lon: 6 } });
    const flight = await prisma.flight.create({ data: { ownerId: owner, takeoffSiteId: publicSite.id, takeoffSiteName: changed.name, takeoffZoneId: zone.id, takeoffZoneName: zone.name, takeoffLat: 45, takeoffLon: 6 } });
    expect((await listManagedSites(delegate, true)).find(row => row.id === publicSite.id)?.canDelete).toBe(true);
    expect((await listManagedSites(delegate, true)).find(row => row.id === privateSite.id)).toBeUndefined();
    await expect(deleteSite(privateSite.id, delegate)).rejects.toThrow();
    await expect(previewSiteDeletion(privateSite.id, main)).rejects.toThrow();
    const preview = await previewSiteDeletion(publicSite.id, delegate);
    expect(preview).toMatchObject({ flightCount: 1, zoneCount: 1, affectsOtherPilots: true });
    await changeSiteAdmin(main, delegate, "revoke");
    await expect(deleteSite(publicSite.id, delegate, preview.revision)).rejects.toThrow();
    expect((await listManagedSites(delegate, true)).find(row => row.id === publicSite.id)?.canDelete).toBe(false);
    await changeSiteAdmin(main, delegate, "grant");
    await deleteSite(publicSite.id, delegate, preview.revision);
    expect(await prisma.flight.findUnique({ where: { id: flight.id } })).toMatchObject({ ownerId: owner, takeoffSiteId: null, takeoffZoneId: null, takeoffSiteName: changed.name, takeoffLat: 45, takeoffLon: 6, takeoffSiteAssignment: "custom_name" });
    expect(await prisma.site.findUnique({ where: { id: publicSite.id } })).toBeNull();
    expect(await prisma.zone.findUnique({ where: { id: zone.id } })).toBeNull();
  });

  it("gives the main admin site access without a grant and refuses a stale deletion preview", async () => {
    const row = await site();
    const preview = await previewSiteDeletion(row.id, main);
    await prisma.flight.create({ data: { ownerId: owner, takeoffSiteId: row.id, takeoffSiteName: row.name } });
    await expect(deleteSite(row.id, main, preview.revision)).rejects.toThrow(/changed/);
    await deleteSite(row.id, main, (await previewSiteDeletion(row.id, main)).revision);
  });
});
