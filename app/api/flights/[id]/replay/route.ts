import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/profile";
import { getFlightForViewer } from "@/lib/flights/repo";
import { prisma } from "@/lib/prisma";
import { parseIgc } from "@/lib/igc/parse";
import { deriveMetrics } from "@/lib/igc/derive";
import { buildReplayPath } from "@/lib/igc/replay";

export const runtime = "nodejs";

/**
 * Returns the time-aligned 3D replay path for a flight. Authorization is
 * app-layer via the viewer-scoped repo. The path is derived
 * fresh from the stored raw IGC, so it works for every flight regardless of the
 * cached 2D artifact's version.
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
    select: { rawIgc: true },
  });
  if (!data?.rawIgc) {
    return NextResponse.json({ error: "No flight data" }, { status: 404 });
  }

  const parsed = parseIgc(new Uint8Array(data.rawIgc));
  const metrics = deriveMetrics(parsed);
  if (!metrics) {
    return NextResponse.json({ error: "No track" }, { status: 404 });
  }

  const replay = buildReplayPath(parsed, metrics);
  return NextResponse.json(
    {
      ...replay,
      takeoffMs: metrics.takeoffAtMs,
      offsetMin: metrics.localUtcOffsetMinutes ?? 0,
    },
    {
      headers: {
        "cache-control":
          flight.visibility === "public" ? "private, max-age=300" : "no-store",
      },
    },
  );
}
