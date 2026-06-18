import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Serves a flight's derived track artifact. Authorization is enforced by RLS:
 * the viewer's client can only read the flight row if they own it OR it is
 * public. Only after that check do we use the service role to read the private
 * storage object. Raw IGC is never served here.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: flight } = await supabase
    .from("flights")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!flight) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: asset } = await admin
    .from("flight_assets")
    .select("bucket, object_key")
    .eq("flight_id", id)
    .eq("kind", "derived_track")
    .maybeSingle();

  if (!asset) {
    return NextResponse.json({ error: "No track" }, { status: 404 });
  }

  const { data: blob, error } = await admin.storage
    .from(asset.bucket)
    .download(asset.object_key);
  if (error || !blob) {
    return NextResponse.json({ error: "Track unavailable" }, { status: 404 });
  }

  return new NextResponse(await blob.text(), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=60",
    },
  });
}
