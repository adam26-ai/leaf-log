import { Prisma, type Flight } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { buildReplayArtifact, readReplayArtifact, type ReplayArtifact } from "@/lib/igc/replay-artifact";

const pending = new Map<string, Promise<ReplayArtifact | null>>();

/** Internal derived-data reader. Call only AFTER authorizing the flight. No auth decisions cached. */
export async function replayArtifactForFlight(flight: Flight): Promise<ReplayArtifact | null> {
  if (!flight.igcSha256 || flight.recordingKind === "logbook") return null;
  const sourceHash = flight.igcSha256;
  const key = `${flight.id}:${flight.igcSha256}:${flight.parserVersion}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    const cached = await prisma.flightData.findUnique({ where: { flightId: flight.id }, select: { replay: true } });
    const artifact = readReplayArtifact(cached?.replay, sourceHash, flight.parserVersion);
    if (artifact) return artifact;
    const data = await prisma.flightData.findUnique({ where: { flightId: flight.id }, select: { rawIgc: true } });
    if (!data) return null;
    const parsed = parseIgc(new Uint8Array(data.rawIgc));
    const metrics = deriveMetrics(parsed);
    if (!metrics) return null;
    const result = buildReplayArtifact(parsed, metrics, sourceHash, flight.parserVersion);
    // A source replacement/reprocess or deletion cannot attach this result to a new version.
    await prisma.flightData.updateMany({
      where: { flightId: flight.id, flight: { igcSha256: flight.igcSha256, parserVersion: flight.parserVersion } },
      data: { replay: result as unknown as Prisma.InputJsonValue },
    });
    return result;
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}
