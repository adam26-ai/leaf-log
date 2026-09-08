import { config } from "dotenv";
config({ path: ".env.local" });
import { Prisma, PrismaClient } from "@prisma/client";
import { parseIgc } from "../lib/igc/parse";
import { deriveMetrics } from "../lib/igc/derive";
import { buildTrackArtifact } from "../lib/igc/track-artifact";
import { PARSER_VERSION } from "../lib/ingest/ingest-flight";

const prisma = new PrismaClient();

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function reprocess(flightId: string) {
  const flight = await prisma.flight.findUnique({
    where: { id: flightId },
    include: { data: true },
  });
  if (!flight?.data?.rawIgc) throw new Error(`Flight ${flightId} has no raw IGC data`);

  const parsed = parseIgc(new Uint8Array(flight.data.rawIgc));
  const metrics = deriveMetrics(parsed);
  const track = metrics ? buildTrackArtifact(parsed.fixes, metrics) : null;

  await prisma.$transaction([
    prisma.flight.update({
      where: { id: flightId },
      data: {
        parserVersion: PARSER_VERSION,
        parseWarnings: parsed.warnings,
        status: metrics ? "ready" : "failed",
        failureReason: metrics ? null : "No usable GPS fixes in file",
        maxAltM: metrics?.maxAltM ?? null,
        altGainM: metrics?.altGainM ?? null,
        maxClimbMs: metrics?.maxClimbMs ?? null,
        maxSinkMs: metrics?.maxSinkMs ?? null,
        altSource: metrics?.altSource ?? null,
        trackDistM: metrics?.trackDistM ?? null,
        straightDistM: metrics?.straightDistM ?? null,
        takeoffAt: metrics ? new Date(metrics.takeoffAtMs) : null,
        landingAt: metrics ? new Date(metrics.landingAtMs) : null,
        durationS: metrics?.durationS ?? null,
        takeoffLat: metrics?.takeoff.lat ?? null,
        takeoffLon: metrics?.takeoff.lon ?? null,
        landingLat: metrics?.landing.lat ?? null,
        landingLon: metrics?.landing.lon ?? null,
        bounds: metrics?.bounds ?? Prisma.JsonNull,
        localTz: metrics?.localTz ?? null,
        localUtcOffsetMinutes: metrics?.localUtcOffsetMinutes ?? null,
      },
    }),
    prisma.flightData.update({
      where: { flightId },
      data: { track: track ? (track as unknown as Prisma.InputJsonValue) : Prisma.JsonNull },
    }),
  ]);

  console.log(`${flightId}: ${metrics ? `ready, climb ${metrics.maxClimbMs} m/s, sink ${metrics.maxSinkMs} m/s` : "failed"}`);
}

async function main() {
  const flightId = argument("--flight-id");
  const all = process.argv.includes("--all");
  if ((flightId == null) === !all) {
    throw new Error("Use exactly one of --flight-id <id> or --all");
  }
  const ids = flightId
    ? [flightId]
    : (await prisma.flight.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } })).map((flight) => flight.id);
  for (const id of ids) await reprocess(id);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
