import { describe, expect, it } from "vitest";
import { emptyEntry, localInstant, parseEntry } from "./entry";
import { CSV_DEFAULTS, csvEntries, guessColumns, parseCsv, templateCsv } from "./csv";
import { suggestNames } from "./names";
import { flightTrophies } from "@/lib/flights/trophies";
import { analysisState } from "@/lib/flights/analysis-state";

describe("historic flight values", () => {
  it("preserves unknown measurements and date-only entries", () => {
    expect(parseEntry({ ...emptyEntry(), date: "2001-04-24" })).toMatchObject({ ok: true, data: { flightDate: new Date("2001-04-24Z"), takeoffAt: null, landingAt: null, durationS: null, maxAltM: null, reportedXcDistanceM: null } });
  });
  it("converts mixed units once and keeps XC category", () => {
    expect(parseEntry({ ...emptyEntry(), date: "2001-04-24", durationMinutes: "95.5", altitudeUnit: "ft", maxAltitude: "10000", launchAltitude: "2000", xcDistance: "50", xcType: "fai-triangle", distanceUnit: "mi", varioUnit: "ft/min", maxClimb: "600", maxSink: "500" })).toMatchObject({ ok: true, data: { durationS: 5730, maxAltM: 3048, launchAltM: 610, reportedXcDistanceM: 80467, reportedXcType: "fai-triangle", maxClimbMs: 3.048 } });
  });
  it.each([{ date: "2020-02-30" }, { durationMinutes: "0" }, { xcDistance: "25" }, { xcType: "open" }, { takeoffLat: "37" }, { maxAltitude: "200", launchAltitude: "300" }, { maxAltitude: "NaN" }, { takeoffTime: "14:00" }])("rejects contradictory or ambiguous data %j", patch => {
    expect(parseEntry({ ...emptyEntry(), date: "2020-01-01", ...patch }).ok).toBe(false);
  });
  it("resolves overnight flights without changing the local date", () => {
    expect(parseEntry({ ...emptyEntry(), date: "2024-07-12", takeoffTime: "23:30:00", timeZone: "America/Los_Angeles", durationMinutes: "90" })).toMatchObject({ ok: true, data: { flightDate: new Date("2024-07-12Z"), takeoffAt: new Date("2024-07-13T06:30:00Z"), landingAt: new Date("2024-07-13T08:00:00Z"), localUtcOffsetMinutes: -420 } });
  });
  it("requires an explicit offset for skipped and repeated DST times", () => {
    expect(() => localInstant("2024-11-03", "01:30", "America/Los_Angeles")).toThrow(/ambiguous/);
    expect(() => localInstant("2024-03-10", "02:30", "America/Los_Angeles")).toThrow(/skipped/);
    expect(localInstant("2024-11-03", "01:30", "-08:00").date.toISOString()).toBe("2024-11-03T09:30:00.000Z");
  });
});

describe("CSV import", () => {
  it("reads BOM, quoted commas, double quotes, and multiline notes", () => {
    const table = parseCsv('\uFEFFdate,wing,notes\r\n2020-06-15,"Rush, 4","First line\r\nHe said ""hello"""\r\n2020-06-16,,\r\n');
    expect(table.rows).toEqual([{ line: 2, cells: ["2020-06-15", "Rush, 4", 'First line\r\nHe said "hello"'] }, { line: 4, cells: ["2020-06-16", "", ""] }]);
  });
  it("maps semicolon exports with explicit European dates and clock durations", () => {
    const table = parseCsv("Date;Airtime;Wing;Distance;Route type\n04/05/2020;1:35:30;Rush4;30;FAI triangle");
    const rows = csvEntries(table, guessColumns(table.headers), { ...CSV_DEFAULTS, dateFormat: "dmy", durationFormat: "clock" });
    expect(rows[0].draft).toMatchObject({ date: "2020-05-04", durationMinutes: "95.5", xcDistance: "30", xcType: "fai-triangle" });
    expect(parseEntry(rows[0].draft).ok).toBe(true);
  });
  it("round-trips the example template including all named fields", () => {
    const table = parseCsv(templateCsv(true));
    const rows = csvEntries(table, guessColumns(table.headers), CSV_DEFAULTS);
    expect(parseEntry(rows[0].draft)).toMatchObject({ ok: true, data: { durationS: 5700, maxAltM: 1800, reportedXcDistanceM: 24500, reportedXcType: "open" } });
  });
  it.each(['date,date\n2020-01-01,2020-01-01', 'date,notes\n2020-01-01,"unterminated', 'date\n2020-01-01,extra'])("rejects malformed CSV without silently dropping values", input => expect(() => parseCsv(input)).toThrow());
  it("offers naming suggestions without choosing one automatically", () => expect(suggestNames("Ozone Rush4", ["Ozone Rush 4", "Rush 4", "Swift 6"])).toEqual(["Ozone Rush 4", "Rush 4"]));
});

it("ranks reported XC alongside recorded distances within its category, without pending analysis", () => {
  const open = { shape: "open", distanceM: 25000, optimal: true };
  const flights = [
    { id: "igc", status: "ready", durationS: 3600, maxAltM: 2000, xcStatus: "ready", xcScore: { version: 1, scoringVersion: 2, complete: true, completedCategories: ["open", "fai-triangle", "free-triangle"], best: open, candidates: [open] } },
    { id: "manual", recordingKind: "logbook", status: "ready", durationS: null, maxAltM: null, reportedXcDistanceM: 30000, reportedXcType: "open", xcStatus: "not_recorded", xcScore: null },
    { id: "triangle", recordingKind: "logbook", status: "ready", durationS: null, maxAltM: null, reportedXcDistanceM: 40000, reportedXcType: "fai-triangle", xcStatus: "not_recorded", xcScore: null },
  ];
  const trophies = flightTrophies(flights);
  expect(trophies.manual).toEqual([{ category: "open", rank: 1, value: 30000, reported: true, approximate: false }]);
  expect(trophies.igc.find(trophy => trophy.category === "open")?.rank).toBe(2);
  expect(trophies.triangle[0].category).toBe("fai-triangle");
  expect(analysisState(flights[1])).toMatchObject({ action: null, incomplete: false });
});
