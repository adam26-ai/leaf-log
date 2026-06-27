import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { listPhotosWithFlightForViewer } from "@/lib/photos/repo";
import { addPhotos, type PhotoInput } from "@/lib/photos/add-photos";

export const runtime = "nodejs";

/** Photo metadata for a flight (viewer-scoped; no image bytes). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewerId = await getCurrentUserId();
  const result = await listPhotosWithFlightForViewer(id, viewerId);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { photos: result.photos },
    {
      headers: {
        "cache-control":
          result.flight.visibility === "public"
            ? "private, max-age=60"
            : "no-store",
      },
    },
  );
}

/** Owner-only photo upload (multipart). Thin caller of addPhotos(). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  const fileList = form.getAll("files").filter((f): f is File => f instanceof File);
  if (fileList.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const files: PhotoInput[] = await Promise.all(
    fileList.map(async (f) => ({
      filename: f.name,
      mime: f.type || null,
      bytes: Buffer.from(await f.arrayBuffer()),
    })),
  );

  const out = await addPhotos({ flightId: id, ownerId: viewerId, files });
  return NextResponse.json(out);
}
