import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingestFlight } from "@/lib/ingest/ingest-flight";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Authenticated IGC upload. This route is a THIN caller of the shared
 * ingestFlight() core — the future Leaf device-push API (POST /api/ingest) will
 * call the same core with source='device_push'.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Must be onboarded (have a profile) before uploading.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json({ error: "Complete onboarding first" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const results = [];
  for (const file of files) {
    const name = file.name;
    if (!name.toLowerCase().endsWith(".igc")) {
      results.push({ filename: name, error: "Not an .igc file" });
      continue;
    }
    if (file.size > MAX_BYTES) {
      results.push({ filename: name, error: "File too large (max 5 MB)" });
      continue;
    }
    if (file.size === 0) {
      results.push({ filename: name, error: "Empty file" });
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = await ingestFlight({
        ownerId: user.id,
        bytes,
        source: "web_upload",
        filename: name,
      });
      results.push({ filename: name, ...r });
    } catch {
      results.push({ filename: name, error: "Could not process this file" });
    }
  }

  return NextResponse.json({ results });
}
