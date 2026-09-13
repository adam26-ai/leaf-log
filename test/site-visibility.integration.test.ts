// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteVisibility } from "@/lib/sites/visibility";
import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/profile";
import { setSiteVisibilityAction } from "@/app/settings/sites/actions";
import { prisma } from "@/lib/prisma";
import { getFlightForViewer } from "@/lib/flights/repo";
import { listManagedSites } from "@/lib/sites/manage";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: vi.fn() }));

describe("settings site visibility", () => {
  let owner: string;
  let other: string;
  const userIds: string[] = [];
  const siteIds: string[] = [];

  beforeAll(async () => {
    for (const label of ["owner", "other"]) {
      const user = await prisma.user.create({
        data: {
          email: `site-visibility-${label}-${Date.now()}@test.local`,
          profile: { create: { handle: `sv${label}${Date.now()}`.slice(0, 20), displayName: label } },
        },
      });
      userIds.push(user.id);
    }
    [owner, other] = userIds;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUserId).mockResolvedValue(owner);
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function createSite(visibility: SiteVisibility, ownerId: string | null = owner) {
    const site = await prisma.site.create({
      data: {
        name: `Visibility Ridge ${siteIds.length}`,
        normalizedName: `visibility ridge ${siteIds.length}`,
        ownerId, visibility, lat: 42, lon: -120, kind: "both", source: "user",
      },
    });
    siteIds.push(site.id);
    return site;
  }

  it("switches both ways, updates both flight labels, and preserves ownership, coordinates, and assignments", async () => {
    const site = await createSite("private");
    const flight = await prisma.flight.create({
      data: {
        ownerId: owner, source: "manual_entry", status: "ready", visibility: "public",
        takeoffSiteId: site.id, landingSiteId: site.id,
        takeoffSiteAssignment: "user_selected", landingSiteAssignment: "user_selected",
        takeoffLat: 42.001, takeoffLon: -120.001, landingLat: 42.002, landingLon: -120.002,
      },
    });

    for (const visibility of ["public", "private", "public"] as const) {
      expect(await setSiteVisibilityAction({ siteId: site.id, visibility })).toEqual({ ok: true, value: undefined });
      expect(await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).toMatchObject({
        visibility, ownerId: owner, lat: site.lat, lon: site.lon, name: site.name,
      });
      expect(await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).toMatchObject({
        takeoffSiteId: site.id, landingSiteId: site.id,
        takeoffSiteName: visibility === "public" ? site.name : null,
        landingSiteName: visibility === "public" ? site.name : null,
        takeoffSiteAssignment: "user_selected", landingSiteAssignment: "user_selected",
        takeoffLat: flight.takeoffLat, takeoffLon: flight.takeoffLon,
        landingLat: flight.landingLat, landingLon: flight.landingLon,
        visibility: "public",
      });
      expect(await getFlightForViewer(flight.id, owner)).toMatchObject({ takeoffSiteName: site.name, landingSiteName: site.name });
      for (const viewer of [other, null]) {
        expect(await getFlightForViewer(flight.id, viewer)).toMatchObject({
          takeoffSiteName: visibility === "public" ? site.name : null,
          landingSiteName: visibility === "public" ? site.name : null,
        });
      }
      expect(await listManagedSites(owner)).toContainEqual(expect.objectContaining({ id: site.id, visibility, ownFlightCount: 2 }));
    }
    expect(revalidatePath).toHaveBeenCalledWith("/settings/sites");
    expect(revalidatePath).toHaveBeenCalledWith("/logbook");
    expect(revalidatePath).toHaveBeenCalledWith("/feed");
    expect(revalidatePath).toHaveBeenCalledWith("/flights/[id]", "page");
  });

  it.each(["public", "private"] as const)("rejects signed-out and non-owner requests to make a site %s", async (visibility) => {
    const site = await createSite(visibility === "public" ? "private" : "public");
    for (const caller of [null, other]) {
      vi.mocked(getCurrentUserId).mockResolvedValue(caller);
      expect(await setSiteVisibilityAction({ siteId: site.id, visibility })).toMatchObject({ ok: false });
      expect(await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).toMatchObject({ visibility: site.visibility });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects invalid visibility, a missing site ID, and an unowned site without changing data", async () => {
    const site = await createSite("public", null);
    for (const input of [
      { siteId: site.id, visibility: "friends" as SiteVisibility },
      { siteId: undefined as unknown as string, visibility: "private" as const },
      { siteId: "missing-site", visibility: "public" as const },
      { siteId: site.id, visibility: "private" as const },
    ]) {
      expect(await setSiteVisibilityAction(input)).toMatchObject({ ok: false });
    }
    expect(await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).toMatchObject({ visibility: "public" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["takeoff", "landing"] as const)("keeps a site public when another pilot uses it for %s", async (endpoint) => {
    const site = await createSite("public");
    const flight = await prisma.flight.create({
      data: {
        ownerId: other, source: "manual_entry", status: "ready",
        [`${endpoint}SiteId`]: site.id, [`${endpoint}SiteName`]: site.name,
      },
    });
    expect(await setSiteVisibilityAction({ siteId: site.id, visibility: "private" })).toMatchObject({
      ok: false, error: expect.stringMatching(/depends on this site/),
    });
    expect(await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).toMatchObject({ visibility: "public" });
    expect(await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).toMatchObject({ [`${endpoint}SiteName`]: site.name });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps a site public after another pilot has contributed an edit", async () => {
    const site = await createSite("public");
    await prisma.locationAuditEntry.create({ data: { siteId: site.id, actorId: other, action: "renamed", detail: {} } });
    expect(await setSiteVisibilityAction({ siteId: site.id, visibility: "private" })).toMatchObject({
      ok: false, error: expect.stringMatching(/contributed/),
    });
    expect(await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).toMatchObject({ visibility: "public" });
  });

  it("keeps a site public when another pilot owns a spot under it", async () => {
    const site = await createSite("public");
    await prisma.zone.create({
      data: { siteId: site.id, ownerId: other, name: "Other spot", normalizedName: "other spot", visibility: "public", kind: "takeoff", lat: site.lat, lon: site.lon },
    });
    expect(await setSiteVisibilityAction({ siteId: site.id, visibility: "private" })).toMatchObject({ ok: false });
    expect(await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).toMatchObject({ visibility: "public" });
  });
});
