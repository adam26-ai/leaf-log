// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTandemEnabled, setWingTandem } from "@/app/settings/wing-actions";
import { saveFlightFlags, updateFlightDetails, updateFlightWing } from "@/app/flights/[id]/edit/actions";
import { renameOwnWings, listOwnWings, WingListChanged } from "@/lib/flights/wings";
import { ingestFlight } from "@/lib/ingest/ingest-flight";
import { saveLogbookEntry, commitLogbookImport } from "@/lib/logbook/service";
import { emptyEntry } from "@/lib/logbook/entry";
import { flightToEntryDraft } from "@/lib/logbook/flight-draft";
import { CSV_DEFAULTS, csvEntries, guessColumns, parseCsv } from "@/lib/logbook/csv";
import { createDeviceToken } from "@/lib/devices/repo";
import { POST as deviceUpload } from "@/app/api/ingest/route";
import { POST as webUpload } from "@/app/api/upload/route";
import { makeRealisticFlight } from "./igc/make-igc";

const auth = vi.hoisted(() => ({ ownerId: "" }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: async () => auth.ownerId || null }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: auth.ownerId } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const owners: string[] = [];
async function pilot() {
  const handle = `tw${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const owner = await prisma.user.create({ data: { email: `${handle}@test.local`, profile: { create: { handle, displayName: "Tandem test", tandemEnabled: true } } } });
  owners.push(owner.id); auth.ownerId = owner.id;
  return owner.id;
}
afterAll(async () => { await prisma.user.deleteMany({ where: { id: { in: owners } } }); await prisma.$disconnect(); });
const flight = (ownerId: string, glider: string | null, tandemOverride: boolean | null = null) => prisma.flight.create({ data: {
  ownerId, glider, status: "ready", tandemOverride, occupancy: tandemOverride === null ? null : tandemOverride ? "tandem" : "solo",
  flightFlags: [...(tandemOverride ? ["tandem"] : []), "siv", "tow"], launchTypes: ["ST"], durationS: 300, notes: "Keep this", visibility: "private",
} });
const get = (id: string) => prisma.flight.findUniqueOrThrow({ where: { id } });
const igc = (name: string, suffix = "") => Buffer.from(makeRealisticFlight().igc.replace(/HFGTYGLIDERTYPE:[^\r\n]*/, `HFGTYGLIDERTYPE:${name}`) + `\r\nLTEST${suffix}`);

it("migrates historical manual choices while leaving unchosen flights eligible for defaults", async () => {
  const migration = readFileSync("prisma/migrations/20260913120000_tandem_wings/migration.sql", "utf8");
  await prisma.$transaction(async tx => {
    // Temporary tables shadow only this transaction's tables, exercising the actual migration.
    await tx.$executeRaw`CREATE TEMP TABLE "Profile" ("id" text) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "Flight" ("id" text, "occupancy" text, "flightFlags" text[]) ON COMMIT DROP`;
    await tx.$executeRaw`INSERT INTO "Flight" VALUES ('unknown', NULL, '{}'), ('solo', 'solo', '{}'), ('legacy-tandem', 'tandem', '{}'), ('flag-tandem', NULL, '{tandem}'), ('tow-only', NULL, '{tow}')`;
    for (const statement of migration.split(";").filter(value => value.trim())) await tx.$executeRawUnsafe(statement);
    const rows = await tx.$queryRaw<{ id: string; tandemOverride: boolean | null }[]>`SELECT "id", "tandemOverride" FROM "Flight"`;
    expect(Object.fromEntries(rows.map(row => [row.id, row.tandemOverride]))).toEqual({ unknown: null, solo: false, "legacy-tandem": true, "flag-tandem": true, "tow-only": null });
  });
});

it("updates inherited flags on every toggle while preserving explicit solo/tandem and other pilots", async () => {
  const other = await pilot();
  const otherFlight = await flight(other, "Shared wing");
  const owner = await pilot();
  const inherited = await flight(owner, "Shared wing");
  const solo = await flight(owner, "Shared wing", false);
  const tandem = await flight(owner, "Shared wing", true);
  for (const enabled of [true, false, true, false, true]) {
    expect(await setWingTandem("Shared wing", enabled)).toEqual({});
    expect(await get(inherited.id)).toMatchObject({ occupancy: enabled ? "tandem" : "solo", tandemOverride: null, notes: "Keep this", durationS: 300, launchTypes: ["ST"], visibility: "private" });
    expect((await get(inherited.id)).flightFlags).toEqual(enabled ? ["siv", "tow", "tandem"] : ["siv", "tow"]);
    expect(await get(solo.id)).toMatchObject({ occupancy: "solo", tandemOverride: false, flightFlags: ["siv", "tow"] });
    expect(await get(tandem.id)).toMatchObject({ occupancy: "tandem", tandemOverride: true, flightFlags: ["tandem", "siv", "tow"] });
    expect(await get(otherFlight.id)).toMatchObject({ occupancy: null, tandemOverride: null });
  }
  expect(await setWingTandem("Missing", true)).toHaveProperty("error");
  auth.ownerId = "";
  expect(await setWingTandem("Shared wing", false)).toHaveProperty("error");
  expect(await setTandemEnabled(false)).toHaveProperty("error");
});

it("keeps auto-upload defaults active when controls are hidden and never overwrites a duplicate", async () => {
  const owner = await pilot();
  await flight(owner, "Device Tandem");
  await setWingTandem("Device Tandem", true);
  await setTandemEnabled(false);
  expect(await setWingTandem("Device Tandem", false)).toHaveProperty("error");
  const { plaintext } = await createDeviceToken(owner, "Leaf");
  const request = () => new Request("http://localhost/api/ingest", { method: "POST", headers: { authorization: `Bearer ${plaintext}` }, body: igc("Device Tandem") });
  const response = await deviceUpload(request());
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(await get(result.flightId)).toMatchObject({ source: "device_push", occupancy: "tandem", flightFlags: ["tandem"], tandemOverride: null });
  await saveFlightFlags(result.flightId, [], true);
  expect(await (await deviceUpload(request())).json()).toMatchObject({ deduped: true, flightId: result.flightId });
  expect(await get(result.flightId)).toMatchObject({ occupancy: "solo", tandemOverride: false });
});

it("combines web upload flags with defaults, including an explicit unchecked tandem choice", async () => {
  const owner = await pilot();
  await flight(owner, "Web Tandem"); await setWingTandem("Web Tandem", true);
  for (const override of [undefined, false, true]) {
    const form = new FormData();
    form.append("files", new File([igc("Web Tandem", String(override))], "flight.igc"));
    form.append("flightFlags", "tow"); form.set("allowPossibleDuplicate", "true");
    if (override !== undefined) form.set("tandemOverride", String(override));
    const response = await webUpload(new Request("http://localhost/api/upload", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results[0].error).toBeUndefined();
    expect(await get(results[0].flightId)).toMatchObject({ tandemOverride: override ?? null, occupancy: override === false ? "solo" : "tandem", launchTypes: ["ST"], flightFlags: override === false ? ["tow"] : ["tow", "tandem"] });
  }
});

it("treats only tandem edits as overrides and follows the new wing when reassigning a flight", async () => {
  const owner = await pilot();
  const inherited = await flight(owner, "Tandem");
  await flight(owner, "Solo"); await setWingTandem("Tandem", true);
  await saveFlightFlags(inherited.id, ["tandem", "competition"], false);
  expect(await get(inherited.id)).toMatchObject({ tandemOverride: null });
  const details = new FormData(); details.set("occupancy", "tandem"); details.set("tandemTouched", "false"); details.append("launchTypes", "ST");
  await updateFlightDetails(inherited.id, {}, details);
  expect(await get(inherited.id)).toMatchObject({ tandemOverride: null });
  const wingForm = new FormData(); wingForm.set("glider", "Solo");
  await updateFlightWing(inherited.id, {}, wingForm);
  expect(await get(inherited.id)).toMatchObject({ glider: "Solo", tandemOverride: null, occupancy: "solo", flightFlags: ["competition", "tow"] });
  await saveFlightFlags(inherited.id, ["tandem", "competition"], true);
  wingForm.set("glider", "Tandem"); await updateFlightWing(inherited.id, {}, wingForm);
  await setWingTandem("Tandem", false);
  expect(await get(inherited.id)).toMatchObject({ tandemOverride: true, occupancy: "tandem" });
  details.set("occupancy", "solo"); details.set("tandemTouched", "true");
  await updateFlightDetails(inherited.id, {}, details); await setWingTandem("Tandem", true);
  expect(await get(inherited.id)).toMatchObject({ tandemOverride: false, occupancy: "solo" });
});

it("merges into existing wings with an explicit type and keeps overrides from every source", async () => {
  const owner = await pilot();
  const source = await flight(owner, "Source");
  const manual = await flight(owner, "Source", true);
  const target = await flight(owner, "Destination");
  await setWingTandem("Source", true);
  await expect(renameOwnWings(owner, { sources: [{ name: "Source", count: 2 }], target: "Destination" })).rejects.toBeInstanceOf(WingListChanged);
  await renameOwnWings(owner, { sources: [{ name: "Source", count: 2 }], target: "Destination", tandem: false });
  for (const id of [source.id, target.id]) expect(await get(id)).toMatchObject({ glider: "Destination", occupancy: "solo", tandemOverride: null });
  expect(await get(manual.id)).toMatchObject({ glider: "Destination", occupancy: "tandem", tandemOverride: true });
  expect((await listOwnWings(owner))[0]).toMatchObject({ name: "Destination", tandem: false, count: 3 });
  await flight(owner, "Third");
  await renameOwnWings(owner, { sources: [{ name: "Destination", count: 3 }, { name: "Third", count: 1 }], target: "Merged", tandem: true });
  expect(await get(source.id)).toMatchObject({ occupancy: "tandem", tandemOverride: null });
  await renameOwnWings(owner, { sources: [{ name: "Merged", count: 4 }], target: "Renamed" });
  expect((await listOwnWings(owner))[0]).toMatchObject({ name: "Renamed", tandem: true });
  expect((await prisma.profile.findUniqueOrThrow({ where: { id: owner } })).tandemWings).toEqual(["Renamed"]);
});

it("uses OR when merging with hidden controls, including unspecified wings", async () => {
  const owner = await pilot();
  await flight(owner, "Tandem"); const unspecified = await flight(owner, null);
  await setWingTandem("Tandem", true); await setTandemEnabled(false);
  await renameOwnWings(owner, { sources: [{ name: null, count: 1 }], target: "Tandem" });
  expect(await get(unspecified.id)).toMatchObject({ occupancy: "tandem", glider: "Tandem", tandemOverride: null });
});

it("applies manual/CSV defaults while preserving explicit choices and unrelated manual edits", async () => {
  const owner = await pilot(); await flight(owner, "Log Tandem"); await setWingTandem("Log Tandem", true);
  const created = await saveLogbookEntry(owner, { requestId: randomUUID(), visibility: "private", draft: { ...emptyEntry(), date: "2000-01-01", glider: "Log Tandem", flightTypes: "tow" } });
  if (!("id" in created)) throw new Error("Unexpected duplicate");
  let current = await get(created.id);
  expect(current).toMatchObject({ occupancy: "tandem", tandemOverride: null, flightFlags: ["tow", "tandem"] });
  await saveLogbookEntry(owner, { requestId: randomUUID(), visibility: "private", flightId: current.id, expectedUpdatedAt: current.updatedAt.toISOString(), tandemTouched: false,
    draft: { ...flightToEntryDraft(current), notes: "Edited notes" } });
  expect(await get(current.id)).toMatchObject({ tandemOverride: null, notes: "Edited notes" });
  current = await get(current.id);
  await saveLogbookEntry(owner, { requestId: randomUUID(), visibility: "private", flightId: current.id, expectedUpdatedAt: current.updatedAt.toISOString(), tandemTouched: true,
    draft: { ...flightToEntryDraft(current), flightTypes: "tow", occupancy: "solo" } });
  const csv = "date,wing,occupancy\n2000-01-02,Log Tandem,\n2000-01-03,Log Tandem,solo\n2000-01-04,Log Tandem,tandem";
  const table = parseCsv(csv);
  const batch = await commitLogbookImport(owner, { requestId: randomUUID(), filename: "tandem.csv", csv, visibility: "private", rows: csvEntries(table, guessColumns(table.headers), CSV_DEFAULTS) });
  let rows = await prisma.flight.findMany({ where: { logbookImportId: batch.id }, orderBy: { flightDate: "asc" } });
  expect(rows.map(row => [row.occupancy, row.tandemOverride])).toEqual([["tandem", null], ["solo", false], ["tandem", true]]);
  await setWingTandem("Log Tandem", false); await setWingTandem("Log Tandem", true); await setWingTandem("Log Tandem", false);
  rows = await prisma.flight.findMany({ where: { logbookImportId: batch.id }, orderBy: { flightDate: "asc" } });
  expect(rows.map(row => [row.occupancy, row.tandemOverride])).toEqual([["solo", null], ["solo", false], ["tandem", true]]);
  expect(await get(created.id)).toMatchObject({ occupancy: "solo", tandemOverride: false, flightFlags: ["tow"] });
});

it("serializes concurrent uploads and toggles so a new flight uses the final default", async () => {
  const owner = await pilot(); await flight(owner, "Concurrent");
  await Promise.all([
    ingestFlight({ ownerId: owner, bytes: igc("Concurrent"), source: "device_push" }),
    setWingTandem("Concurrent", true),
  ]);
  const rows = await prisma.flight.findMany({ where: { ownerId: owner, glider: "Concurrent" } });
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.occupancy === "tandem" && row.tandemOverride === null)).toBe(true);
});
