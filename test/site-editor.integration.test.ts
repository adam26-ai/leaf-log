// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import { getSiteEditorAction, saveSiteEditorAction } from "@/app/settings/sites/editor-actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: vi.fn() }));

const owners: string[] = [];
async function openEditor() {
  const handle = `se${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const owner = await prisma.user.create({ data: { email: `${handle}@test.local`,
    profile: { create: { handle, displayName: "Site editor tests" } } } });
  owners.push(owner.id);
  vi.mocked(getCurrentUserId).mockResolvedValue(owner.id);
  const flight = await prisma.flight.create({ data: { ownerId: owner.id, status: "ready", recordingKind: "igc",
    takeoffLat: 37, takeoffLon: -122, xcStatus: "queued" } });
  const context = { flightId: flight.id, endpoint: "takeoff" as const, create: true };
  const editor = await getSiteEditorAction(context);
  const request = { context, draft: { ...editor.initial, name: "Quiet Ridge" }, expectedFlightRevision: editor.expectedFlightRevision };
  return { flight, request };
}

afterAll(async () => {
  await prisma.flight.deleteMany({ where: { ownerId: { in: owners } } });
  await prisma.site.deleteMany({ where: { ownerId: { in: owners } } });
  await prisma.user.deleteMany({ where: { id: { in: owners } } });
  await prisma.$disconnect();
});

it("saves a site after background scoring without overwriting analysis or unrelated flight edits", async () => {
  const { flight, request } = await openEditor();
  await prisma.flight.update({ where: { id: flight.id }, data: { xcStatus: "ready", xcScore: { complete: true },
    notes: "Keep this note", updatedAt: new Date(flight.updatedAt.getTime() + 1000) } });
  const site = await saveSiteEditorAction(request);
  expect(await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).toMatchObject({
    takeoffSiteId: site.id, takeoffSiteAssignment: "user_selected", takeoffLat: 37, takeoffLon: -122,
    xcStatus: "ready", xcScore: { complete: true }, notes: "Keep this note",
  });
});

it.each([
  { takeoffLat: 38 },
  { takeoffSiteAssignment: "cleared" },
  { takeoffSiteName: "A different place" },
])("rejects changed endpoint data atomically: %j", async change => {
  const { flight, request } = await openEditor();
  await prisma.flight.update({ where: { id: flight.id }, data: change });
  await expect(saveSiteEditorAction(request)).rejects.toThrow(/location changed/);
  expect(await prisma.site.count({ where: { ownerId: flight.ownerId } })).toBe(0);
});

it("rejects another site's selection without replacing it", async () => {
  const { flight, request } = await openEditor();
  const other = await saveSiteEditorAction({ draft: { ...request.draft, name: "Other Ridge" } });
  await prisma.flight.update({ where: { id: flight.id }, data: { takeoffSiteId: other.id } });
  await expect(saveSiteEditorAction(request)).rejects.toThrow(/location changed/);
  expect(await prisma.site.count({ where: { ownerId: flight.ownerId } })).toBe(1);
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).takeoffSiteId).toBe(other.id);
});

it("requires the original endpoint revision and still rejects concurrent site edits", async () => {
  const { flight, request } = await openEditor();
  await expect(saveSiteEditorAction({ ...request, expectedFlightRevision: undefined })).rejects.toThrow(/location changed/);
  const site = await saveSiteEditorAction(request);
  const context = { flightId: flight.id, endpoint: "takeoff" as const };
  const editor = await getSiteEditorAction(context);
  await prisma.site.update({ where: { id: site.id }, data: { name: "Changed elsewhere", updatedAt: new Date(Date.now() + 1000) } });
  await expect(saveSiteEditorAction({ context, draft: { ...editor.initial, name: "Stale rename" },
    expectedFlightRevision: editor.expectedFlightRevision })).rejects.toThrow(/site changed/);
  expect((await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).name).toBe("Changed elsewhere");
});
