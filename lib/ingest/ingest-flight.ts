import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { buildTrackArtifact } from "@/lib/igc/track-artifact";
import { findSite } from "@/lib/sites/lookup";
import { normalizeVisibility } from "@/lib/flights/visibility";
import { sha256Hex } from "./dedupe";

export const PARSER_VERSION = "1";

export type IngestSource = "web_upload" | "device_push";

export interface IngestInput {
  ownerId: string;
  bytes: Uint8Array;
  source?: IngestSource;
  filename?: string;
}

export interface IngestResult {
  flightId: string;
  status: "ready" | "failed";
  deduped: boolean;
  warnings: string[];
}

function isoDate(ms: number): Date {
  return new Date(new Date(ms).toISOString().slice(0, 10) + "T00:00:00.000Z");
}

/**
 * The single, source-agnostic ingestion path. Web upload is its first caller; a
 * future Leaf device-push API is its second. Stores the raw IGC + derived track
 * in Postgres, parses + derives + locates sites, and persists the flight in one
 * transaction (atomic — no orphan cleanup needed). Never throws on malformed
 * IGC: an unparseable file becomes a `failed` flight with the raw bytes kept.
 */
export async function ingestFlight(input: IngestInput): Promise<IngestResult> {
  const { ownerId, bytes, source = "web_upload" } = input;
  const hash = sha256Hex(bytes);

  // Dedupe: same pilot + same exact bytes → no-op.
  const existing = await prisma.flight.findUnique({
    where: { ownerId_igcSha256: { ownerId, igcSha256: hash } },
    select: { id: true, status: true },
  });
  if (existing) {
    return {
      flightId: existing.id,
      status: existing.status === "ready" ? "ready" : "failed",
      deduped: true,
      warnings: [],
    };
  }

  // New flights inherit the owner's default visibility. Unknown values fail closed.
  const owner = await prisma.profile.findUnique({
    where: { id: ownerId },
    select: { defaultVisibility: true },
  });
  const visibility = normalizeVisibility(owner?.defaultVisibility);

  const parsed = parseIgc(bytes);
  const metrics = deriveMetrics(parsed);

  const [takeoffSite, landingSite] = metrics
    ? await Promise.all([
        findSite(prisma, metrics.takeoff.lat, metrics.takeoff.lon, "takeoff"),
        findSite(prisma, metrics.landing.lat, metrics.landing.lon, "landing"),
      ])
    : [null, null];

  const track = metrics ? buildTrackArtifact(parsed.fixes, metrics) : null;
  const status: "ready" | "failed" = metrics ? "ready" : "failed";
  const flightDateMs = parsed.headers.dateMs ?? metrics?.takeoffAtMs ?? 0;

  const flight = await prisma.flight.create({
    data: {
      ownerId,
      source,
      status,
      visibility,
      igcSha256: hash,
      parserVersion: PARSER_VERSION,
      parseWarnings: parsed.warnings,
      failureReason: metrics ? null : "No usable GPS fixes in file",
      flightDate: flightDateMs ? isoDate(flightDateMs) : null,
      glider: parsed.headers.glider,
      recorder: parsed.headers.recorder,
      takeoffAt: metrics ? new Date(metrics.takeoffAtMs) : null,
      landingAt: metrics ? new Date(metrics.landingAtMs) : null,
      durationS: metrics?.durationS ?? null,
      maxAltM: metrics?.maxAltM ?? null,
      altGainM: metrics?.altGainM ?? null,
      maxClimbMs: metrics?.maxClimbMs ?? null,
      maxSinkMs: metrics?.maxSinkMs ?? null,
      altSource: metrics?.altSource ?? null,
      trackDistM: metrics?.trackDistM ?? null,
      straightDistM: metrics?.straightDistM ?? null,
      takeoffLat: metrics?.takeoff.lat ?? null,
      takeoffLon: metrics?.takeoff.lon ?? null,
      landingLat: metrics?.landing.lat ?? null,
      landingLon: metrics?.landing.lon ?? null,
      bounds: metrics?.bounds ?? undefined,
      localTz: metrics?.localTz ?? null,
      localUtcOffsetMinutes: metrics?.localUtcOffsetMinutes ?? null,
      takeoffSiteId: takeoffSite?.id ?? null,
      takeoffSiteName: takeoffSite?.name ?? null,
      landingSiteId: landingSite?.id ?? null,
      landingSiteName: landingSite?.name ?? null,
      data: {
        create: {
          rawIgc: Buffer.from(bytes),
          track: track ? (track as unknown as Prisma.InputJsonValue) : undefined,
        },
      },
    },
    select: { id: true },
  });

  return {
    flightId: flight.id,
    status,
    deduped: false,
    warnings: parsed.warnings,
  };
}
