import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/profile";
import { processAvatar, AvatarError } from "@/lib/avatar/process";
import { setAvatar, removeAvatar } from "@/lib/avatar/repo";

export const runtime = "nodejs";

/** Owner-only avatar upload (multipart, single file). Decodes, squares, strips EXIF. */
export async function POST(request: Request) {
  const viewerId = await getCurrentUserId();
  if (!viewerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  try {
    const processed = await processAvatar(
      Buffer.from(await file.arrayBuffer()),
      file.type || null,
      file.name,
    );
    await setAvatar(viewerId, processed, new Date());
  } catch (e) {
    if (e instanceof AvatarError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not process image" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

/** Owner-only avatar removal. */
export async function DELETE() {
  const viewerId = await getCurrentUserId();
  if (!viewerId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  await removeAvatar(viewerId);
  return NextResponse.json({ ok: true });
}
