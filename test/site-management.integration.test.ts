// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listManagedSites, listFlightsAtSite, previewFlightsForSite, assignFlightsToSite } from "@/lib/sites/manage";
import { listSiteFlightsAction } from "@/app/settings/sites/actions";
import { getCurrentUserId } from "@/lib/profile";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: vi.fn() }));

describe("site flight management", () => {
  let owner: string;
  let other: string;
  const userIds: string[] = [];
  const siteIds: string[] = [];
  beforeAll(async () => {
    for (const label of ["owner", "other"]) {
      const handle = `sm${label}${Date.now()}`.slice(0, 20);
      const user = await prisma.user.create({ data: { email: `${handle}@test.local`, profile: { create: { handle, displayName: label } } } });
      userIds.push(user.id);
    }
    [owner, other] = userIds;
  });
  beforeEach(() => { vi.mocked(getCurrentUserId).mockResolvedValue(owner); });
  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function site(data: Partial<Prisma.SiteUncheckedCreateInput> = {}) {
    const row = await prisma.site.create({ data: { ownerId: owner, name: "Same Ridge", normalizedName: "same ridge", visibility: "private", kind: "both", lat: 37, lon: -122, ...data } });
    siteIds.push(row.id);
    return row;
  }
  const flight = (data: Partial<Prisma.FlightUncheckedCreateInput> = {}) => prisma.flight.create({ data: {
    ownerId: owner, status: "ready", source: "csv_import", recordingKind: "logbook", flightDate: new Date("2026-07-11"),
    takeoffLat: 37, takeoffLon: -122, landingLat: 37, landingLon: -122, ...data,
  } });

  it("counts and lists a flight once per linked site, independent of coordinates, names, and other pilots", async () => {
    const a = await site();
    const b = await site();
    const both = await flight({ takeoffSiteId: a.id, landingSiteId: a.id, takeoffLat: null, takeoffLon: null });
    const split = await flight({ takeoffSiteId: a.id, landingSiteId: b.id, takeoffLat: 0, takeoffLon: 0, flightDate: new Date("2026-07-10") });
    const landing = await flight({ landingSiteId: a.id, flightDate: new Date("2026-07-09") });
    await flight({ takeoffSiteName: a.name, takeoffSiteAssignment: "custom_name" });
    await flight({ ownerId: other, takeoffSiteId: a.id });
    const managed = await listManagedSites(owner);
    expect(managed.find(row => row.id === a.id)?.ownFlightCount).toBe(3);
    expect(managed.find(row => row.id === b.id)?.ownFlightCount).toBe(1);
    const list = await listFlightsAtSite(owner, a.id);
    expect(list.total).toBe(3);
    expect(list.flights.map(row => row.id)).toEqual([both.id, split.id, landing.id]);
    expect(list.flights.map(row => row.endpoints)).toEqual([["takeoff", "landing"], ["takeoff"], ["landing"]]);
  });

  it("paginates the complete list without repeating flights and handles empty sites", async () => {
    const a = await site();
    expect(await listFlightsAtSite(owner, a.id)).toMatchObject({ total: 0, flights: [], page: 1, pageCount: 1 });
    await prisma.flight.createMany({ data: Array.from({ length: 53 }, (_, i) => ({
      ownerId: owner, status: "ready", source: "manual_entry", recordingKind: "logbook",
      takeoffSiteId: a.id, landingSiteId: a.id, flightDate: i === 0 ? null : new Date("2026-07-11"),
    })) });
    const first = await listFlightsAtSite(owner, a.id);
    const second = await listFlightsAtSite(owner, a.id, 2);
    expect(first).toMatchObject({ total: 53, page: 1, pageCount: 2 });
    expect(first.flights).toHaveLength(50);
    expect(second.flights).toHaveLength(3);
    expect(second.flights.at(-1)?.date).toBeNull();
    expect(new Set([...first.flights, ...second.flights].map(row => row.id)).size).toBe(53);
  });

  it("requires ownership and a signed-in session for the linked flight list", async () => {
    const a = await site({ visibility: "public" });
    await flight({ takeoffSiteId: a.id });
    for (const caller of [other, null]) {
      vi.mocked(getCurrentUserId).mockResolvedValue(caller);
      expect(await listSiteFlightsAction(a.id)).toMatchObject({ ok: false });
    }
    await expect(listFlightsAtSite(owner, "missing-site")).rejects.toThrow();
    await expect(listFlightsAtSite(owner, a.id, -1)).rejects.toThrow(/valid page/);
  });

  it("separates matching names from links, resolves live private names, and excludes every already-linked flight", async () => {
    const a = await site();
    const b = await site();
    const hidden = await site({ ownerId: other, name: "Private other site" });
    const already = await flight({ takeoffSiteId: a.id });
    const landed = await flight({ landingSiteId: a.id });
    const named = await flight({ takeoffSiteName: a.name, takeoffSiteAssignment: "custom_name", landingLat: null, landingLon: null });
    const different = await flight({ takeoffSiteId: b.id, takeoffSiteName: null, landingLat: null, landingLon: null });
    const unavailable = await flight({ takeoffSiteId: hidden.id, takeoffSiteName: "Stale hidden name", landingLat: null, landingLon: null });
    const noCoords = await flight({ takeoffSiteName: a.name, takeoffLat: null, takeoffLon: null, landingLat: null, landingLon: null });
    const stranger = await flight({ ownerId: other });
    const candidates = await previewFlightsForSite(owner, a.id);
    expect(candidates.find(row => row.id === named.id)).toMatchObject({ currentSiteId: null, currentSiteName: a.name, currentSiteState: "name_only", source: "csv_import" });
    expect(candidates.find(row => row.id === different.id)).toMatchObject({ currentSiteId: b.id, currentSiteName: b.name, currentSiteState: "linked" });
    expect(candidates.find(row => row.id === unavailable.id)).toMatchObject({ currentSiteId: null, currentSiteName: null, currentSiteState: "unavailable" });
    for (const id of [already.id, landed.id, noCoords.id, stranger.id]) expect(candidates.some(row => row.id === id)).toBe(false);
  });

  it("does not let already-linked flights crowd unlinked matches out of review", async () => {
    const a = await site();
    await prisma.flight.createMany({ data: Array.from({ length: 205 }, () => ({
      ownerId: owner, status: "ready", takeoffSiteId: a.id, flightDate: new Date("2026-09-01"), takeoffLat: 37, takeoffLon: -122,
    })) });
    const match = await flight({ flightDate: new Date("2012-02-11"), landingLat: null, landingLon: null });
    expect((await previewFlightsForSite(owner, a.id)).some(row => row.id === match.id)).toBe(true);
  });

  it("counts an assignment once per flight and only changes the selected endpoints on owned flights", async () => {
    const a = await site();
    const both = await flight({ takeoffSiteName: a.name, landingSiteName: a.name, notes: "Memory", durationS: 900 });
    const takeoff = await flight({ landingSiteName: "Keep this name" });
    const stranger = await flight({ ownerId: other });
    const updated = await assignFlightsToSite(owner, a.id, [
      { id: both.id, endpoint: "takeoff" }, { id: both.id, endpoint: "landing" }, { id: both.id, endpoint: "landing" },
      { id: takeoff.id, endpoint: "takeoff" }, { id: stranger.id, endpoint: "takeoff" },
    ]);
    expect(updated).toBe(2);
    expect(await prisma.flight.findUniqueOrThrow({ where: { id: both.id } })).toMatchObject({
      takeoffSiteId: a.id, landingSiteId: a.id, notes: "Memory", durationS: 900,
      takeoffLat: 37, takeoffLon: -122, landingLat: 37, landingLon: -122, source: "csv_import",
    });
    expect(await prisma.flight.findUniqueOrThrow({ where: { id: takeoff.id } })).toMatchObject({ takeoffSiteId: a.id, landingSiteId: null, landingSiteName: "Keep this name" });
    expect(await prisma.flight.findUniqueOrThrow({ where: { id: stranger.id } })).toMatchObject({ takeoffSiteId: null });
    expect((await listManagedSites(owner)).find(row => row.id === a.id)?.ownFlightCount).toBe(2);
    expect((await listFlightsAtSite(owner, a.id)).total).toBe(2);
    expect((await previewFlightsForSite(owner, a.id)).some(row => row.id === both.id || row.id === takeoff.id)).toBe(false);
  });
});
