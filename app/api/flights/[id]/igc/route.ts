import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/profile";
import { getOriginalIgcForOwner } from "@/lib/flights/original-igc";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getOriginalIgcForOwner(id, await getCurrentUserId());
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404, headers });

  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      ...headers,
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${result.filename}"`,
      "content-length": String(result.bytes.length),
    },
  });
}
