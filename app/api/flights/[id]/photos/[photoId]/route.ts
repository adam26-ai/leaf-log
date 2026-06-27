import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { getPhotoBytesWithFlightForViewer } from "@/lib/photos/repo";

export const runtime = "nodejs";

/** Serve a sanitized photo variant (viewer-scoped; no EXIF in the bytes). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;
  const viewerId = await getCurrentUserId();
  const variant =
    new URL(request.url).searchParams.get("variant") === "display"
      ? "display"
      : "thumb";

  const result = await getPhotoBytesWithFlightForViewer(
    id,
    photoId,
    viewerId,
    variant,
  );
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "x-content-type-options": "nosniff",
      "cache-control":
        result.flight.visibility === "public" ? "private, max-age=300" : "no-store",
    },
  });
}

/** Owner-only delete (cascades to PhotoData). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const { id, photoId } = await params;
  const viewerId = await getCurrentUserId();
  if (!viewerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const flight = await prisma.flight.findUnique({
    where: { id },
    select: { ownerId: true },
  });
  if (!flight || flight.ownerId !== viewerId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const photo = await prisma.photo.findFirst({
    where: { id: photoId, flightId: id },
    select: { id: true },
  });
  if (!photo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.photo.delete({ where: { id: photoId } });
  return NextResponse.json({ ok: true });
}
