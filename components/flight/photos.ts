/** A photo as returned by GET /api/flights/[id]/photos (JSON; dates are ISO). */
export interface FlightPhoto {
  id: string;
  originalFilename: string | null;
  displayWidth: number;
  displayHeight: number;
  thumbWidth: number;
  thumbHeight: number;
  takenAt: string | null;
  tSec: number | null;
  lat: number | null;
  lon: number | null;
  altM: number | null;
  placementSource: string; // exif_gps | interpolated_time | unpinned
  placementFailureReason: string | null;
}

export function photoUrl(
  flightId: string,
  photoId: string,
  variant: "thumb" | "display",
): string {
  return `/api/flights/${flightId}/photos/${photoId}?variant=${variant}`;
}

export function isPinned(p: FlightPhoto): boolean {
  return p.lat != null && p.lon != null;
}
