// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/profile";
import { getSiteEditorAction, saveSiteEditorAction } from "@/app/settings/sites/editor-actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: vi.fn() }));

const owners: string[] = [];
async function saveSite(value: Parameters<typeof saveSiteEditorAction>[0]) {
  const result = await saveSiteEditorAction(value);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
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
  const site = await saveSite(request);
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
  expect(await saveSiteEditorAction(request)).toMatchObject({ ok: false, error: expect.stringMatching(/location changed/) });
  expect(await prisma.site.count({ where: { ownerId: flight.ownerId } })).toBe(0);
});

it("rejects another site's selection without replacing it", async () => {
  const { flight, request } = await openEditor();
  const other = await saveSite({ draft: { ...request.draft, name: "Other Ridge" } });
  await prisma.flight.update({ where: { id: flight.id }, data: { takeoffSiteId: other.id } });
  expect(await saveSiteEditorAction(request)).toMatchObject({ ok: false, error: expect.stringMatching(/location changed/) });
  expect(await prisma.site.count({ where: { ownerId: flight.ownerId } })).toBe(1);
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).takeoffSiteId).toBe(other.id);
});

it("requires the original endpoint revision and still rejects concurrent site edits", async () => {
  const { flight, request } = await openEditor();
  expect(await saveSiteEditorAction({ ...request, expectedFlightRevision: undefined })).toMatchObject({ ok: false, error: expect.stringMatching(/location changed/) });
  const site = await saveSite(request);
  const context = { flightId: flight.id, endpoint: "takeoff" as const };
  const editor = await getSiteEditorAction(context);
  await prisma.site.update({ where: { id: site.id }, data: { name: "Changed elsewhere", updatedAt: new Date(Date.now() + 1000) } });
  expect(await saveSiteEditorAction({ context, draft: { ...editor.initial, name: "Stale rename" },
    expectedFlightRevision: editor.expectedFlightRevision })).toMatchObject({ ok: false, error: expect.stringMatching(/site changed/) });
  expect((await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).name).toBe("Changed elsewhere");
});

it("allows an existing site to widen its use when a nearby site has the same name", async () => {
  const { flight, request } = await openEditor();
  const first = await saveSite({ ...request, draft: { ...request.draft, kind: "takeoff" } });
  const second = await saveSite({ draft: { ...request.draft, id: undefined, expectedUpdatedAt: undefined,
    kind: "landing", lat: 37.0001, name: "Quiet Ridge" } });
  const editor = await getSiteEditorAction({ siteId: first.id });
  const updated = await saveSiteEditorAction({ draft: { ...editor.initial, kind: "both" }, context: { siteId: first.id } });
  expect(updated).toMatchObject({ ok: true, value: { id: first.id } });
  expect((await prisma.site.findUniqueOrThrow({ where: { id: first.id } })).kind).toBe("both");
  expect((await prisma.site.findUniqueOrThrow({ where: { id: second.id } })).kind).toBe("landing");
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } })).takeoffSiteId).toBe(first.id);

  const duplicate = await saveSiteEditorAction({ draft: { ...request.draft, kind: "both" } });
  expect(duplicate).toMatchObject({ ok: false, error: expect.stringMatching(/already has a nearby map pin/) });
});
