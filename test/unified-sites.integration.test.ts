// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { emptyEntry } from "@/lib/logbook/entry";
import { flightToEntryDraft } from "@/lib/logbook/flight-draft";
import { saveLogbookEntry, previewLogbookImport, commitLogbookImport, undoLogbookImport } from "@/lib/logbook/service";
import { CSV_DEFAULTS, csvEntries, guessColumns, parseCsv } from "@/lib/logbook/csv";
import { saveSiteDraft } from "@/lib/sites/editor";
import { newSiteDraft } from "@/lib/sites/model";
import { getFlightForViewer } from "@/lib/flights/repo";
import { previewSiteMigration, applySiteMigration } from "@/lib/sites/migrate";

const owners: string[] = [];
async function pilot() {
  const handle = `us${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const user = await prisma.user.create({ data: { email: `${handle}@test.local`, profile: { create: { handle, displayName: "Site tests" } } } });
  owners.push(user.id); return user.id;
}
afterAll(async () => {
  await prisma.flight.deleteMany({ where: { ownerId: { in: owners } } });
  await prisma.site.deleteMany({ where: { ownerId: { in: owners } } });
  await prisma.user.deleteMany({ where: { id: { in: owners } } });
  await prisma.$disconnect();
});
const entry = (patch = {}) => ({ requestId: randomUUID(), visibility: "private", allowDuplicate: true, draft: { ...emptyEntry(), date: "2000-01-01", ...patch } });
async function flight(owner: string, patch = {}) {
  const result = await saveLogbookEntry(owner, entry(patch));
  if (!("id" in result)) throw new Error("Unexpected duplicate");
  return prisma.flight.findUniqueOrThrow({ where: result });
}
function imported(csv: string) {
  const table = parseCsv(csv);
  return { requestId: randomUUID(), filename: "sites.csv", csv, visibility: "private", rows: csvEntries(table, guessColumns(table.headers), CSV_DEFAULTS) };
}

it("saves name-only entries as reusable private sites and adds a pin to the same site", async () => {
  const owner = await pilot();
  const first = await flight(owner, { takeoffSiteName: "Quiet Ridge" });
  const second = await flight(owner, { takeoffSiteName: "Quiet Ridge" });
  expect(first.takeoffSiteId).toBeTruthy(); expect(second.takeoffSiteId).toBe(first.takeoffSiteId);
  const site = await prisma.site.findUniqueOrThrow({ where: { id: first.takeoffSiteId! } });
  expect(site).toMatchObject({ lat: null, lon: null, visibility: "private" });
  await prisma.$transaction(tx => saveSiteDraft(tx, owner, { ...newSiteDraft(site.name, "takeoff", { lat: 30, lon: 20 }), id: site.id, expectedUpdatedAt: site.updatedAt.toISOString() }));
  expect(await getFlightForViewer(first.id, owner)).toMatchObject({ takeoffSiteId: site.id, takeoffSiteMapped: true, takeoffSiteLat: 30, takeoffLat: null });
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: second.id } })).takeoffSiteId).toBe(site.id);
});

it("matches a name-only CSV location to one exact public site", async () => {
  const curator = await pilot(), owner = await pilot();
  const publicSite = await prisma.$transaction(tx => saveSiteDraft(tx, curator, { ...newSiteDraft("Public Ridge", "takeoff", { lat: 30, lon: 20 }), visibility: "public" }));
  const request = imported("date,site\n2000-01-02,Public Ridge");
  const preview = await previewLogbookImport(owner, request);
  expect(preview.sites).toEqual([]);
  expect(preview.rows[0].warnings).toContain("Use Public Ridge");
  const batch = await commitLogbookImport(owner, { ...request, sitePlanSignature: preview.sitePlanSignature });
  expect(await prisma.flight.findFirstOrThrow({ where: { logbookImportId: batch.id } })).toMatchObject({ takeoffSiteId: publicSite.id, takeoffSiteAssignment: "auto_matched", takeoffSiteName: "Public Ridge" });
  expect(await prisma.site.count({ where: { ownerId: owner } })).toBe(0);
});

it("stages site edits atomically with a flight edit and rejects stale drafts", async () => {
  const owner = await pilot(); const original = await flight(owner, { takeoffSiteName: "Old Ridge" });
  const site = await prisma.site.findUniqueOrThrow({ where: { id: original.takeoffSiteId! } });
  const siteDraft = { ...newSiteDraft("Renamed Ridge", "both", { lat: 31, lon: 21 }), id: site.id, expectedUpdatedAt: site.updatedAt.toISOString() };
  const request = { ...entry(), flightId: original.id, expectedUpdatedAt: original.updatedAt.toISOString(), draft: { ...flightToEntryDraft(original), takeoffSiteDraft: JSON.stringify(siteDraft) } };
  await saveLogbookEntry(owner, request);
  expect(await getFlightForViewer(original.id, owner)).toMatchObject({ takeoffSiteName: "Renamed Ridge", takeoffLat: null });
  await expect(prisma.$transaction(tx => saveSiteDraft(tx, owner, siteDraft))).rejects.toThrow(/changed/);
  const changed = await prisma.site.findUniqueOrThrow({ where: { id: site.id } });
  await expect(prisma.$transaction(tx => saveSiteDraft(tx, owner, { ...siteDraft, expectedUpdatedAt: changed.updatedAt.toISOString(), name: "Should roll back", lat: null, lon: 21 }))).rejects.toThrow(/both/);
  expect((await prisma.site.findUniqueOrThrow({ where: { id: site.id } })).name).toBe("Renamed Ridge");
});

it("previews CSV sites without writes, groups nearby rows, and removes unused sites on undo", async () => {
  const owner = await pilot();
  const request = imported("date,site,takeoff_lat,takeoff_lon\n2000-02-01,CSV Ridge,32,22\n2000-02-02,CSV Ridge,32.0001,22\n2000-02-03,CSV Ridge,35,25\n2000-02-04,CSV Ridge,,");
  const preview = await previewLogbookImport(owner, request);
  expect(preview.sites).toHaveLength(3);
  expect(await prisma.site.count({ where: { ownerId: owner } })).toBe(0);
  const batch = await commitLogbookImport(owner, { ...request, sitePlanSignature: preview.sitePlanSignature });
  const sites = await prisma.site.findMany({ where: { ownerId: owner } });
  expect(sites).toHaveLength(3); expect(sites.every(site => site.visibility === "private")).toBe(true);
  expect(await prisma.locationAuditEntry.count({ where: { actorId: owner } })).toBe(0);
  const rows = await prisma.flight.findMany({ where: { logbookImportId: batch.id }, orderBy: { importRow: "asc" } });
  expect(rows[0].takeoffSiteId).toBe(rows[1].takeoffSiteId);
  expect(rows[1]).toMatchObject({ takeoffLat: 32.0001, takeoffLocationSource: "csv", takeoffLocationEvidence: { lat: 32.0001, name: "CSV Ridge" } });
  expect(await undoLogbookImport(owner, batch.id)).toMatchObject({ removed: 4, removedSites: 3 });
  expect(await prisma.site.count({ where: { ownerId: owner } })).toBe(0);
});

it("keeps edited or reused auto-created sites when an import is undone", async () => {
  const owner = await pilot(); const request = imported("date,site,takeoff_lat,takeoff_lon\n2000-03-01,Keep Ridge,36,26");
  const batch = await commitLogbookImport(owner, request);
  const site = await prisma.site.findFirstOrThrow({ where: { ownerId: owner } });
  await flight(owner, { takeoffSiteId: site.id });
  expect(await undoLogbookImport(owner, batch.id)).toMatchObject({ removed: 1, removedSites: 0 });
  expect(await prisma.site.findUnique({ where: { id: site.id } })).not.toBeNull();
});

it("separates CSV site-reference coordinates from recorded flight positions", async () => {
  const owner = await pilot(); const request = imported("date,site,takeoff_lat,takeoff_lon\n2000-04-01,Reference Ridge,37,27");
  request.rows[0].draft.takeoffCoordinateMeaning = "site";
  const batch = await commitLogbookImport(owner, request);
  const saved = await prisma.flight.findFirstOrThrow({ where: { logbookImportId: batch.id } });
  expect(saved).toMatchObject({ takeoffLat: null, takeoffLon: null, takeoffLocationSource: "site_reference", takeoffLocationEvidence: { lat: 37, meaning: "site" } });
  expect(await getFlightForViewer(saved.id, owner)).toMatchObject({ takeoffSiteLat: 37, takeoffSiteLon: 27 });
});

it("enriches an explicitly selected unmapped site from imported GPS", async () => {
  const owner = await pilot(); const initial = await flight(owner, { takeoffSiteName: "Enriched Ridge" });
  const request = imported("date,site,takeoff_lat,takeoff_lon\n2000-05-01,Enriched Ridge,38,28");
  request.rows[0].draft.takeoffSiteId = initial.takeoffSiteId!;
  await commitLogbookImport(owner, request);
  expect(await prisma.site.findUniqueOrThrow({ where: { id: initial.takeoffSiteId! } })).toMatchObject({ lat: 38, lon: 28, pinSource: "csv", visibility: "private" });
  expect(await prisma.site.count({ where: { ownerId: owner } })).toBe(1);
});

it("preserves an unmapped site when existing flights disagree with new imported GPS", async () => {
  const owner = await pilot(); const initial = await flight(owner, { takeoffSiteName: "Uncertain Ridge" });
  await prisma.flight.update({ where: { id: initial.id }, data: { takeoffLat: 40, takeoffLon: 30 } });
  const request = imported("date,site,takeoff_lat,takeoff_lon\n2000-05-02,Uncertain Ridge,41,31");
  request.rows[0].draft.takeoffSiteId = initial.takeoffSiteId!;
  const preview = await previewLogbookImport(owner, request);
  const batch = await commitLogbookImport(owner, { ...request, sitePlanSignature: preview.sitePlanSignature });
  expect(await prisma.site.findUniqueOrThrow({ where: { id: initial.takeoffSiteId! } })).toMatchObject({ lat: null, lon: null, visibility: "private" });
  expect(await prisma.flight.findFirstOrThrow({ where: { logbookImportId: batch.id } })).toMatchObject({
    takeoffSiteId: initial.takeoffSiteId, takeoffSiteAssignment: "needs_review", takeoffLat: 41, takeoffLon: 31,
  });
  expect(await prisma.site.count({ where: { ownerId: owner } })).toBe(1);
});

it("rejects a changed import site plan without writing flights or sites", async () => {
  const owner = await pilot(); const first = await flight(owner, { takeoffSiteName: "Stable Ridge", takeoffLat: "39", takeoffLon: "29" });
  const request = imported("date,site,takeoff_lat,takeoff_lon\n2000-06-01,Stable Ridge,39,29");
  const preview = await previewLogbookImport(owner, request);
  await prisma.site.update({ where: { id: first.takeoffSiteId! }, data: { name: "Changed Ridge", normalizedName: "changed ridge" } });
  await expect(commitLogbookImport(owner, { ...request, sitePlanSignature: preview.sitePlanSignature })).rejects.toThrow(/preview again/);
  expect(await prisma.flight.count({ where: { ownerId: owner } })).toBe(1);
});

it("enforces private-site access, owner-only sharing, and a pin before publishing", async () => {
  const owner = await pilot(), other = await pilot(); const first = await flight(owner, { takeoffSiteName: "Private Ridge" });
  const site = await prisma.site.findUniqueOrThrow({ where: { id: first.takeoffSiteId! } });
  const draft = { ...newSiteDraft(site.name), id: site.id, expectedUpdatedAt: site.updatedAt.toISOString() };
  await expect(prisma.$transaction(tx => saveSiteDraft(tx, other, draft))).rejects.toThrow(/unavailable/);
  await expect(prisma.$transaction(tx => saveSiteDraft(tx, owner, { ...draft, visibility: "public" }))).rejects.toThrow(/map pin/);
  const shared = await prisma.$transaction(tx => saveSiteDraft(tx, owner, { ...draft, lat: 40, lon: 30, visibility: "public" }));
  await expect(prisma.$transaction(tx => saveSiteDraft(tx, other, { ...draft, lat: 40, lon: 30, expectedUpdatedAt: shared.updatedAt.toISOString() }))).rejects.toThrow(/Only the site owner/);
  await prisma.flight.update({ where: { id: first.id }, data: { visibility: "public" } });
  expect(await getFlightForViewer(first.id, other)).toMatchObject({ takeoffSiteName: "Private Ridge", takeoffLocationEvidence: null, takeoffLat: null });
});

it("previews historical conversion, preserves measurements and selections, and is resumable", async () => {
  const owner = await pilot();
  const mapped = await flight(owner, { takeoffSiteName: "Already mapped", takeoffLat: "41", takeoffLon: "31" });
  const legacy = await prisma.flight.create({ data: { ownerId: owner, recordingKind: "logbook", source: "csv_import", status: "ready", takeoffSiteName: "Old CSV Ridge", takeoffLat: 42, takeoffLon: 32, landingSiteName: "Old Landing" } });
  const cleared = await prisma.flight.create({ data: { ownerId: owner, takeoffSiteAssignment: "cleared", takeoffLat: 43, takeoffLon: 33 } });
  const preview = await previewSiteMigration(owner);
  expect(preview).toMatchObject({ endpoints: 2, mapped: 1, unmapped: 1 });
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: legacy.id } })).takeoffSiteId).toBeNull();
  expect(await applySiteMigration(owner, preview.signature)).toMatchObject({ converted: 2, createdSites: 2 });
  expect(await getFlightForViewer(legacy.id, owner)).toMatchObject({ takeoffSiteName: "Old CSV Ridge", takeoffSiteMapped: true, takeoffLat: 42, takeoffLon: 32, updatedAt: legacy.updatedAt });
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: mapped.id } })).takeoffSiteId).toBe(mapped.takeoffSiteId);
  expect((await prisma.flight.findUniqueOrThrow({ where: { id: cleared.id } })).takeoffSiteAssignment).toBe("cleared");
  expect(await previewSiteMigration(owner)).toMatchObject({ endpoints: 0 });
});
