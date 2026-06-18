import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ingestFlight } from "@/lib/ingest/ingest-flight";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Authenticated IGC upload. A THIN caller of the shared ingestFlight() core —
 * the future Leaf device-push API (POST /api/ingest) will call the same core
 * with source='device_push'.
 */
export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const profile = await prisma.profile.findUnique({ where: { id: userId } });
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
        ownerId: userId,
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
