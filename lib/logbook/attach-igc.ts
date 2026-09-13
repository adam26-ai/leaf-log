import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { repairedMeasurements } from "@/lib/igc/repair-flight";
import { buildTrackArtifact } from "@/lib/igc/track-artifact";
import { buildReplayArtifact } from "@/lib/igc/replay-artifact";
import { sha256Hex } from "@/lib/ingest/dedupe";
import { PARSER_VERSION } from "@/lib/ingest/ingest-flight";
import { resolveLocationCache } from "@/lib/sites/associate";
import { emptyEntry } from "./entry";
import { planEntrySites, commitEntrySites, resolvedLocationPatch } from "./locations";
import { lockFlightRow } from "@/lib/sites/locks";
import { EntryError } from "./service";
import { duplicateKey } from "./duplicates";
import { lockWingSettings, tandemFlightData, wingIsTandem } from "@/lib/flights/tandem";

export async function attachIgc(ownerId: string, flightId: string, bytes: Uint8Array, commit: boolean, expectedUpdatedAt?: string, expectedHash?: string) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new EntryError("Choose a non-empty IGC file of 5 MB or less.");
  const hash = sha256Hex(bytes);
  const flight = await prisma.flight.findFirst({ where: { id: flightId, ownerId } });
  if (!flight) throw new EntryError("Flight not found.", 404);
  if (commit && flight.igcSha256 === hash && flight.recordingKind === "igc") return { id: flight.id, attached: true as const };
  const existing = await prisma.flight.findUnique({ where: { ownerId_igcSha256: { ownerId, igcSha256: hash } }, select: { id: true } });
  if (existing && existing.id !== flight.id) throw new EntryError(`This IGC is already in your logbook as flight ${existing.id}. Open that flight instead.`, 409);
  if (commit && flight.recordingKind !== "logbook") throw new EntryError("This flight already has a recording.", 409);
  const parsed = parseIgc(bytes), metrics = deriveMetrics(parsed);
  if (!metrics) throw new EntryError("This file has no usable GPS track. Your manual entry has not changed.");
  const measurements = repairedMeasurements(parsed, metrics);
  const recordedDay = new Date(metrics.takeoffAtMs + (metrics.localUtcOffsetMinutes ?? 0) * 60000).toISOString().slice(0, 10);
  const recorded = { recorder: parsed.headers.recorder, localUtcOffsetMinutes: metrics.localUtcOffsetMinutes, date: recordedDay, durationS: metrics.durationS, maxAltM: measurements.maxAltM, launchAltM: measurements.launchAltM,
    altGainM: metrics.altGainM, maxClimbMs: metrics.maxClimbMs, maxSinkMs: metrics.maxSinkMs,
    takeoffAt: new Date(metrics.takeoffAtMs).toISOString(), landingAt: new Date(metrics.landingAtMs).toISOString(),
    takeoffLat: metrics.takeoff.lat, takeoffLon: metrics.takeoff.lon, landingLat: metrics.landing.lat, landingLon: metrics.landing.lon };
  if (!commit) return { attached: false as const, mergeable: flight.recordingKind === "logbook", hash, expectedUpdatedAt: flight.updatedAt.toISOString(), warnings: parsed.warnings,
    previous: { recorder: flight.recorder, localUtcOffsetMinutes: flight.localUtcOffsetMinutes, date: duplicateKey(flight), durationS: flight.durationS, maxAltM: flight.maxAltM, launchAltM: flight.launchAltM,
      altGainM: flight.altGainM, maxClimbMs: flight.maxClimbMs, maxSinkMs: flight.maxSinkMs,
      takeoffAt: flight.takeoffAt?.toISOString() ?? null, landingAt: flight.landingAt?.toISOString() ?? null,
      takeoffLat: flight.takeoffLat, takeoffLon: flight.takeoffLon, landingLat: flight.landingLat, landingLon: flight.landingLon }, recorded };
  if (expectedHash !== hash || expectedUpdatedAt !== flight.updatedAt.toISOString()) throw new EntryError("The flight or selected file changed. Review the comparison again before attaching.", 409);
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`logbook:${ownerId}`}, 0))`;
      const settings = await lockWingSettings(tx, ownerId);
      // Retries keep the same flight and never create a second logbook entry.
      const current = await tx.flight.findFirst({ where: { id: flightId, ownerId } });
      if (current?.recordingKind === "igc" && current.igcSha256 === hash) return { id: flightId, attached: true as const };
      if (!current || current.recordingKind !== "logbook" || current.updatedAt.toISOString() !== expectedUpdatedAt) throw new EntryError("This flight changed. Review the comparison again.", 409);
      const draft = emptyEntry();
      for (const endpoint of ['takeoff', 'landing'] as const) {
        draft[`${endpoint}SiteId`] = current[`${endpoint}SiteId`] ?? '';
        draft[`${endpoint}SiteName`] = current[`${endpoint}SiteName`] ?? '';
        draft[`${endpoint}SiteCleared`] = current[`${endpoint}SiteAssignment`] === 'cleared' ? 'true' : '';
        draft[`${endpoint}Lat`] = String(metrics[endpoint].lat);
        draft[`${endpoint}Lon`] = String(metrics[endpoint].lon);
      }
      const { plan, candidates } = await planEntrySites(tx, ownerId, [{ key: 'entry', draft }]);
      const sites = await commitEntrySites(tx, ownerId, plan, candidates, hash, 'flight_gps');
      const patch = resolvedLocationPatch(draft, 'entry', plan, sites.sites, sites.groupIds);
      for (const endpoint of ['takeoff', 'landing'] as const) {
        if (current[`${endpoint}SiteId`] && current[`${endpoint}SiteId`] === patch[`${endpoint}SiteId`]) {
          Object.assign(patch, await resolveLocationCache(tx, current[`${endpoint}SiteId`], current[`${endpoint}ZoneId`], endpoint, ownerId));
          if (patch[`${endpoint}SiteAssignment`] !== 'needs_review') patch[`${endpoint}SiteAssignment`] = current[`${endpoint}SiteAssignment`];
        }
      }
      await lockFlightRow(tx, flightId, ownerId);
      const updated = await tx.flight.updateMany({ where: { id: flightId, ownerId, recordingKind: "logbook", updatedAt: new Date(expectedUpdatedAt!) }, data: {
        ...measurements, ...patch, takeoffLocationSource: "flight_gps", landingLocationSource: "flight_gps", flightDate: new Date(`${recordedDay}T00:00:00Z`),
        recordingKind: "igc", igcSha256: hash, parserVersion: PARSER_VERSION, pilot: current.pilot ?? parsed.headers.pilot,
        recorder: parsed.headers.recorder, glider: current.glider || parsed.headers.glider,
        ...tandemFlightData(current.flightFlags, current.tandemOverride ?? wingIsTandem(settings.tandemWings, current.glider || parsed.headers.glider)),
        xcScore: Prisma.JsonNull, xcStatus: "queued", xcQueuedAt: new Date(), xcStartedAt: null, xcError: null,
      } });
      if (!updated.count) throw new EntryError("This flight changed. Review the comparison again.", 409);
      await tx.flightData.create({ data: { flightId, rawIgc: Buffer.from(bytes), track: buildTrackArtifact(parsed.fixes, metrics) as unknown as Prisma.InputJsonValue,
        replay: buildReplayArtifact(parsed, metrics, hash, PARSER_VERSION) as unknown as Prisma.InputJsonValue } });
      return { id: flightId, attached: true as const };
    }, { maxWait: 10000, timeout: 30000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new EntryError("This recording was just added to your logbook. Reload before trying again.", 409);
    throw error;
  }
}
