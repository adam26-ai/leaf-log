import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lockSiteRows, lockFlightRow } from "@/lib/sites/locks";
import { generateShortId } from "@/lib/short-id";
import { METRICS_VERSION } from "@/lib/flights/analysis-state";
import { siteVisibleWhere } from "@/lib/sites/repo";
import { duplicateSiteSelect, withOwnerSiteName } from "./site-names";
import { draftSchema, parseEntry, entryWarnings, type EntryDraft } from "./entry";
import { MAX_IMPORT_ROWS, parseCsv } from "./csv";
import { locationData, entrySiteSelect, planEntrySites, commitEntrySites, resolvedLocationPatch, sitePlanSignature, locationEvidence, describeSiteResolution, type SiteChange } from "./locations";
import { duplicateKey, duplicateTimeLabel, possibleDuplicate, type DuplicateFlight } from "./duplicates";
import { lockWingSettings, tandemFlightData, wingIsTandem } from "@/lib/flights/tandem";

export class EntryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const visibilitySchema = z.enum(["private", "friends", "public"]);
const keySchema = z.string().uuid();
export const entryRequestSchema = z.object({ draft: draftSchema, visibility: visibilitySchema, requestId: keySchema,
  flightId: z.string().max(100).optional(), expectedUpdatedAt: z.string().datetime().optional(), tandemTouched: z.boolean().optional(), allowDuplicate: z.boolean().default(false) }).strict();
export const importRequestSchema = z.object({ requestId: keySchema, filename: z.string().min(1).max(200), csv: z.string().max(2_000_000),
  sitePlanSignature: z.string().length(64).optional(),
  visibility: visibilitySchema, rows: z.array(z.object({ line: z.number().int().positive(), draft: draftSchema, excluded: z.boolean(), allowDuplicate: z.boolean() }).strict()).min(1).max(MAX_IMPORT_ROWS) }).strict();
export type ImportRequest = z.infer<typeof importRequestSchema>;

function requireParsed(draft: EntryDraft) {
  const parsed = parseEntry(draft);
  if (!parsed.ok) throw new EntryError(parsed.issues.map(issue => `${issue.field}: ${issue.message}`).join(" "));
  return parsed;
}

type EntryDb = Pick<typeof prisma, "site" | "flight">;
const duplicateSelect = { ...duplicateSiteSelect, id: true, flightDate: true, takeoffAt: true, landingAt: true, localUtcOffsetMinutes: true, durationS: true, glider: true, takeoffSiteName: true } as const;

export async function saveLogbookEntry(ownerId: string, value: unknown) {
  const request = entryRequestSchema.parse(value);
  const parsed = requireParsed(request.draft);
  return prisma.$transaction(async tx => {
    // Serializes retries and the duplicate check for this pilot, including parallel imports.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
    const settings = await lockWingSettings(tx, ownerId);
    let tandemOverride = parsed.data.occupancy === null ? null : parsed.data.occupancy === "tandem";
    let originalEvidence = {};
    if (!request.flightId) {
      const previous = await tx.flight.findUnique({ where: { ownerId_entryRequestId: { ownerId, entryRequestId: request.requestId } }, select: { id: true } });
      if (previous) return previous;
    } else {
      await lockSiteRows(tx, [parsed.draft.takeoffSiteId, parsed.draft.landingSiteId].filter(Boolean));
      await lockFlightRow(tx, request.flightId, ownerId);
      const current = await tx.flight.findFirst({ where: { id: request.flightId, ownerId, recordingKind: "logbook" } });
      if (!current) throw new EntryError("This manual entry is not available to edit.", 404);
      originalEvidence = {
        ...(current.takeoffLat === parsed.data.takeoffLat && current.takeoffLon === parsed.data.takeoffLon ? { takeoffLocationSource: current.takeoffLocationSource } : {}),
        ...(current.landingLat === parsed.data.landingLat && current.landingLon === parsed.data.landingLon ? { landingLocationSource: current.landingLocationSource } : {}),
        ...(current.takeoffLocationEvidence ? { takeoffLocationEvidence: current.takeoffLocationEvidence } : {}),
        ...(current.landingLocationEvidence ? { landingLocationEvidence: current.landingLocationEvidence } : {}),
      };
      const tandemChanged = request.tandemTouched ?? (parsed.data.flightFlags.includes("tandem") !== (current.occupancy === "tandem" || current.flightFlags.includes("tandem")));
      tandemOverride = tandemChanged ? parsed.data.flightFlags.includes("tandem") : current.tandemOverride;
      parsed.data.launchTypes = [...current.launchTypes.filter(tag => tag !== "ST"), ...parsed.data.launchTypes];
      if (current.updatedAt.toISOString() !== request.expectedUpdatedAt) throw new EntryError("This flight changed in another tab. Reload it before saving.", 409);
    }
    const locations = await locationData(tx, ownerId, parsed.draft).catch(error => { throw new EntryError(error.message, 409); });
    const data = { ...parsed.data, ...locations, tandemOverride,
      ...tandemFlightData(parsed.data.flightFlags, tandemOverride ?? wingIsTandem(settings.tandemWings, parsed.data.glider)) };
    if (!request.flightId && !request.allowDuplicate) {
      const existing = (await tx.flight.findMany({ where: { ownerId }, select: duplicateSelect })).map(row => withOwnerSiteName(row, ownerId));
      const matches = existing.filter(flight => possibleDuplicate({ id: "new", ...data }, flight));
      if (matches.length) return { duplicates: matches.map(flight => ({ id: flight.id, date: duplicateKey(flight), time: duplicateTimeLabel(flight), wing: flight.glider, site: flight.takeoffSiteName })) };
    }
    const { plan, candidates } = await planEntrySites(tx, ownerId, [{ key: "entry", draft: parsed.draft }]);
    const committed = await commitEntrySites(tx, ownerId, plan, candidates, request.requestId, "manual");
    Object.assign(data, resolvedLocationPatch(parsed.draft, "entry", plan, committed.sites, committed.groupIds), locationEvidence(parsed.draft, "manual"), originalEvidence);
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
  const sites = await db.site.findMany({ where: { ...siteVisibleWhere(ownerId), archivedAt: null }, select: entrySiteSelect });
  const siteCache = new Map(sites.map(site => [site.id, site]));
  const existing = (await db.flight.findMany({ where: { ownerId }, select: duplicateSelect })).map(row => withOwnerSiteName(row, ownerId));
  const byDay = new Map<string, DuplicateFlight[]>();
  for (const flight of existing) { const key = duplicateKey(flight); byDay.set(key, [...(byDay.get(key) ?? []), flight]); }
  const timed: DuplicateFlight[] = existing.filter(flight => flight.takeoffAt);
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
      const possibleMatches = new Map((byDay.get(key) ?? []).map(match => [match.id, match]));
      if (candidate.takeoffAt) timed.forEach(match => possibleMatches.set(match.id, match));
      for (const match of possibleMatches.values()) {
        const time = duplicateTimeLabel(match);
        if (possibleDuplicate(candidate, match)) duplicates.push({ id: match.id, label: match.id.startsWith("row:") ? `CSV line ${match.id.slice(4)}${time ? ` · ${time}` : ""}` : `${duplicateKey(match)}${time ? ` · ${time}` : ""} · ${match.takeoffSiteName ?? "Unknown site"} · ${match.glider ?? "Unknown wing"}` });
        // A preview needs a few examples, even if a spreadsheet repeats a row thousands of times.
        if (duplicates.length === 5) break;
      }
      byDay.set(key, [...(byDay.get(key) ?? []), candidate]);
      if (candidate.takeoffAt) timed.push(candidate);
    }
    inspected.push({ line: row.line, errors, warnings: entryWarnings(row.draft), duplicates, data });
  }
  return inspected;
}

export async function previewLogbookImport(ownerId: string, value: unknown) {
  const request = importRequestSchema.parse(value);
  const inspected = await inspectRows(ownerId, request);
  const { plan, candidates } = await planEntrySites(prisma, ownerId, request.rows.filter((row, index) => !row.excluded && !inspected[index].errors.length).map(row => ({ key: String(row.line), draft: row.draft })));
  return { rows: inspected.map(({ line, errors, warnings, duplicates }) => ({ line, errors, warnings: [...warnings,
    ...plan.resolutions.filter(item => item.key.startsWith(`${line}:`) && item.name).map(describeSiteResolution)], duplicates })),
    sitePlanSignature: sitePlanSignature(plan, candidates),
    sites: plan.groups.map(group => ({ name: group.draft.name, mapped: group.draft.lat !== null, visibility: group.draft.visibility,
      flights: new Set(plan.resolutions.filter(row => row.groupKey === group.key).map(row => row.key.split(":")[0])).size })) };
}

export async function commitLogbookImport(ownerId: string, value: unknown) {
  const request = importRequestSchema.parse(value);
  const fileHash = createHash("sha256").update(request.csv.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n")).digest("hex");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
    const settings = await lockWingSettings(tx, ownerId);
    const previous = await tx.logbookImport.findFirst({ where: { ownerId, OR: [{ requestId: request.requestId }, { fileHash, undoneAt: null }] } });
    if (previous) {
      if (previous.undoneAt) throw new EntryError("This import was undone. Reopen the CSV to start a new import.", 409);
      return { id: previous.id, importedCount: previous.importedCount, skippedCount: previous.skippedCount, alreadyImported: true };
    }
    const inspected = await inspectRows(ownerId, request, tx);
    const included = request.rows.map((row, index) => ({ row, review: inspected[index] })).filter(({ row }) => !row.excluded);
    if (!included.length) throw new EntryError("Select at least one flight to import.");
    if (included.some(({ row, review }) => review.errors.length || (review.duplicates.length && !row.allowDuplicate))) throw new EntryError("Resolve the highlighted errors and overlapping flights before importing. Check the preview again.", 409);
    const { plan, candidates } = await planEntrySites(tx, ownerId, included.map(({ row }) => ({ key: String(row.line), draft: row.draft })));
    if (request.sitePlanSignature && request.sitePlanSignature !== sitePlanSignature(plan, candidates)) throw new EntryError("The proposed sites changed. Check the import preview again before importing.", 409);
    const committedSites = await commitEntrySites(tx, ownerId, plan, candidates, request.requestId, "csv");
    const batch = await tx.logbookImport.create({ data: { ownerId, requestId: request.requestId, fileHash, filename: request.filename,
      rowCount: request.rows.length, importedCount: included.length, skippedCount: request.rows.length - included.length, snapshot: {}, siteChanges: committedSites.changes } });
    const now = new Date();
    const entries = included.map(({ row, review }) => {
      const data = review.data!;
      const tandemOverride = data.occupancy === null ? null : data.occupancy === "tandem";
      return { ...data, ...resolvedLocationPatch(row.draft, String(row.line), plan, committedSites.sites, committedSites.groupIds), ...locationEvidence(row.draft, "csv"), tandemOverride, ...tandemFlightData(data.flightFlags, tandemOverride ?? wingIsTandem(settings.tandemWings, data.glider)), id: generateShortId(10), ownerId,
      visibility: request.visibility, source: "csv_import", recordingKind: "logbook", status: "ready", xcStatus: "not_recorded", metricsVersion: METRICS_VERSION,
      logbookImportId: batch.id, importRow: row.line, updatedAt: now };
    });
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
    const siteChanges = (Array.isArray(batch.siteChanges) ? batch.siteChanges : []) as SiteChange[];
    await lockSiteRows(tx, siteChanges.map(site => site.id));
    const snapshot = batch.snapshot as Record<string, string>;
    const flights = await tx.flight.findMany({ where: { logbookImportId: id, ownerId }, select: { id: true, updatedAt: true, recordingKind: true } });
    const eligible = flights.filter(flight => flight.recordingKind === "logbook" && flight.updatedAt.toISOString() === snapshot[flight.id]);
    const removed = await tx.flight.deleteMany({ where: { ownerId, logbookImportId: id, recordingKind: "logbook", OR: eligible.map(flight => ({ id: flight.id, updatedAt: flight.updatedAt })),
      photos: { none: {} }, kudos: { none: {} }, instructorNotes: { none: {} }, instructorId: null } });
    let removedSites = 0;
    for (const change of siteChanges) {
      const where = { id: change.id, ownerId, visibility: "private", updatedAt: new Date(change.updatedAt),
        takeoffFlights: { none: {} }, landingFlights: { none: {} }, zones: { none: {} } };
      if (change.created) removedSites += (await tx.site.deleteMany({ where })).count;
      else if (change.before) await tx.site.updateMany({ where, data: change.before });
    }
    await tx.logbookImport.update({ where: { id }, data: { undoneAt: new Date() } });
    return { removed: removed.count, retained: flights.length - removed.count, removedSites, retainedSites: siteChanges.length - removedSites };
  }, { maxWait: 10000, timeout: 30000 });
}
