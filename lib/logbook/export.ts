import type { Flight } from "@prisma/client";
import { Readable } from "node:stream";
import { Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import { prisma } from "@/lib/prisma";
import { listOwnFlightsForExport } from "@/lib/flights/repo";
import { igcFilename } from "@/lib/flights/igc-filename";
import { readXcScore } from "@/lib/igc/xc-types";
import { CSV_HEADERS } from "./csv";
import { flightToEntryDraft } from "./flight-draft";

type ExportFlight = Flight & { data: { flightId: string } | null };

const EXTRA_HEADERS = [
  "flight_id", "igc_filename", "recording_kind", "source", "status", "visibility",
  "takeoff_utc", "landing_utc", "duration_seconds", "track_distance_m", "straight_distance_m",
  "recorded_xc_distance_m", "recorded_xc_type", "recorded_xc_points", "xc_status",
  "takeoff_zone", "landing_zone", "flight_type_tags", "launch_types", "restricted_landing_field",
] as const;

// Text cells cannot execute spreadsheet formulas. Numeric values and generated UTC
// offsets are handled separately so negative coordinates/sink rates remain numbers.
function csvCell(value: string | number | boolean | null | undefined, trusted = false) {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && !trusted && /^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const numericFields = new Set([
  "durationMinutes", "maxAltitude", "launchAltitude", "heightGained", "xcDistance",
  "maxClimb", "maxSink", "takeoffLat", "takeoffLon", "landingLat", "landingLon",
]);

export function exportCsvHeader() {
  return "\uFEFF" + [...CSV_HEADERS.map(field => field === "heightGained" ? "total_climbs" : field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)), ...EXTRA_HEADERS].map(value => csvCell(value)).join(",") + "\r\n";
}

export function exportCsvRow(flight: ExportFlight) {
  const draft = flightToEntryDraft(flight);
  const best = readXcScore(flight.xcScore)?.best;
  const entry = CSV_HEADERS.map(field => csvCell(draft[field], numericFields.has(field) || (field === "timeZone" && /^[+-]\d{2}:\d{2}$/.test(draft[field]))));
  const extra = [
    flight.id, flight.data ? igcFilename(flight) : "", flight.recordingKind, flight.source, flight.status, flight.visibility,
    flight.takeoffAt?.toISOString(), flight.landingAt?.toISOString(), flight.durationS, flight.trackDistM, flight.straightDistM,
    best?.distanceM, best?.shape, best?.points, flight.xcStatus,
    flight.takeoffZoneName, flight.landingZoneName, flight.flightTypeTags.join(";"), flight.launchTypes.join(";"), flight.restrictedLandingField,
  ];
  return [...entry, ...extra.map(value => csvCell(value))].join(",") + "\r\n";
}

async function* flightsForExport(ownerId: string, firstPage: ExportFlight[], signal: AbortSignal) {
  let page = firstPage;
  while (page.length) {
    for (const flight of page) {
      signal.throwIfAborted();
      yield flight;
    }
    signal.throwIfAborted();
    page = await listOwnFlightsForExport(ownerId, page[page.length - 1].id);
  }
}

export function csvExportStream(ownerId: string, firstPage: ExportFlight[], signal: AbortSignal) {
  async function* chunks() {
    yield Buffer.from(exportCsvHeader());
    for await (const flight of flightsForExport(ownerId, firstPage, signal)) yield Buffer.from(exportCsvRow(flight));
  }
  return Readable.toWeb(Readable.from(chunks(), { signal })) as ReadableStream<Uint8Array>;
}

export function igcZipStream(ownerId: string, firstPage: ExportFlight[], signal: AbortSignal) {
  let controller: TransformStreamDefaultController<Uint8Array>;
  const stream = new TransformStream<Uint8Array, Uint8Array>({ start(value) { controller = value; } });
  const zip = new ZipWriter(stream.writable, { useWebWorkers: false, bufferedWrite: false });
  // The response consumes the readable side concurrently; awaiting this producer
  // here would deadlock on backpressure. Only one raw recording is loaded at a time.
  void (async () => {
    for await (const flight of flightsForExport(ownerId, firstPage, signal)) {
      if (!flight.data) continue;
      const data = await prisma.flightData.findFirst({
        where: { flightId: flight.id, flight: { ownerId } }, select: { rawIgc: true },
      });
      if (!data) throw new Error("A recording changed during export. Please try again.");
      await zip.add(igcFilename(flight), new Uint8ArrayReader(data.rawIgc), { signal });
    }
    await zip.close();
  })().catch(error => controller.error(error));
  return stream.readable;
}
