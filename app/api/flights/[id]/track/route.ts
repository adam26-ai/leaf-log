import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/profile";
import { getFlightForViewer } from "@/lib/flights/repo";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Serves a flight's derived track artifact. Authorization is app-layer: the
 * viewer-scoped repo only returns the flight if they may see it.
 * Raw IGC is never served here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewerId = await getCurrentUserId();

  const flight = await getFlightForViewer(id, viewerId);
  if (!flight) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = await prisma.flightData.findUnique({
    where: { flightId: id },
    select: { track: true },
  });
  if (!data?.track) {
    return NextResponse.json({ error: "No track" }, { status: 404 });
  }

  return NextResponse.json(data.track, {
    headers: {
      "cache-control":
        flight.visibility === "public" ? "private, max-age=60" : "no-store",
    },
  });
}
