import { prisma } from "@/lib/prisma";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { findLocation } from "@/lib/sites/lookup";
import { sha256Hex } from "@/lib/ingest/dedupe";
import { duplicateKey, duplicateTimeLabel, possibleIgcDuplicate } from "./duplicates";

const duplicateSelect = {
  id: true,
  flightDate: true,
  takeoffAt: true,
  landingAt: true,
  localUtcOffsetMinutes: true,
  durationS: true,
  glider: true,
  takeoffSiteName: true,
  recordingKind: true,
} as const;

export type IgcDuplicateCandidate = {
  id: string;
  date: string;
  time: string | null;
  site: string | null;
  wing: string | null;
  recordingKind: "igc" | "logbook";
};

export type IgcDuplicateInspection = {
  exact: { id: string; status: "ready" | "failed" } | null;
  candidates: IgcDuplicateCandidate[];
};

/**
 * Inspect an IGC before a user-initiated upload creates a new flight. Exact
 * byte matches stay idempotent; fuzzy matches use the same rules as manual and
 * CSV imports so either direction through the product gets the same warning.
 */
export async function inspectIgcDuplicates(
  ownerId: string,
  bytes: Uint8Array,
): Promise<IgcDuplicateInspection> {
  const hash = sha256Hex(bytes);
  const exact = await prisma.flight.findUnique({
    where: { ownerId_igcSha256: { ownerId, igcSha256: hash } },
    select: { id: true, status: true },
  });
  if (exact) {
    return {
      exact: {
        id: exact.id,
        status: exact.status === "ready" ? "ready" : "failed",
      },
      candidates: [],
    };
  }

  const parsed = parseIgc(bytes);
  const metrics = deriveMetrics(parsed);
  if (!metrics) return { exact: null, candidates: [] };

  const [takeoffMatch, existing] = await Promise.all([
    findLocation(prisma, {
      ...metrics.takeoff,
      kind: "takeoff",
      viewerId: ownerId,
    }).catch(() => null),
    prisma.flight.findMany({ where: { ownerId }, select: duplicateSelect }),
  ]);
  const recordedDay = new Date(
    metrics.takeoffAtMs + (metrics.localUtcOffsetMinutes ?? 0) * 60_000,
  )
    .toISOString()
    .slice(0, 10);
  const candidate = {
    id: "new-igc",
    flightDate: new Date(`${recordedDay}T00:00:00.000Z`),
    takeoffAt: new Date(metrics.takeoffAtMs),
    landingAt: new Date(metrics.landingAtMs),
    localUtcOffsetMinutes: metrics.localUtcOffsetMinutes,
    durationS: metrics.durationS,
    glider: parsed.headers.glider,
    takeoffSiteName: takeoffMatch?.site.name ?? null,
  };

  return {
    exact: null,
    candidates: existing
      .filter((flight) => possibleIgcDuplicate(candidate, flight))
      .slice(0, 5)
      .map((flight) => ({
        id: flight.id,
        date: duplicateKey(flight),
        time: duplicateTimeLabel(flight),
        site: flight.takeoffSiteName,
        wing: flight.glider,
        recordingKind:
          flight.recordingKind === "logbook" ? "logbook" : "igc",
      })),
  };
}
