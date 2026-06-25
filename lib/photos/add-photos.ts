import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { buildReplayPath } from "@/lib/igc/replay";
import { processImage, PhotoError } from "./process";
import { parsePhotoMeta } from "./exif";
import { placePhoto } from "./placement";
import { localToUtcMs } from "./time";
import type { FlightPlacementContext, Placement, PhotoMeta } from "./types";
import type { Sample } from "@/lib/igc/interpolate";

const MAX_BATCH = 10;
const MAX_PER_FLIGHT = 40;
const ACCEPT_MIME = /^image\/(jpeg|png|heic|heif)$/i;
const ACCEPT_EXT = /\.(jpe?g|png|heic|heif)$/i;

export interface PhotoInput {
  filename: string;
  mime: string | null;
  bytes: Buffer;
}

export type PhotoStatus = "placed" | "unplaced" | "skipped_dupe" | "rejected";

export interface PhotoResult {
  filename: string;
  status: PhotoStatus;
  photoId?: string;
  placementSource?: string;
  reason?: string;
}

/**
 * The single write seam for attaching photos to a flight (thin route → this).
 * Owner-only (the caller authorizes; we re-assert). Builds the placement context
 * once from the stored IGC, then per-file: guard → process (decode/rotate/
 * downscale/strip) → dedupe → place → persist. A bad file is rejected per-file,
 * never failing the batch.
 */
export async function addPhotos({
  flightId,
  ownerId,
  files,
}: {
  flightId: string;
  ownerId: string;
  files: PhotoInput[];
}): Promise<{ results: PhotoResult[] }> {
  const flight = await prisma.flight.findUnique({ where: { id: flightId } });
  if (!flight || flight.ownerId !== ownerId) {
    throw new PhotoError("Not your flight");
  }

  // Placement context + samples from the stored raw IGC (a flight may lack a track).
  let ctx: FlightPlacementContext | null = null;
  let samples: Sample[] | null = null;
  const data = await prisma.flightData.findUnique({
    where: { flightId },
    select: { rawIgc: true },
  });
  if (data?.rawIgc) {
    const parsed = parseIgc(new Uint8Array(data.rawIgc));
    const metrics = deriveMetrics(parsed);
    if (metrics) {
      const replay = buildReplayPath(parsed, metrics);
      ctx = {
        takeoffMs: metrics.takeoffAtMs,
        durationS: replay.durationS,
        bounds: replay.bounds,
        localUtcOffsetMinutes:
          metrics.localUtcOffsetMinutes ?? flight.localUtcOffsetMinutes ?? null,
      };
      samples = replay.samples;
    }
  }

  const existing = await prisma.photo.count({ where: { flightId } });
  const results: PhotoResult[] = [];
  let added = 0;

  for (const file of files.slice(0, MAX_BATCH)) {
    if (existing + added >= MAX_PER_FLIGHT) {
      results.push({ filename: file.filename, status: "rejected", reason: "Per-flight photo limit reached" });
      continue;
    }
    if (!ACCEPT_MIME.test(file.mime ?? "") && !ACCEPT_EXT.test(file.filename)) {
      results.push({ filename: file.filename, status: "rejected", reason: "Unsupported type (JPEG, PNG, or HEIC)" });
      continue;
    }

    try {
      const processed = await processImage(file.bytes, file.mime, file.filename);

      const dupe = await prisma.photo.findUnique({
        where: { flightId_sha256: { flightId, sha256: processed.sha256 } },
        select: { id: true },
      });
      if (dupe) {
        results.push({ filename: file.filename, status: "skipped_dupe", photoId: dupe.id });
        continue;
      }

      const meta = await parsePhotoMeta(file.bytes);
      const placement =
        ctx && samples
          ? placePhoto(meta, ctx, samples)
          : noTrackPlacement(meta, flight.localUtcOffsetMinutes);

      let photoId: string;
      try {
        const photo = await prisma.photo.create({
          data: {
            flightId,
            originalFilename: file.filename,
            contentType: "image/jpeg",
            displayWidth: processed.display.width,
            displayHeight: processed.display.height,
            displayBytes: processed.display.bytes.length,
            thumbWidth: processed.thumb.width,
            thumbHeight: processed.thumb.height,
            thumbBytes: processed.thumb.bytes.length,
            takenAt: placement.takenAtMs != null ? new Date(placement.takenAtMs) : null,
            tSec: placement.tSec,
            exifOffsetMinutes: meta.exifOffsetMinutes,
            lat: placement.lat,
            lon: placement.lon,
            altM: placement.altM,
            placementSource: placement.source,
            placementFailureReason: placement.failureReason,
            sha256: processed.sha256,
            data: {
              create: {
                display: new Uint8Array(processed.display.bytes),
                thumb: new Uint8Array(processed.thumb.bytes),
              },
            },
          },
          select: { id: true },
        });
        photoId = photo.id;
      } catch (e) {
        // Concurrent upload of the same bytes lost the unique race.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          results.push({ filename: file.filename, status: "skipped_dupe" });
          continue;
        }
        throw e;
      }

      added++;
      results.push({
        filename: file.filename,
        status: placement.source === "unpinned" ? "unplaced" : "placed",
        photoId,
        placementSource: placement.source,
        reason: placement.failureReason ?? undefined,
      });
    } catch (e) {
      results.push({
        filename: file.filename,
        status: "rejected",
        reason: e instanceof PhotoError ? e.message : "Could not process this image",
      });
    }
  }

  return { results };
}

function noTrackPlacement(
  meta: PhotoMeta,
  offsetMinutes: number | null,
): Placement {
  const takenAtMs =
    meta.takenAtLocal && offsetMinutes != null
      ? localToUtcMs(meta.takenAtLocal, offsetMinutes)
      : null;
  return {
    lat: null,
    lon: null,
    altM: null,
    tSec: null,
    takenAtMs,
    source: "unpinned",
    failureReason: "no_track",
  };
}
