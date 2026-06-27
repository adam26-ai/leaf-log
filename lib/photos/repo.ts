import { prisma } from "@/lib/prisma";
import { getFlightForViewer } from "@/lib/flights/repo";
import type { Flight } from "@prisma/client";

/**
 * App-layer privacy for photos: they inherit the parent flight's visibility.
 * Every read goes through `getFlightForViewer` first, so photo access follows
 * the same owner/public/friends decision. No image bytes in the list.
 */
const PHOTO_LIST_SELECT = {
  id: true,
  originalFilename: true,
  displayWidth: true,
  displayHeight: true,
  thumbWidth: true,
  thumbHeight: true,
  takenAt: true,
  tSec: true,
  lat: true,
  lon: true,
  altM: true,
  placementSource: true,
  placementFailureReason: true,
  createdAt: true,
} as const;

export type PhotoListItem = {
  id: string;
  originalFilename: string | null;
  displayWidth: number;
  displayHeight: number;
  thumbWidth: number;
  thumbHeight: number;
  takenAt: Date | null;
  tSec: number | null;
  lat: number | null;
  lon: number | null;
  altM: number | null;
  placementSource: string;
  placementFailureReason: string | null;
  createdAt: Date;
};

export type VisiblePhotos = {
  flight: Flight;
  photos: PhotoListItem[];
};

export type VisiblePhotoBytes = {
  flight: Flight;
  bytes: Buffer;
};

/** Photos for a flight, only if the viewer may see it (else null → 404). */
export async function listPhotosForViewer(
  flightId: string,
  viewerId: string | null,
): Promise<PhotoListItem[] | null> {
  const result = await listPhotosWithFlightForViewer(flightId, viewerId);
  return result?.photos ?? null;
}

export async function listPhotosWithFlightForViewer(
  flightId: string,
  viewerId: string | null,
): Promise<VisiblePhotos | null> {
  const flight = await getFlightForViewer(flightId, viewerId);
  if (!flight) return null;
  const photos = await prisma.photo.findMany({
    where: { flightId },
    orderBy: [{ takenAt: "asc" }, { createdAt: "asc" }],
    select: PHOTO_LIST_SELECT,
  });
  return { flight, photos };
}

/**
 * The sanitized bytes for one variant of a photo, only if the viewer may see the
 * parent flight AND the photo belongs to it (else null → 404).
 */
export async function getPhotoBytesForViewer(
  flightId: string,
  photoId: string,
  viewerId: string | null,
  variant: "thumb" | "display",
): Promise<Buffer | null> {
  const result = await getPhotoBytesWithFlightForViewer(
    flightId,
    photoId,
    viewerId,
    variant,
  );
  return result?.bytes ?? null;
}

export async function getPhotoBytesWithFlightForViewer(
  flightId: string,
  photoId: string,
  viewerId: string | null,
  variant: "thumb" | "display",
): Promise<VisiblePhotoBytes | null> {
  const flight = await getFlightForViewer(flightId, viewerId);
  if (!flight) return null;
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, flightId },
    select: {
      data: {
        select: { display: variant === "display", thumb: variant === "thumb" },
      },
    },
  });
  if (!photo?.data) return null;
  const bytes = variant === "display" ? photo.data.display : photo.data.thumb;
  return bytes ? { flight, bytes: Buffer.from(bytes) } : null;
}
