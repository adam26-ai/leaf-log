import { NextResponse } from "next/server";
import { ingestFlight } from "@/lib/ingest/ingest-flight";
import { parseBearer } from "@/lib/devices/token";
import { resolveDeviceTokenOwner, touchDeviceToken } from "@/lib/devices/repo";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Device IGC ingest. Auth is a scoped, revocable bearer token, not a browser
 * session. Per-token rate limiting is a follow-up; token auth gates abuse for v1.
 */
export async function POST(request: Request) {
  const token = parseBearer(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  let resolved: Awaited<ReturnType<typeof resolveDeviceTokenOwner>>;
  try {
    resolved = await resolveDeviceTokenOwner(token);
  } catch {
    return NextResponse.json(
      { error: "Could not process this upload" },
      { status: 500 },
    );
  }
  if (!resolved) {
    return NextResponse.json({ error: "Invalid or revoked key" }, { status: 401 });
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  if (bytes.length === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 });
  }

  const filename = request.headers.get("x-filename")?.trim() || "device.igc";
  try {
    const result = await ingestFlight({
      ownerId: resolved.ownerId,
      bytes,
      source: "device_push",
      filename,
    });
    await touchDeviceToken(resolved.tokenId, result.flightId);
    return NextResponse.json({
      flightId: result.flightId,
      status: result.status,
      deduped: result.deduped,
      account: resolved.account,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not process this upload" },
      { status: 500 },
    );
  }
}
