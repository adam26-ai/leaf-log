import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateShortId } from "@/lib/short-id";
import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import { siteVisibleWhere } from "@/lib/sites/repo";
import { draftSchema, parseEntry, entryWarnings, type EntryDraft } from "./entry";
import { MAX_IMPORT_ROWS, parseCsv } from "./csv";
import { locationData, entrySiteSelect } from "./locations";
import { duplicateKey, possibleDuplicate, type DuplicateFlight } from "./duplicates";

export class EntryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const visibilitySchema = z.enum(["private", "friends", "public"]);
const keySchema = z.string().uuid();
export const entryRequestSchema = z.object({ draft: draftSchema, visibility: visibilitySchema, requestId: keySchema,
  flightId: z.string().max(100).optional(), expectedUpdatedAt: z.string().datetime().optional(), allowDuplicate: z.boolean().default(false) }).strict();
export const importRequestSchema = z.object({ requestId: keySchema, filename: z.string().min(1).max(200), csv: z.string().max(2_000_000),
  visibility: visibilitySchema, rows: z.array(z.object({ line: z.number().int().positive(), draft: draftSchema, excluded: z.boolean(), allowDuplicate: z.boolean() }).strict()).min(1).max(MAX_IMPORT_ROWS) }).strict();
export type ImportRequest = z.infer<typeof importRequestSchema>;

function requireParsed(draft: EntryDraft) {
  const parsed = parseEntry(draft);
  if (!parsed.ok) throw new EntryError(parsed.issues.map(issue => `${issue.field}: ${issue.message}`).join(" "));
  return parsed;
}

type EntryDb = Pick<typeof prisma, "site" | "flight">;
const duplicateSelect = { id: true, flightDate: true, takeoffAt: true, localUtcOffsetMinutes: true, durationS: true, glider: true, takeoffSiteName: true } as const;

export async function saveLogbookEntry(ownerId: string, value: unknown) {
  const request = entryRequestSchema.parse(value);
  const parsed = requireParsed(request.draft);
  return prisma.$transaction(async tx => {
    // Serializes retries and the duplicate check for this pilot, including parallel imports.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
    if (!request.flightId) {
      const previous = await tx.flight.findUnique({ where: { ownerId_entryRequestId: { ownerId, entryRequestId: request.requestId } }, select: { id: true } });
      if (previous) return previous;
    } else {
      const current = await tx.flight.findFirst({ where: { id: request.flightId, ownerId, recordingKind: "logbook" } });
      if (!current) throw new EntryError("This manual entry is not available to edit.", 404);
      if (current.updatedAt.toISOString() !== request.expectedUpdatedAt) throw new EntryError("This flight changed in another tab. Reload it before saving.", 409);
    }
    const locations = await locationData(tx, ownerId, parsed.draft).catch(error => { throw new EntryError(error.message, 409); });
    const data = { ...parsed.data, ...locations };
    if (!request.flightId && !request.allowDuplicate) {
      const existing = await tx.flight.findMany({ where: { ownerId }, select: duplicateSelect });
      const matches = existing.filter(flight => possibleDuplicate({ id: "new", ...data }, flight));
      if (matches.length) return { duplicates: matches.map(flight => ({ id: flight.id, date: duplicateKey(flight), wing: flight.glider, site: flight.takeoffSiteName })) };
    }
    if (request.flightId) {
      const updated = await tx.flight.updateMany({ where: { id: request.flightId, ownerId, recordingKind: "logbook", updatedAt: new Date(request.expectedUpdatedAt!) }, data: { ...data, visibility: request.visibility } });
      if (!updated.count) throw new EntryError("This flight changed. Reload it before saving.", 409);
      return { id: request.flightId };
    }
    return tx.flight.create({ data: { ...data, ownerId, visibility: request.visibility, source: "manual_entry", recordingKind: "logbook",
      status: "ready", xcStatus: "not_recorded", metricsVersion: METRICS_VERSION, entryRequestId: request.requestId }, select: { id: true } });
  }, { maxWait: 10000, timeout: 30000 });
}

async function inspectRows(ownerId: string, request: ImportRequest, db: EntryDb = prisma) {
  const table = (() => { try { return parseCsv(request.csv); } catch (error) { throw new EntryError(error instanceof Error ? error.message : "The CSV could not be read."); } })();
  const sourceLines = new Set(table.rows.map(row => row.line));
  if (request.rows.length !== table.rows.length || new Set(request.rows.map(row => row.line)).size !== request.rows.length || request.rows.some(row => !sourceLines.has(row.line))) throw new EntryError("The import rows do not match the CSV. Please reopen the file.");
  const siteIds = [...new Set(request.rows.filter(row => !row.excluded).flatMap(row => [row.draft.takeoffSiteId, row.draft.landingSiteId]).filter(Boolean))];
  const sites = siteIds.length ? await db.site.findMany({ where: { id: { in: siteIds }, ...siteVisibleWhere(ownerId) }, select: entrySiteSelect }) : [];
  const siteCache = new Map(sites.map(site => [site.id, site]));
  const existing = await db.flight.findMany({ where: { ownerId }, select: duplicateSelect });
  const byDay = new Map<string, DuplicateFlight[]>();
  for (const flight of existing) { const key = duplicateKey(flight); byDay.set(key, [...(byDay.get(key) ?? []), flight]); }
  const inspected = [];
  for (const row of request.rows) {
    const parsed = parseEntry(row.draft);
    const errors = parsed.ok ? [] : parsed.issues.map(issue => `${issue.field}: ${issue.message}`);
    const duplicates: { id: string; label: string }[] = [];
    let data = parsed.ok ? parsed.data : null;
    if (parsed.ok && !row.excluded) {
      try { data = { ...parsed.data, ...await locationData(db, ownerId, parsed.draft, siteCache) }; }
      catch (error) { errors.push(error instanceof Error ? error.message : "Site could not be checked."); }
      const candidate = { id: `row:${row.line}`, ...data! };
      const key = duplicateKey(candidate);
      for (const match of byDay.get(key) ?? []) {
        if (possibleDuplicate(candidate, match)) duplicates.push({ id: match.id, label: match.id.startsWith("row:") ? `CSV line ${match.id.slice(4)}` : `${duplicateKey(match)} · ${match.takeoffSiteName ?? "Unknown site"} · ${match.glider ?? "Unknown wing"}` });
        // A preview needs a few examples, even if a spreadsheet repeats a row thousands of times.
        if (duplicates.length === 5) break;
      }
      byDay.set(key, [...(byDay.get(key) ?? []), candidate]);
    }
    inspected.push({ line: row.line, errors, warnings: entryWarnings(row.draft), duplicates, data });
  }
  return inspected;
}

export async function previewLogbookImport(ownerId: string, value: unknown) {
  const request = importRequestSchema.parse(value);
  const inspected = await inspectRows(ownerId, request);
  return { rows: inspected.map(({ line, errors, warnings, duplicates }) => ({ line, errors, warnings, duplicates })) };
}

export async function commitLogbookImport(ownerId: string, value: unknown) {
  const request = importRequestSchema.parse(value);
  const fileHash = createHash("sha256").update(request.csv.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n")).digest("hex");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
    const previous = await tx.logbookImport.findFirst({ where: { ownerId, OR: [{ requestId: request.requestId }, { fileHash, undoneAt: null }] } });
    if (previous) {
      if (previous.undoneAt) throw new EntryError("This import was undone. Reopen the CSV to start a new import.", 409);
      return { id: previous.id, importedCount: previous.importedCount, skippedCount: previous.skippedCount, alreadyImported: true };
    }
    const inspected = await inspectRows(ownerId, request, tx);
    const included = request.rows.map((row, index) => ({ row, review: inspected[index] })).filter(({ row }) => !row.excluded);
    if (!included.length) throw new EntryError("Select at least one flight to import.");
    if (included.some(({ row, review }) => review.errors.length || (review.duplicates.length && !row.allowDuplicate))) throw new EntryError("Resolve the highlighted errors and duplicates before importing. Check the preview again.", 409);
    const batch = await tx.logbookImport.create({ data: { ownerId, requestId: request.requestId, fileHash, filename: request.filename,
      rowCount: request.rows.length, importedCount: included.length, skippedCount: request.rows.length - included.length, snapshot: {} } });
    const now = new Date();
    const entries = included.map(({ row, review }) => ({ ...review.data!, id: generateShortId(10), ownerId,
      visibility: request.visibility, source: "csv_import", recordingKind: "logbook", status: "ready", xcStatus: "not_recorded", metricsVersion: METRICS_VERSION,
      logbookImportId: batch.id, importRow: row.line, updatedAt: now }));
    await tx.flight.createMany({ data: entries });
    await tx.logbookImport.update({ where: { id: batch.id }, data: { snapshot: Object.fromEntries(entries.map(flight => [flight.id, now.toISOString()])) } });
    return { id: batch.id, importedCount: entries.length, skippedCount: batch.skippedCount, alreadyImported: false };
  }, { maxWait: 10000, timeout: 60000 });
}

export async function listLogbookImports(ownerId: string) {
  const batches = await prisma.logbookImport.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" }, take: 100,
    select: { id: true, filename: true, importedCount: true, skippedCount: true, createdAt: true, undoneAt: true, _count: { select: { flights: true } } } });
  return batches.map(batch => ({ ...batch, createdAt: batch.createdAt.toISOString(), undoneAt: batch.undoneAt?.toISOString() ?? null, remaining: batch._count.flights }));
}

/** Undo only untouched imported entries. Later edits, recordings, photos, and social activity survive. */
export async function undoLogbookImport(ownerId: string, id: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
    const batch = await tx.logbookImport.findFirst({ where: { id, ownerId } });
    if (!batch) throw new EntryError("Import not found.", 404);
    if (batch.undoneAt) return { removed: 0, retained: await tx.flight.count({ where: { logbookImportId: id, ownerId } }) };
    const snapshot = batch.snapshot as Record<string, string>;
    const flights = await tx.flight.findMany({ where: { logbookImportId: id, ownerId }, select: { id: true, updatedAt: true, recordingKind: true } });
    const eligible = flights.filter(flight => flight.recordingKind === "logbook" && flight.updatedAt.toISOString() === snapshot[flight.id]);
    const removed = await tx.flight.deleteMany({ where: { ownerId, logbookImportId: id, recordingKind: "logbook", OR: eligible.map(flight => ({ id: flight.id, updatedAt: flight.updatedAt })),
      photos: { none: {} }, kudos: { none: {} }, instructorNotes: { none: {} }, instructorId: null } });
    await tx.logbookImport.update({ where: { id }, data: { undoneAt: new Date() } });
    return { removed: removed.count, retained: flights.length - removed.count };
  }, { maxWait: 10000, timeout: 30000 });
}
