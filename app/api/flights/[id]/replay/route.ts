import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/profile";
import { getFlightForViewer } from "@/lib/flights/repo";
import { replayArtifactForFlight } from "@/lib/flights/replay-repo";

export const runtime = "nodejs";

/**
 * Returns the time-aligned 3D replay path for a flight. Authorization is
 * app-layer via the viewer-scoped repo. Only the derived artifact is cached;
 * authorization is freshly resolved on every request.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewerId = await getCurrentUserId();

  const flight = await getFlightForViewer(id, viewerId);
  if (!flight) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const artifact = await replayArtifactForFlight(flight);
  if (!artifact) {
    return NextResponse.json({ error: "No track" }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  return NextResponse.json(
    artifact.replay,
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
