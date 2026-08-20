import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { buildTrackArtifact } from "@/lib/igc/track-artifact";
import { findLocation } from "@/lib/sites/lookup";
import { resolveSiteCache } from "@/lib/sites/associate";
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
  // Device pushes honor the same default as web uploads (the device authenticates
  // over HTTPS with a scoped, revocable token).
  const owner = await prisma.profile.findUnique({
    where: { id: ownerId },
    select: { defaultVisibility: true },
  });
  const visibility = normalizeVisibility(owner?.defaultVisibility);

  const parsed = parseIgc(bytes);
  const metrics = deriveMetrics(parsed);

  // Write-time scope: what the flight's OWNER can name for their own flight —
  // public sites/zones plus their own private ones. Distinct from the
  // read-time scope applied later per viewer in lib/flights/repo.ts. This is
  // a best-effort pre-match outside the transaction; it's re-verified below
  // inside the create transaction, since a site can be demoted or deleted
  // between this match and the write.
  //
  // SPRINT-005: findLocation resolves a zone-first match with a site
  // fallback, but this PR (PR1) writes the SITE portion only — the zone
  // cache columns stay unwritten until PR2's two-level read-path firewall
  // exists to protect them. The ordering is the safety property.
  const [takeoffMatch, landingMatch] = metrics
    ? await Promise.all([
        findLocation(prisma, {
          lat: metrics.takeoff.lat,
          lon: metrics.takeoff.lon,
          kind: "takeoff",
          viewerId: ownerId,
        }),
        findLocation(prisma, {
          lat: metrics.landing.lat,
          lon: metrics.landing.lon,
          kind: "landing",
          viewerId: ownerId,
        }),
      ])
    : [null, null];

  const track = metrics ? buildTrackArtifact(parsed.fixes, metrics) : null;
  const status: "ready" | "failed" = metrics ? "ready" : "failed";
  const flightDateMs = parsed.headers.dateMs ?? metrics?.takeoffAtMs ?? 0;

  const flight = await prisma.$transaction(async (tx) => {
    // Re-read each matched site INSIDE the transaction and re-verify it's
    // still visible to the owner (not just that it still exists) — a demote
    // to private-owned-by-someone-else between match and create must never
    // cache a name the flight's owner no longer has any claim to.
    const [takeoffPatch, landingPatch] = await Promise.all([
      resolveSiteCache(tx, takeoffMatch?.site.id ?? null, "takeoff", ownerId),
      resolveSiteCache(tx, landingMatch?.site.id ?? null, "landing", ownerId),
    ]);

    return tx.flight.create({
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
        ...takeoffPatch,
        ...landingPatch,
        data: {
          create: {
            rawIgc: Buffer.from(bytes),
            track: track ? (track as unknown as Prisma.InputJsonValue) : undefined,
          },
        },
      },
      select: { id: true },
    });
  });

  return {
    flightId: flight.id,
    status,
    deduped: false,
    warnings: parsed.warnings,
  };
}
