// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { parseCsv } from "@/lib/logbook/csv";
config({ path: ".env.local", quiet: true });

const session = vi.hoisted(() => ({ viewerId: null as string | null }));
vi.mock("@/lib/profile", () => ({ getCurrentUserId: async () => session.viewerId }));
import { GET } from "@/app/api/logbook/export/route";

const prisma = new PrismaClient();
const users: string[] = [];
const original = Buffer.concat([Buffer.from("AXXX\r\nHFDTE120626\r\nLRecorder "), Buffer.from([0xff, 0x00]), Buffer.from("\r\nGSignature-kept\r\n")]);
let owner: string, other: string, empty: string;
let recordedId: string, failedId: string, manualId: string, missingId: string;
const download = (format = "csv", extra = "") => GET(new Request(`http://localhost/api/logbook/export?format=${format}${extra}`));
const rows = (csv: string) => {
  const table = parseCsv(csv);
  return table.rows.map(row => Object.fromEntries(table.headers.map((header, index) => [header, row.cells[index]])));
};

beforeAll(async () => {
  const prefix = `export${Date.now()}`;
  for (const label of ["owner", "other", "empty"]) {
    const user = await prisma.user.create({ data: { email: `${prefix}${label}@test.local`,
      profile: { create: { handle: `${prefix}${label}`, displayName: label } } } });
    users.push(user.id);
  }
  [owner, other, empty] = users;
  const site = await prisma.site.create({ data: { name: "Private launch", normalizedName: "private launch", ownerId: owner, visibility: "private", lat: 37, lon: -122 } });
  recordedId = (await prisma.flight.create({ data: {
    ownerId: owner, status: "ready", visibility: "private", takeoffSiteId: site.id,
    takeoffAt: new Date("2026-06-12T00:30:00Z"), landingAt: new Date("2026-06-12T01:30:01Z"), localUtcOffsetMinutes: -420,
    durationS: 3601, maxSinkMs: -3.5, takeoffLat: 37, takeoffLon: -122, glider: "Élan, \"blue\"",
    notes: "First line\r\nSecond, quoted \"line\"", data: { create: { rawIgc: original } },
    xcScore: { version: 1, best: { shape: "open", distanceM: 42000, points: 42 }, candidates: [] },
  } })).id;
  failedId = (await prisma.flight.create({ data: { ownerId: owner, status: "failed", visibility: "friends",
    flightDate: new Date("2026-06-13T00:00:00Z"), data: { create: { rawIgc: original } } } })).id;
  manualId = (await prisma.flight.create({ data: { ownerId: owner, status: "ready", visibility: "public", source: "csv_import", recordingKind: "logbook",
    flightDate: new Date("2000-01-01T00:00:00Z"), notes: "=HYPERLINK(\"https://example.com\")", glider: "  +SUM(1,2)",
    reportedXcDistanceM: 12345, reportedXcType: "fai-triangle" } })).id;
  missingId = (await prisma.flight.create({ data: { ownerId: owner, status: "processing" } })).id;
  await prisma.flight.create({ data: { ownerId: other, status: "ready", visibility: "public", notes: "Other pilot secret", data: { create: { rawIgc: Buffer.from("other") } } } });
});

afterAll(async () => {
  await prisma.site.deleteMany({ where: { ownerId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("requires authentication and rejects unsupported formats", async () => {
  session.viewerId = null;
  for (const format of ["csv", "igc"]) {
    const response = await download(format);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBeNull();
  }
  session.viewerId = owner;
  expect((await download("other")).status).toBe(400);
});

it("exports all owned flights with dates, explicit units, unknowns, and safe quoted text", async () => {
  session.viewerId = owner;
  const response = await download("csv", `&ownerId=${other}&from=2099-01-01`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="leaf-log-logbook-.*\.csv"/);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const exported = rows(Buffer.from(bytes).toString("utf8"));
  expect(exported.map(row => row.flight_id).sort()).toEqual([recordedId, failedId, manualId, missingId].sort());
  expect(exported.find(row => row.flight_id === recordedId)).toMatchObject({
    date: "2026-06-11", takeoff_time: "17:30:00", time_zone: "-07:00", duration_seconds: "3601",
    takeoff_site_name: "Private launch", glider: "Élan, \"blue\"", notes: "First line\r\nSecond, quoted \"line\"",
    takeoff_lon: "-122", max_sink: "-3.5", altitude_unit: "m", distance_unit: "km", vario_unit: "m/s",
    igc_filename: `flight-2026-06-11-${recordedId}.igc`, recorded_xc_distance_m: "42000", recorded_xc_points: "42", xc_distance: "",
  });
  expect(exported.find(row => row.flight_id === manualId)).toMatchObject({ date: "2000-01-01", duration_minutes: "", takeoff_time: "", igc_filename: "", xc_distance: "12.345", xc_type: "fai-triangle", notes: "'=HYPERLINK(\"https://example.com\")", glider: "'  +SUM(1,2)" });
  expect(exported.find(row => row.flight_id === missingId)).toMatchObject({ igc_filename: "", date: "", status: "processing" });
});

it("matches CSV filenames to ZIP entries and preserves every raw byte, including failed flights", async () => {
  session.viewerId = owner;
  const csv = rows(await (await download()).text());
  const response = await download("igc", `&ownerId=${other}`);
  expect(response.headers.get("content-type")).toBe("application/zip");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="leaf-log-igc-.*\.zip"/);
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(await response.arrayBuffer())), { useWebWorkers: false });
  const entries = await reader.getEntries();
  expect(entries.map(entry => entry.filename).sort()).toEqual(csv.map(row => row.igc_filename).filter(Boolean).sort());
  expect(entries).toHaveLength(2);
  for (const entry of entries) {
    if (entry.directory) throw new Error("Unexpected directory");
    expect(Buffer.from(await entry.getData(new Uint8ArrayWriter(), { checkSignature: true }))).toEqual(original);
  }
  await reader.close();
});

it("returns valid empty exports", async () => {
  session.viewerId = empty;
  const csv = await (await download()).text();
  expect(csv.trim().split("\r\n")).toHaveLength(1);
  expect(csv).toContain('"igc_filename"');
  const response = await download("igc");
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(await response.arrayBuffer())));
  expect(await reader.getEntries()).toEqual([]);
  await reader.close();
});

it("keeps ownership isolation for other signed-in users", async () => {
  session.viewerId = other;
  const exported = rows(await (await download("csv", `&ownerId=${owner}`)).text());
  expect(exported).toHaveLength(1);
  expect(exported[0].notes).toBe("Other pilot secret");
});

it("exports beyond the metadata page size without dropping or duplicating flights", async () => {
  await prisma.flight.createMany({ data: Array.from({ length: 251 }, () => ({ ownerId: empty, recordingKind: "logbook", source: "manual_entry", status: "ready" })) });
  session.viewerId = empty;
  const exported = rows(await (await download()).text());
  expect(exported).toHaveLength(251);
  expect(new Set(exported.map(row => row.flight_id)).size).toBe(251);
  expect(exported.every(row => row.igc_filename === "")).toBe(true);
});
