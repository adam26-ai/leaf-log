// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { emptyEntry } from "@/lib/logbook/entry";
import { CSV_DEFAULTS, csvEntries, guessColumns, parseCsv } from "@/lib/logbook/csv";
import { saveLogbookEntry, previewLogbookImport, commitLogbookImport, undoLogbookImport } from "@/lib/logbook/service";
import { attachIgc } from "@/lib/logbook/attach-igc";
import { getFlightForViewer, listOwnFlights, statsFrom } from "@/lib/flights/repo";
import { makeRealisticFlight } from "./igc/make-igc";
import { flightToEntryDraft } from "@/lib/logbook/flight-draft";

const owners: string[] = [];
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const handle = `li${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const owner = await prisma.user.create({ data: { email: `${handle}@test.local`, profile: { create: { handle, displayName: "Import test" } } } });
    owners.push(owner.id);
  }
});
afterAll(async () => { await prisma.user.deleteMany({ where: { id: { in: owners } } }); await prisma.$disconnect(); });
const manual = (patch = {}) => ({ requestId: randomUUID(), visibility: "private", draft: { ...emptyEntry(), date: "2001-04-24", ...patch } });
const requestFor = (csv: string) => { const table = parseCsv(csv); return { requestId: randomUUID(), filename: "old-logbook.csv", csv, visibility: "private", rows: csvEntries(table, guessColumns(table.headers), CSV_DEFAULTS) }; };

it("creates an editable date-only flight, retries safely, and protects ownership and stale edits", async () => {
  const request = manual();
  const result = await saveLogbookEntry(owners[0], request);
  if (!("id" in result)) throw new Error("Unexpected duplicate");
  expect(await saveLogbookEntry(owners[0], request)).toEqual(result);
  const flight = await prisma.flight.findUniqueOrThrow({ where: result });
  expect(flight).toMatchObject({ recordingKind: "logbook", igcSha256: null, takeoffAt: null, durationS: null, xcStatus: "not_recorded" });
  expect(await prisma.flightData.findUnique({ where: { flightId: flight.id } })).toBeNull();
  expect(await getFlightForViewer(flight.id, owners[1])).toBeNull();
  const edit = { ...request, flightId: flight.id, expectedUpdatedAt: flight.updatedAt.toISOString(), draft: { ...flightToEntryDraft(flight), durationMinutes: "90", maxAltitude: "2500", notes: "Remembered details" } };
  await expect(saveLogbookEntry(owners[1], edit)).rejects.toMatchObject({ status: 404 });
  await saveLogbookEntry(owners[0], edit);
  await expect(saveLogbookEntry(owners[0], edit)).rejects.toMatchObject({ status: 409 });
  expect(await prisma.flight.findUniqueOrThrow({ where: result })).toMatchObject({ durationS: 5400, maxAltM: 2500, notes: "Remembered details" });
});

it("previews and imports atomically, detects CSV and existing duplicates, and prevents repeat imports", async () => {
  const request = requestFor("date,duration_minutes,wing,site,xc_distance,xc_type\n2002-05-01,60,Rush 4,Hill,30,open\n2002-05-01,60,Rush 4,Hill,30,open\ninvalid,90,Swift,Mountain,,\n2002-05-02,,Rush 4,Hill,,");
  const before = await prisma.flight.count({ where: { ownerId: owners[0] } });
  const preview = await previewLogbookImport(owners[0], request);
  expect(preview.rows[1].duplicates).toMatchObject([{ id: "row:2" }]);
  expect(preview.rows[2].errors.length).toBeGreaterThan(0);
  expect(preview.rows[3].warnings.join(" ")).toContain("Duration unknown");
  await expect(commitLogbookImport(owners[0], request)).rejects.toMatchObject({ status: 409 });
  expect(await prisma.flight.count({ where: { ownerId: owners[0] } })).toBe(before);
  request.rows[1].excluded = true; request.rows[2].excluded = true;
  const batch = await commitLogbookImport(owners[0], request);
  expect(batch).toMatchObject({ importedCount: 2, skippedCount: 2 });
  expect(await commitLogbookImport(owners[0], request)).toMatchObject({ id: batch.id, alreadyImported: true });
  expect(await commitLogbookImport(owners[0], { ...request, requestId: randomUUID() })).toMatchObject({ id: batch.id, alreadyImported: true });
  const otherFile = requestFor("date,duration_minutes,wing,site\n2002-05-01,60,Rush 4,Hill");
  expect((await previewLogbookImport(owners[0], otherFile)).rows[0].duplicates).toHaveLength(1);
  await expect(commitLogbookImport(owners[0], otherFile)).rejects.toMatchObject({ status: 409 });
  otherFile.rows[0].allowDuplicate = true;
  expect(await commitLogbookImport(owners[0], otherFile)).toMatchObject({ importedCount: 1 });
  const flights = await listOwnFlights(owners[0]);
  expect(statsFrom(flights)).toMatchObject({ flightCount: before + 3 });
  expect(flights.some(f => f.reportedXcDistanceM === 30000)).toBe(true);
});

it("resolves chosen sites, rejects someone else's private sites, and hides private site anchors from visitors", async () => {
  const site = await prisma.site.create({ data: { name: "Private imported site", normalizedName: "private imported site", lat: 37, lon: -122, kind: "takeoff", visibility: "private", ownerId: owners[0] } });
  const request = manual({ date: "2003-01-01", takeoffSiteId: site.id, takeoffSiteName: "Alias", takeoffLat: "0", takeoffLon: "0" });
  await expect(saveLogbookEntry(owners[1], request)).rejects.toMatchObject({ status: 409 });
  const result = await saveLogbookEntry(owners[0], { ...request, visibility: "public" });
  if (!("id" in result)) throw new Error("Unexpected duplicate");
  expect(await getFlightForViewer(result.id, owners[0])).toMatchObject({ takeoffSiteName: site.name, takeoffLat: 37, takeoffLon: -122 });
  expect(await prisma.flight.findUnique({ where: result })).toMatchObject({ takeoffSiteName: null });
  expect(await getFlightForViewer(result.id, null)).toMatchObject({ takeoffSiteName: null, takeoffLat: null, takeoffLon: null });
  await prisma.site.delete({ where: { id: site.id } });
});

it("undo removes only unchanged entries, never another pilot's entries or later edits", async () => {
  const batch = await commitLogbookImport(owners[0], requestFor("date,wing\n2004-01-01,Untouched\n2004-01-02,Edited"));
  const changed = await prisma.flight.findFirstOrThrow({ where: { logbookImportId: batch.id, glider: "Edited" } });
  await saveLogbookEntry(owners[0], { ...manual(), flightId: changed.id, expectedUpdatedAt: changed.updatedAt.toISOString(), draft: { ...flightToEntryDraft(changed), notes: "Keep this memory" } });
  await expect(undoLogbookImport(owners[1], batch.id)).rejects.toMatchObject({ status: 404 });
  expect(await undoLogbookImport(owners[0], batch.id)).toEqual({ removed: 1, retained: 1 });
  expect(await undoLogbookImport(owners[0], batch.id)).toEqual({ removed: 0, retained: 1 });
  expect(await prisma.flight.findUnique({ where: { id: changed.id } })).toMatchObject({ notes: "Keep this memory" });
});

it("attaches a reviewed IGC to the same entry, retaining reported XC and rejecting stale or duplicate attachments", async () => {
  const batch = await commitLogbookImport(owners[0], requestFor("date,duration_minutes,wing,notes,xc_distance,xc_type\n2024-07-12,90,My historic wing,My memory,45,fai-triangle"));
  const flight = await prisma.flight.findFirstOrThrow({ where: { logbookImportId: batch.id } });
  const bytes = Buffer.from(makeRealisticFlight().igc);
  await expect(attachIgc(owners[1], flight.id, bytes, false)).rejects.toMatchObject({ status: 404 });
  await expect(attachIgc(owners[0], flight.id, Buffer.from("bad"), false)).rejects.toThrow(/no usable GPS/);
  const preview = await attachIgc(owners[0], flight.id, bytes, false);
  if (preview.attached) throw new Error("Unexpected attach");
  expect(preview.previous.durationS).toBe(5400);
  expect(preview.recorded.durationS).toBeLessThan(400);
  expect(await prisma.flightData.findUnique({ where: { flightId: flight.id } })).toBeNull();
  await expect(attachIgc(owners[0], flight.id, bytes, true, "2000-01-01T00:00:00.000Z", preview.hash)).rejects.toMatchObject({ status: 409 });
  const before = await prisma.flight.count({ where: { ownerId: owners[0] } });
  expect(await attachIgc(owners[0], flight.id, bytes, true, preview.expectedUpdatedAt, preview.hash)).toEqual({ id: flight.id, attached: true });
  expect(await attachIgc(owners[0], flight.id, bytes, true, preview.expectedUpdatedAt, preview.hash)).toEqual({ id: flight.id, attached: true });
  expect(await prisma.flight.count({ where: { ownerId: owners[0] } })).toBe(before);
  expect(await prisma.flight.findUnique({ where: { id: flight.id } })).toMatchObject({ recordingKind: "igc", source: "csv_import", glider: "My historic wing", notes: "My memory", reportedXcDistanceM: 45000, reportedXcType: "fai-triangle", xcStatus: "queued" });
  expect(Buffer.from((await prisma.flightData.findUniqueOrThrow({ where: { flightId: flight.id } })).rawIgc)).toEqual(bytes);
  const other = await saveLogbookEntry(owners[0], manual({ date: "2005-01-01" }));
  if (!("id" in other)) throw new Error("Unexpected duplicate");
  await expect(attachIgc(owners[0], other.id, bytes, false)).rejects.toMatchObject({ status: 409 });
  expect(await undoLogbookImport(owners[0], batch.id)).toEqual({ removed: 0, retained: 1 });
});

it("handles the advertised 5,000-row limit and concurrent retries as one import", async () => {
  const lines = Array.from({ length: 5000 }, (_, index) => `${new Date(Date.UTC(1980, 0, index + 1)).toISOString().slice(0, 10)},45,Historic wing`);
  const request = requestFor(`date,duration_minutes,wing\n${lines.join("\n")}`);
  const [a, b] = await Promise.all([commitLogbookImport(owners[1], request), commitLogbookImport(owners[1], request)]);
  expect(a.id).toBe(b.id);
  expect(a.importedCount).toBe(5000);
  expect(await prisma.flight.count({ where: { ownerId: owners[1], logbookImportId: a.id } })).toBe(5000);
  expect(await undoLogbookImport(owners[1], a.id)).toEqual({ removed: 5000, retained: 0 });
}, 30000);
